import { useCallback, useEffect, useRef, useState } from 'react'
import { forceSimulation, forceCollide } from 'd3-force'
import { computeAffinities } from './autoArrangeAffinity.js'

// The length-based constants below were tuned for rooms roughly
// REFERENCE_ROOM_PX across. Room pixel sizes now follow true proportion
// (see computeScale), so a file with a wide area spread can have rooms many
// times that size — computeTuning scales every length-based constant by how
// big the layout's typical room actually is, so behaviour stays the same at
// any scale.
const REFERENCE_ROOM_PX = 100
const REPULSION_STRENGTH = 8000
const MAX_REPULSION_PX = 40
const CENTER_STRENGTH = 0.02
const SEPARATION_PADDING_PX = 8
const SEPARATION_ITERATIONS = 4
const COLLIDE_ITERATIONS = 3
const ADJACENCY_CORRECTION_FACTOR = 0.3
const AFFINITY_DISTANCE_CAP_PX = 400
const AFFINITY_PULL_FACTOR = 0.02
// Measured edge-to-edge (centre distance minus both radii), not
// centre-to-centre, so the range still reaches the neighbours of a large room.
const REPEL_RANGE_PX = 290
// Kept separate from AFFINITY_PULL_FACTOR so repel strength can be tuned on
// its own — attract and repel use different-shaped formulas (see makeForce).
const REPEL_PULL_FACTOR = 0.03
const START_JITTER_PX = 4
const SETTLE_MAX_ITERATIONS = 200
const SETTLE_EPSILON_PX = 0.1

function computeTuning(boxes) {
  const sizes = boxes
    .map((box) => Math.sqrt(box.width * box.height))
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b)
  const typicalSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : REFERENCE_ROOM_PX
  const k = typicalSize / REFERENCE_ROOM_PX
  return {
    k,
    padding: SEPARATION_PADDING_PX * k,
    // Force = S/d^2 with d and the resulting velocity both in length units,
    // so strength scales with k^3 (k from S, and k^2 from the d^2 divisor).
    repulsionStrength: REPULSION_STRENGTH * k ** 3,
    maxRepulsion: MAX_REPULSION_PX * k,
    affinityCap: AFFINITY_DISTANCE_CAP_PX * k,
    repelRange: REPEL_RANGE_PX * k,
    jitter: START_JITTER_PX * k,
    settleEpsilon: SETTLE_EPSILON_PX * k,
  }
}

// Rectangle-overlap separation, run as its own iterative position solver
// rather than folded into the velocity-based forces below. Overlap is a
// hard constraint (rooms must never overlap) rather than a soft preference,
// so unlike repulsion/attraction it is NOT scaled by alpha — it always
// resolves at full strength, even once the simulation has mostly cooled.
// Each pass re-reads the positions the previous pass just corrected
// (Gauss-Seidel style), which lets a correction on one side of a crowded
// room propagate through and free it up within a single tick.
//
// Used two ways: as the live per-tick force for 'rectangle' collision mode,
// and as part of the settle pass before accept() commits, regardless of which
// mode ran live. Returns the largest single push it applied.
function resolveOverlaps(nodes, padding) {
  let maxPush = 0
  for (let pass = 0; pass < SEPARATION_ITERATIONS; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeA = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeB = nodes[j]
        const dx = nodeB.x - nodeA.x
        const dy = nodeB.y - nodeA.y
        const overlapX = (nodeA.width + nodeB.width) / 2 + padding - Math.abs(dx)
        const overlapY = (nodeA.height + nodeB.height) / 2 + padding - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue

        // A pinned node (the user is actively dragging it) never gets moved
        // by the solver — its free partner absorbs the whole correction. If
        // both happen to be pinned, leave the overlap; that's the user's own
        // placement, not ours to fight.
        const aFixed = nodeA.fx != null
        const bFixed = nodeB.fx != null
        if (aFixed && bFixed) continue

        if (overlapX < overlapY) {
          const sign = dx >= 0 ? 1 : -1
          const push = aFixed || bFixed ? overlapX : overlapX / 2
          if (!aFixed) nodeA.x -= sign * push
          if (!bFixed) nodeB.x += sign * push
          maxPush = Math.max(maxPush, push)
        } else {
          const sign = dy >= 0 ? 1 : -1
          const push = aFixed || bFixed ? overlapY : overlapY / 2
          if (!aFixed) nodeA.y -= sign * push
          if (!bFixed) nodeB.y += sign * push
          maxPush = Math.max(maxPush, push)
        }
      }
    }
  }
  return maxPush
}

