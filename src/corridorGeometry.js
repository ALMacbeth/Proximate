const MIN_EDGE_LENGTH = 0.01
const EPSILON = 1e-6
const AXIS_ALIGN_EPSILON_PX = 0.5

// Perpendicular unit normal of the nodeA->nodeB direction, or null for a
// degenerate (zero-length) edge — callers must skip rendering/offsetting it
// rather than dividing by a near-zero length.
function edgeNormal(nodeA, nodeB) {
  const dx = nodeB.x - nodeA.x
  const dy = nodeB.y - nodeA.y
  const len = Math.hypot(dx, dy)
  if (len < MIN_EDGE_LENGTH) return null
  return { nx: -dy / len, ny: dx / len }
}

// The four corners of one edge's offset shape, in polygon-winding order,
// offset by widthPx/2 to each side of the nodeA-nodeB centerline.
export function computeEdgeOffsetPolygon(nodeA, nodeB, widthPx) {
  const normal = edgeNormal(nodeA, nodeB)
  if (!normal) return null
  const half = widthPx / 2
  const ox = normal.nx * half
  const oy = normal.ny * half
  return [
    { x: nodeA.x + ox, y: nodeA.y + oy },
    { x: nodeB.x + ox, y: nodeB.y + oy },
    { x: nodeB.x - ox, y: nodeB.y - oy },
    { x: nodeA.x - ox, y: nodeA.y - oy },
  ]
}

// A junction where 2+ corridor edges share a node is filled with a circle
// sized to the widest incident edge. This is deliberately not a mitered
// join: a true miter needs a left/right-of-travel pairing that depends on
// turn direction (which offset corner of edge A continues into which offset
// corner of edge B), and getting that pairing wrong produces a
// self-crossing "bowtie" polygon rather than just a visually rougher
// corner. A circle is correct at every angle and every width combination,
// at the cost of rendering bends as rounded rather than sharp-mitered.
export function computeJunctionFill(node, incidentWidthsPx) {
  if (incidentWidthsPx.length < 2) return null
  const maxWidthPx = Math.max(...incidentWidthsPx)
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) return null
  return { cx: node.x, cy: node.y, r: maxWidthPx / 2 }
}

// Holding Shift constrains a point to be directly horizontal or vertical
// from `anchor` (relative to the canvas's own X/Y axes, not the anchor's
// other neighbors), by snapping whichever axis is currently closer to zero.
export function constrainToAxis(anchor, point) {
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  return Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y }
}

// Closest point to `point` on segment a-b, clamped to the segment (not the
// infinite line), plus how far away it is.
function projectPointOntoSegment(point, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < EPSILON) {
    return { x: a.x, y: a.y, t: 0, distance: Math.hypot(point.x - a.x, point.y - a.y) }
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  const x = a.x + t * dx
  const y = a.y + t * dy
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) }
}

// Strict-interior intersection of segments p1-p2 and p3-p4 — returns null
// for parallel/collinear segments or an intersection at/beyond either
// segment's endpoints (endpoint-touching is handled separately, as a
// node-merge, not a crossing-split).
function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < EPSILON) return null

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom
  const INSET = 0.001
  if (t <= INSET || t >= 1 - INSET || u <= INSET || u >= 1 - INSET) return null

  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

let junctionCounter = 0
function nextJunctionId(prefix) {
  junctionCounter += 1
  return `${prefix}-${Date.now()}-${junctionCounter}`
}