// The visible gap between two rooms' outlines for the current collision
// shape. 'rectangle' is the true closest rectangle-to-rectangle gap — the
// same metric computeConnections/rectDistance use for the violation display,
// so what the physics satisfies is what the UI then reports. 'circle'
// measures against the equal-area circles actually being rendered.
function edgeGap(nodeA, nodeB, centerDistance, shape) {
  if (shape === 'rectangle') {
    const gapX = Math.max(0, Math.abs(nodeB.x - nodeA.x) - (nodeA.width + nodeB.width) / 2)
    const gapY = Math.max(0, Math.abs(nodeB.y - nodeA.y) - (nodeA.height + nodeB.height) / 2)
    return Math.hypot(gapX, gapY)
  }
  return Math.max(0, centerDistance - nodeA.radius - nodeB.radius)
}

// adjacentRooms is keyed by room NAME, not id, so when several rooms share a
// name a rule has to target exactly one of them. Which instance is nearest
// changes as rooms move, so that choice is re-resolved from LIVE positions on
// every call (see resolveAdjacencyTargets); this index holds only the static
// part — which node declared which rule, and who the same-named candidates
// are — so the per-tick work is just the distance comparison.
function buildAdjacencyIndex(nodes) {
  const byName = new Map()
  nodes.forEach((node) => {
    if (!byName.has(node.roomName)) byName.set(node.roomName, [])
    byName.get(node.roomName).push(node)
  })

  const rules = []
  nodes.forEach((node) => {
    Object.entries(node.adjacentRoomsPx).forEach(([name, maxDistancePx]) => {
      const candidates = (byName.get(name) || []).filter((candidate) => candidate !== node)
      if (candidates.length > 0) rules.push({ node, candidates, maxDistancePx })
    })
  })
  return { rules, nodeCount: nodes.length }
}

// Resolves "nearest same-named instance" from live node positions, mirroring
// computeConnections' nearest-by-centre-distance logic so the physics always
// pulls toward the same room the drawn line points at.
function resolveAdjacencyTargets({ rules, nodeCount }) {
  const pairs = new Map() // lo * nodeCount + hi -> { nodeA, nodeB, maxDistancePx }
  rules.forEach(({ node, candidates, maxDistancePx }) => {
    let nearest = candidates[0]
    let nearestDistance = (nearest.x - node.x) ** 2 + (nearest.y - node.y) ** 2
    for (let i = 1; i < candidates.length; i += 1) {
      const distance = (candidates[i].x - node.x) ** 2 + (candidates[i].y - node.y) ** 2
      if (distance < nearestDistance) {
        nearest = candidates[i]
        nearestDistance = distance
      }
    }
    const nodeA = node.index < nearest.index ? node : nearest
    const nodeB = nodeA === node ? nearest : node
    const key = nodeA.index * nodeCount + nodeB.index
    // Both rooms in a pair can each declare their own rule toward the
    // other's name — keep the stricter (smaller) of the two.
    const existing = pairs.get(key)
    if (!existing) pairs.set(key, { nodeA, nodeB, maxDistancePx })
    else if (maxDistancePx < existing.maxDistancePx) existing.maxDistancePx = maxDistancePx
  })
  return pairs.values()
}

// The user's own explicit adjacency rules get a dedicated, unconditional
// position solver — the same category of mechanism as resolveOverlaps —
// rather than the soft, alpha-scaled velocity force the inferred
// (color/keyword/fuzzy) tiers use: a rule from the user's own data is a hard
// constraint, not an aesthetic preference that should fade as the simulation
// cools.
//
// Deliberately closes only a FRACTION (ADJACENCY_CORRECTION_FACTOR) of the
// excess distance per call. A full, instant correction can snap two rooms
// into an overlap whenever the requested distance is near what their
// footprints can physically achieve, after which resolveOverlaps shoves them
// apart and the two solvers fight forever. A gradual pull leaves
// resolveOverlaps a small correction to react to, so the pair settles at
// whatever distance is actually achievable. Returns the largest move applied.
function resolveAdjacency(index, shape, tuning) {
  let maxMove = 0
  for (const { nodeA, nodeB, maxDistancePx } of resolveAdjacencyTargets(index)) {
    const dx = nodeB.x - nodeA.x
    const dy = nodeB.y - nodeA.y
    const centerDistance = Math.hypot(dx, dy) || 1
    const ux = dx / centerDistance
    const uy = dy / centerDistance

    // maxDistancePx is a clearance gap, not a centre-to-centre span. The
    // floor is the separation padding, which is the closest the overlap
    // solver will ever allow two rooms to sit.
    const target = Math.max(maxDistancePx, tuning.padding)
    const excess = edgeGap(nodeA, nodeB, centerDistance, shape) - target
    if (excess <= 0) continue

    const aFixed = nodeA.fx != null
    const bFixed = nodeB.fx != null
    if (aFixed && bFixed) continue

    const step = excess * ADJACENCY_CORRECTION_FACTOR
    const pull = aFixed || bFixed ? step : step / 2
    if (!aFixed) {
      nodeA.x += ux * pull
      nodeA.y += uy * pull
    }
    if (!bFixed) {
      nodeB.x -= ux * pull
      nodeB.y -= uy * pull
    }
    maxMove = Math.max(maxMove, pull)
  }
  return maxMove
}

// Runs adjacency and overlap solving against the rooms' REAL rectangles
// until neither moves anything meaningful, so what gets committed matches
// what the normal (non-preview) view will measure — regardless of whether the
// live session used circles, which can interpenetrate as rectangles and meet
// adjacency limits by a different metric. Overlap runs last in each round, so
// even if an adjacency rule can't be met (blocked by neighbours) the result
// is never left overlapping. Capped so an unsatisfiable rule can't spin.
//
// A rule that can't be met keeps pulling and being pushed back, so the loop
// above can run to its cap with a few overlaps still unresolved. The final
// overlap-only pass has no adjacency fighting it, so it always finishes the
// job — committed layouts never overlap.
function settleLayout(nodes, index, tuning) {
  for (let i = 0; i < SETTLE_MAX_ITERATIONS; i += 1) {
    const adjacencyMove = resolveAdjacency(index, 'rectangle', tuning)
    const overlapMove = resolveOverlaps(nodes, tuning.padding)
    if (Math.max(adjacencyMove, overlapMove) < tuning.settleEpsilon) break
  }
  for (let i = 0; i < SETTLE_MAX_ITERATIONS; i += 1) {
    if (resolveOverlaps(nodes, tuning.padding) < tuning.settleEpsilon) break
  }
}

// Registers whichever collision strategy is current under a shared force
// name ('separation'), so calling this again on an already-running
// simulation replaces the previous one — that's what lets setCollisionShape
// hot-swap the live mode. Neither strategy scales with alpha. A circle's
// footprint differs from its room's rectangle, so rooms can interpenetrate as
// rectangles mid-session in circle mode; settleLayout resolves that at accept.
function applyCollisionForce(simulation, nodes, shape, tuning) {
  if (shape === 'rectangle') {
    simulation.force('separation', () => {
      resolveOverlaps(nodes, tuning.padding)
    })
  } else {
    simulation.force(
      'separation',
      forceCollide((node) => node.radius).iterations(COLLIDE_ITERATIONS),
    )
  }
}