// Resolves corridor topology after a discrete gesture (chain commit, node
// drag-end, edge drag-end) — never call this per pointer-move frame, since
// it can rewrite the node/edge arrays and doing that every frame would
// constantly remount SVG elements mid-drag.
//
// Runs three passes to a fixed point (bounded by maxIterations):
//   0. merge nodes placed within snapRadiusPx of each other (this is what
//      makes two chain endpoints placed close together actually join, and
//      is also what keeps a newly-computed crossing point from creating a
//      near-duplicate node when it lands almost on an existing one)
//   1. split an edge wherever some other node sits on its interior (a new
//      chain branching off the middle of an existing corridor)
//   2. split both edges wherever two edges cross in their interiors,
//      inserting one new shared node
//
// Returns fresh `nodes`/`edges` arrays (or the original references if
// nothing changed) so callers can pass the result straight into a React
// state setter.
export function resolveCorridorTopology(nodes, edges, options = {}) {
  const snapRadiusPx = options.snapRadiusPx ?? 6
  const maxIterations = options.maxIterations ?? 500

  let workingNodes = nodes
  let workingEdges = edges

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false

    // Pass 0: merge near-duplicate nodes.
    mergeLoop: for (let i = 0; i < workingNodes.length; i += 1) {
      for (let j = i + 1; j < workingNodes.length; j += 1) {
        const nodeA = workingNodes[i]
        const nodeB = workingNodes[j]
        if (Math.hypot(nodeA.x - nodeB.x, nodeA.y - nodeB.y) > snapRadiusPx) continue

        workingNodes = workingNodes.filter((n) => n.id !== nodeB.id)
        workingEdges = workingEdges
          .map((edge) => ({
            ...edge,
            nodeAId: edge.nodeAId === nodeB.id ? nodeA.id : edge.nodeAId,
            nodeBId: edge.nodeBId === nodeB.id ? nodeA.id : edge.nodeBId,
          }))
          .filter((edge) => edge.nodeAId !== edge.nodeBId)
        changed = true
        break mergeLoop
      }
    }
    if (changed) continue

    // Pass 1: a node sitting on another edge's interior (a T-branch).
    branchLoop: for (const node of workingNodes) {
      for (const edge of workingEdges) {
        if (edge.nodeAId === node.id || edge.nodeBId === node.id) continue
        const a = workingNodes.find((n) => n.id === edge.nodeAId)
        const b = workingNodes.find((n) => n.id === edge.nodeBId)
        if (!a || !b) continue

        const projection = projectPointOntoSegment(node, a, b)
        if (projection.t <= 0.02 || projection.t >= 0.98) continue
        if (projection.distance > snapRadiusPx) continue

        workingEdges = workingEdges
          .filter((e) => e.id !== edge.id)
          .concat([
            { ...edge, id: nextJunctionId('edge'), nodeAId: edge.nodeAId, nodeBId: node.id },
            { ...edge, id: nextJunctionId('edge'), nodeAId: node.id, nodeBId: edge.nodeBId },
          ])
        changed = true
        break branchLoop
      }
      if (changed) break
    }
    if (changed) continue

    // Pass 2: two unrelated edges crossing in their interiors.
    crossingLoop: for (let i = 0; i < workingEdges.length; i += 1) {
      for (let j = i + 1; j < workingEdges.length; j += 1) {
        const edgeA = workingEdges[i]
        const edgeB = workingEdges[j]
        const sharesNode =
          edgeA.nodeAId === edgeB.nodeAId ||
          edgeA.nodeAId === edgeB.nodeBId ||
          edgeA.nodeBId === edgeB.nodeAId ||
          edgeA.nodeBId === edgeB.nodeBId
        if (sharesNode) continue

        const a1 = workingNodes.find((n) => n.id === edgeA.nodeAId)
        const a2 = workingNodes.find((n) => n.id === edgeA.nodeBId)
        const b1 = workingNodes.find((n) => n.id === edgeB.nodeAId)
        const b2 = workingNodes.find((n) => n.id === edgeB.nodeBId)
        if (!a1 || !a2 || !b1 || !b2) continue

        const hit = segmentIntersection(a1, a2, b1, b2)
        if (!hit) continue

        const junctionNode = { id: nextJunctionId('node'), x: hit.x, y: hit.y }
        workingNodes = workingNodes.concat([junctionNode])
        workingEdges = workingEdges
          .filter((e) => e.id !== edgeA.id && e.id !== edgeB.id)
          .concat([
            { ...edgeA, id: nextJunctionId('edge'), nodeAId: edgeA.nodeAId, nodeBId: junctionNode.id },
            { ...edgeA, id: nextJunctionId('edge'), nodeAId: junctionNode.id, nodeBId: edgeA.nodeBId },
            { ...edgeB, id: nextJunctionId('edge'), nodeAId: edgeB.nodeAId, nodeBId: junctionNode.id },
            { ...edgeB, id: nextJunctionId('edge'), nodeAId: junctionNode.id, nodeBId: edgeB.nodeBId },
          ])
        changed = true
        break crossingLoop
      }
      if (changed) break
    }
    if (!changed) break
  }

  return { nodes: workingNodes, edges: workingEdges }
}

// Additional snap candidates for room drag/resize, built from
// axis-aligned corridor edges only (a diagonal corridor edge has no single
// scalar position on either axis, so it simply doesn't participate).
// Shaped exactly like the `{ min, size, crossMin, crossSize }` entries
// geometry.js's findAxisSnap already expects from other rooms — a
// zero-size entry contributes one point candidate (its `min`) without any
// changes to that shared engine.
export function computeCorridorRoomSnapCandidates(corridorNodes, corridorEdges, scale) {
  const xCandidates = []
  const yCandidates = []

  corridorEdges.forEach((edge) => {
    const a = corridorNodes.find((n) => n.id === edge.nodeAId)
    const b = corridorNodes.find((n) => n.id === edge.nodeBId)
    if (!a || !b) return
    const widthPx = edge.widthMeters * scale
    if (!Number.isFinite(widthPx) || widthPx <= 0) return

    const dx = b.x - a.x
    const dy = b.y - a.y
    const half = widthPx / 2

    if (Math.abs(dy) <= AXIS_ALIGN_EPSILON_PX && Math.abs(dx) > AXIS_ALIGN_EPSILON_PX) {
      const centerY = (a.y + b.y) / 2
      const crossMin = Math.min(a.x, b.x)
      const crossSize = Math.abs(dx)
      ;[centerY - half, centerY, centerY + half].forEach((min) => {
        yCandidates.push({ min, size: 0, crossMin, crossSize })
      })
    } else if (Math.abs(dx) <= AXIS_ALIGN_EPSILON_PX && Math.abs(dy) > AXIS_ALIGN_EPSILON_PX) {
      const centerX = (a.x + b.x) / 2
      const crossMin = Math.min(a.y, b.y)
      const crossSize = Math.abs(dy)
      ;[centerX - half, centerX, centerX + half].forEach((min) => {
        xCandidates.push({ min, size: 0, crossMin, crossSize })
      })
    }
  })

  return { xCandidates, yCandidates }
}

// Degree (incident-edge count) of every node, keyed by node id — used to
// decide whether a node needs a junction fill (degree >= 2) at all.
export function computeNodeDegrees(edges) {
  const degrees = new Map()
  edges.forEach((edge) => {
    degrees.set(edge.nodeAId, (degrees.get(edge.nodeAId) || 0) + 1)
    degrees.set(edge.nodeBId, (degrees.get(edge.nodeBId) || 0) + 1)
  })
  return degrees
}