// Velocity-based force covering the soft layout preferences: generic
// pairwise repulsion (so rooms spread out instead of collapsing to a point)
// and the INFERRED affinity tiers (color/keyword/fuzzy) from
// autoArrangeAffinity.js. The user's own adjacentRooms rule never appears in
// `affinities`; it's a hard constraint handled by resolveAdjacency.
//
// The keyword tier can carry a NEGATIVE strength (a "repel" edge from
// TERM_RELATIONS). Attract and repel deliberately use opposite distance
// shapes: attract is a spring that pulls harder the FURTHER apart the pair is
// (capped), while repel is a short-range push that's strongest when the pair
// is CLOSE and fades to nothing past the repel range.
function makeForce(nodes, affinities, centroid, tuning) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pairs = affinities.flatMap(({ aId, bId, strength }) => {
    const nodeA = byId.get(aId)
    const nodeB = byId.get(bId)
    return nodeA && nodeB ? [{ nodeA, nodeB, strength }] : []
  })

  return (alpha) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeA = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeB = nodes[j]
        const dx = nodeB.x - nodeA.x
        const dy = nodeB.y - nodeA.y
        const distance = Math.sqrt(dx * dx + dy * dy) || 1
        const ux = dx / distance
        const uy = dy / distance

        const repulse = Math.min(tuning.repulsionStrength / (distance * distance), tuning.maxRepulsion) * alpha
        nodeA.vx -= ux * repulse
        nodeA.vy -= uy * repulse
        nodeB.vx += ux * repulse
        nodeB.vy += uy * repulse
      }
    }

    pairs.forEach(({ nodeA, nodeB, strength }) => {
      const dx = nodeB.x - nodeA.x
      const dy = nodeB.y - nodeA.y
      const distance = Math.sqrt(dx * dx + dy * dy) || 1

      let pull
      if (strength >= 0) {
        pull = strength * alpha * Math.min(distance, tuning.affinityCap) * AFFINITY_PULL_FACTOR
      } else {
        const gap = Math.max(0, distance - nodeA.radius - nodeB.radius)
        const closeness = Math.max(0, tuning.repelRange - gap)
        if (closeness === 0) return
        pull = strength * alpha * closeness * REPEL_PULL_FACTOR
      }
      const ux = dx / distance
      const uy = dy / distance
      nodeA.vx += ux * pull
      nodeA.vy += uy * pull
      nodeB.vx -= ux * pull
      nodeB.vy -= uy * pull
    })

    // Repulsion alone has no restoring force, so without this the whole
    // cluster would drift outward indefinitely instead of settling.
    nodes.forEach((node) => {
      node.vx += (centroid.x - node.x) * CENTER_STRENGTH * alpha
      node.vy += (centroid.y - node.y) * CENTER_STRENGTH * alpha
    })
  }
}

// Drives an interactive, previewable auto-arrange session: start() seeds a
// d3-force simulation from the current room boxes and streams live
// positions into `previewBoxes` every tick; pinNode/dragPreview/releaseNode
// let the user nudge a room while the simulation keeps running around it;
// accept() commits the final positions into the real roomBoxes state as one
// history entry, cancel() just discards the preview — roomBoxes is never
// touched until accept() commits it, so the shared undo stack only ever
// sees this as a single gesture (see useUndoHistory.js).
export function useAutoArrange({ roomBoxes, setRoomBoxes, scale, recordHistory }) {
  const [isArranging, setIsArranging] = useState(false)
  const [previewBoxes, setPreviewBoxes] = useState([])
  // 'circle' lets rooms slide past each other while settling — circle-circle
  // separation pushes along the full centre-to-centre line in any direction,
  // where rectangle separation only ever pushes along X or Y, which tends to
  // lock rooms into place. 'rectangle' collides against the room's real
  // footprint the whole time, which is tighter but less free-flowing.
  // Switchable live via setCollisionShape below.
  const [collisionShape, setCollisionShapeState] = useState('circle')
  // The adjacency force closure (registered once in start()) needs whichever
  // shape is CURRENT, including after a live hot-swap — a ref avoids
  // re-registering that force on every mode change.
  const collisionShapeRef = useRef(collisionShape)
  collisionShapeRef.current = collisionShape
  const simulationRef = useRef(null)
  const nodesRef = useRef([])
  const nodeMapRef = useRef(new Map())
  const adjacencyIndexRef = useRef(null)
  const tuningRef = useRef(null)
  const roomBoxesRef = useRef(roomBoxes)
  roomBoxesRef.current = roomBoxes
  // Which node a pointer is actively dragging, if any — see dragPreview's
  // own comment for why this guard is needed.
  const draggingIdRef = useRef(null)

  const readPreview = useCallback(() => {
    const nodeMap = nodeMapRef.current
    setPreviewBoxes(
      roomBoxesRef.current.map((box) => {
        const node = nodeMap.get(box.id)
        if (!node) return box
        return { ...box, x: node.x - node.width / 2, y: node.y - node.height / 2, radius: node.radius }
      }),
    )
  }, [])

  const stop = useCallback(() => {
    simulationRef.current?.stop()
    simulationRef.current = null
    nodesRef.current = []
    nodeMapRef.current = new Map()
    adjacencyIndexRef.current = null
    tuningRef.current = null
    draggingIdRef.current = null
    setIsArranging(false)
    setPreviewBoxes([])
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(() => {
    const boxes = roomBoxesRef.current
    if (boxes.length === 0) return
    simulationRef.current?.stop()

    const tuning = computeTuning(boxes)
    const centroid = {
      x: boxes.reduce((sum, box) => sum + box.x + box.width / 2, 0) / boxes.length,
      y: boxes.reduce((sum, box) => sum + box.y + box.height / 2, 0) / boxes.length,
    }
    // A small random jitter breaks perfectly-stacked starting positions
    // (e.g. every room freshly imported at the same spot) so repulsion has
    // something to push apart from the very first tick. `radius` is the
    // equal-area circle for the room's real (target-area-derived) footprint
    // — box.area is already in the same px² space box.width/height live in.
    // `roomName`/`adjacentRoomsPx` (metres converted to px once, here) ride
    // along on each node so adjacency can re-resolve "nearest same-named
    // instance" from live positions every tick.
    const nodes = boxes.map((box, index) => ({
      id: box.id,
      index,
      roomName: box.roomName,
      adjacentRoomsPx: Object.fromEntries(
        Object.entries(box.adjacentRooms || {})
          .filter(([, meters]) => Number.isFinite(meters))
          .map(([name, meters]) => [name, meters * scale]),
      ),
      width: box.width,
      height: box.height,
      radius: Math.sqrt(box.area / Math.PI),
      x: box.x + box.width / 2 + (Math.random() - 0.5) * tuning.jitter,
      y: box.y + box.height / 2 + (Math.random() - 0.5) * tuning.jitter,
      vx: 0,
      vy: 0,
    }))
    nodesRef.current = nodes
    nodeMapRef.current = new Map(nodes.map((node) => [node.id, node]))
    tuningRef.current = tuning
    const adjacencyIndex = buildAdjacencyIndex(nodes)
    adjacencyIndexRef.current = adjacencyIndex

    const affinities = computeAffinities(boxes)
    const simulation = forceSimulation(nodes)
      .force('layout', makeForce(nodes, affinities, centroid, tuning))
      // Registered between the soft layout force and collision, so each
      // tick's order is: soft nudges → adjacency pulls violating pairs
      // together (possibly creating fresh overlaps) → collision immediately
      // resolves whatever overlaps exist now. That ordering is what lets
      // adjacency push through a crowded cluster while collision always gets
      // the last word on overlap-freedom.
      .force('adjacency', () => {
        resolveAdjacency(adjacencyIndex, collisionShapeRef.current, tuning)
      })
      .alphaDecay(0.02)
      .on('tick', readPreview)

    applyCollisionForce(simulation, nodes, collisionShape, tuning)

    simulationRef.current = simulation
    setIsArranging(true)
    readPreview()
  }, [scale, readPreview, collisionShape])

  // Wraps the raw setState so switching mode mid-session actually takes
  // effect immediately — d3-force forces can be reassigned on a running
  // simulation, so this just re-registers 'separation' under the new
  // strategy and gives it a small alpha bump so it visibly does something
  // even if the simulation had mostly cooled down.
  const setCollisionShape = useCallback((shape) => {
    setCollisionShapeState(shape)
    const simulation = simulationRef.current
    if (!simulation) return
    applyCollisionForce(simulation, nodesRef.current, shape, tuningRef.current)
    simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart()
  }, [])

  const reshuffle = useCallback(() => {
    if (!simulationRef.current) return
    const nodes = nodesRef.current
    if (nodes.length === 0) return

    const centerX = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length
    const centerY = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length
    // Sized from the rooms' own total footprint, not a fixed constant and
    // not the current bounding box — a flat offset relative to wherever
    // nodes had already settled barely moves a large layout. Total area
    // scales with room count/size regardless of how tightly the current
    // arrangement has converged.
    const totalArea = nodes.reduce((sum, node) => sum + node.width * node.height, 0)
    const spreadRadius = Math.sqrt(totalArea) * 1.5

    nodes.forEach((node) => {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * spreadRadius
      node.x = centerX + Math.cos(angle) * radius
      node.y = centerY + Math.sin(angle) * radius
      node.fx = null
      node.fy = null
    })
    simulationRef.current.alpha(1).restart()
  }, [])

  const pinNode = useCallback((id, x, y) => {
    const node = nodeMapRef.current.get(id)
    if (!node) return
    draggingIdRef.current = id
    node.fx = x
    node.fy = y
    simulationRef.current?.alphaTarget(0.3).restart()
  }, [])

  const dragPreview = useCallback((id, x, y) => {
    // Each room's onPointerMove fires on ordinary hover, same as any DOM
    // pointermove listener — it needs no prior pointerdown and no button
    // held. Without this guard, dragPreview would pin whatever room the
    // cursor happened to be passing over, not just the one being dragged.
    if (draggingIdRef.current !== id) return
    const node = nodeMapRef.current.get(id)
    if (!node) return
    node.fx = x
    node.fy = y
  }, [])

  const releaseNode = useCallback((id) => {
    if (draggingIdRef.current === id) draggingIdRef.current = null
    const node = nodeMapRef.current.get(id)
    if (node) {
      node.fx = null
      node.fy = null
    }
    simulationRef.current?.alphaTarget(0)
  }, [])

  const cancel = useCallback(() => stop(), [stop])

  const accept = useCallback(() => {
    if (!isArranging) return
    settleLayout(nodesRef.current, adjacencyIndexRef.current, tuningRef.current)
    recordHistory()
    const nodeMap = nodeMapRef.current
    setRoomBoxes(
      roomBoxesRef.current.map((box) => {
        const node = nodeMap.get(box.id)
        if (!node) return box
        return { ...box, x: node.x - node.width / 2, y: node.y - node.height / 2 }
      }),
    )
    stop()
  }, [isArranging, recordHistory, setRoomBoxes, stop])

  return {
    isArranging,
    previewBoxes,
    collisionShape,
    setCollisionShape,
    start,
    cancel,
    accept,
    reshuffle,
    pinNode,
    dragPreview,
    releaseNode,
  }
}
