import { useCallback, useEffect, useRef, useState } from 'react'
import { forceSimulation, forceCollide } from 'd3-force'
import { computeAffinities } from './autoArrangeAffinity.js'

const REPULSION_STRENGTH = 8000
const MAX_REPULSION_PX = 40
const CENTER_STRENGTH = 0.02
const SEPARATION_PADDING_PX = 8
const SEPARATION_ITERATIONS = 4
const COLLIDE_ITERATIONS = 3
const ADJACENCY_CORRECTION_FACTOR = 0.3
const AFFINITY_DISTANCE_CAP_PX = 400
const AFFINITY_PULL_FACTOR = 0.02
const REPEL_RANGE_PX = 400

// Rectangle-overlap separation, run as its own iterative position solver
// rather than folded into the velocity-based forces below. Overlap is a
// hard constraint (rooms must never overlap) rather than a soft preference,
// so unlike repulsion/attraction it is NOT scaled by alpha — it always
// resolves at full strength, even once the simulation has mostly cooled.
// Each of the SEPARATION_ITERATIONS passes re-reads the positions the
// previous pass in the same tick just corrected (Gauss-Seidel style), which
// is what lets a correction on one side of a crowded room propagate through
// and free it up within a single tick — a plain single pass leaves a room
// boxed in on multiple sides receiving several opposing corrections that
// largely cancel out, so it never actually escapes. This mirrors how
// d3-force's own built-in forceCollide resolves circle overlap internally.
//
// Used two ways: as the live per-tick force for 'rectangle' collision mode,
// and as a final cleanup pass before accept() commits, regardless of which
// mode ran live — see the 'circle' mode note in start() for why that
// cleanup matters.
function resolveOverlaps(nodes) {
  for (let pass = 0; pass < SEPARATION_ITERATIONS; pass += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeA = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeB = nodes[j]
        const dx = nodeB.x - nodeA.x
        const dy = nodeB.y - nodeA.y
        const overlapX = (nodeA.width + nodeB.width) / 2 + SEPARATION_PADDING_PX - Math.abs(dx)
        const overlapY = (nodeA.height + nodeB.height) / 2 + SEPARATION_PADDING_PX - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue

        // A pinned node (the user is actively dragging it) never gets moved
        // by the solver — its free partner absorbs the whole correction
        // instead of just half. If both happen to be pinned, leave the
        // overlap; that's the user's own placement, not ours to fight.
        const aFixed = nodeA.fx != null
        const bFixed = nodeB.fx != null
        if (aFixed && bFixed) continue

        if (overlapX < overlapY) {
          const sign = dx >= 0 ? 1 : -1
          const push = aFixed || bFixed ? overlapX : overlapX / 2
          if (!aFixed) nodeA.x -= sign * push
          if (!bFixed) nodeB.x += sign * push
        } else {
          const sign = dy >= 0 ? 1 : -1
          const push = aFixed || bFixed ? overlapY : overlapY / 2
          if (!aFixed) nodeA.y -= sign * push
          if (!bFixed) nodeB.y += sign * push
        }
      }
    }
  }
}

// The user's own explicit adjacency rules get a dedicated, unconditional
// position solver — the same category of mechanism as resolveOverlaps —
// rather than going through the soft, alpha-scaled velocity force below
// that the inferred (color/keyword/fuzzy) tiers use. That distinction is
// what makes this "hierarchical": a rule from the user's own data is a hard
// constraint the layout should satisfy, not a soft aesthetic preference that
// should fade as the simulation cools. Running it unconditionally, every
// tick, is also what lets it actually win a contest against intervening
// rooms' collision resistance — a velocity nudge that decays with alpha
// never stood a chance against a collision solver that never decays.
//
// Deliberately closes only a FRACTION (ADJACENCY_CORRECTION_FACTOR) of the
// excess distance per tick rather than the whole thing in one shot. A full,
// instant correction can snap two rooms straight into an overlap whenever
// the requested max distance is close to (or smaller than) what their own
// footprints can physically achieve — resolveOverlaps then shoves them back
// apart, the next tick's full correction snaps them right back together,
// and the two solvers fight forever instead of settling ("too strong,
// stuck overlapping"). A gradual pull still reliably closes the gap over a
// handful of ticks (there are dozens per second) but gives resolveOverlaps,
// which runs immediately after this in the same tick, a much smaller
// correction to react to each time, so the pair settles smoothly at
// whatever distance is actually achievable instead of oscillating.
function resolveAdjacency(nodes, affinities) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  affinities.forEach(({ tier, aId, bId, maxDistancePx }) => {
    if (tier !== 'adjacency') return
    const nodeA = byId.get(aId)
    const nodeB = byId.get(bId)
    if (!nodeA || !nodeB) return
    const dx = nodeB.x - nodeA.x
    const dy = nodeB.y - nodeA.y
    const distance = Math.hypot(dx, dy) || 1

    // Never pull the pair closer than their own combined footprints allow —
    // without this floor, a maxDistancePx smaller than what the two rooms'
    // sizes can physically achieve doesn't just get "as close as possible":
    // in circle mode specifically, forceCollide is a soft, proportional
    // spring (pushes harder the more two circles overlap, weaker as the
    // overlap shrinks), so a persistent opposing pull from this force can
    // settle into a STABLE equilibrium partway inside the overlap instead of
    // being reliably outmuscled the way the always-fully-corrective
    // resolveOverlaps solver outmuscles it in rectangle mode. Clamping the
    // target here means this force simply stops asking once it reaches the
    // physical floor, in either mode, rather than relying on the collision
    // solver's own strength to win a fight it shouldn't have to have.
    const safeMinDistance = (nodeA.radius || 0) + (nodeB.radius || 0) + SEPARATION_PADDING_PX
    const target = Math.max(maxDistancePx, safeMinDistance)
    const excess = distance - target
    if (excess <= 0) return

    const aFixed = nodeA.fx != null
    const bFixed = nodeB.fx != null
    if (aFixed && bFixed) return

    const ux = dx / distance
    const uy = dy / distance
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
  })
}

// Registers whichever collision strategy is current under a shared force
// name ('separation'), so calling this again on an already-running
// simulation replaces the previous one — that's what lets setCollisionShape
// hot-swap the live mode instead of only taking effect on the next start().
// Neither strategy scales with alpha (see resolveOverlaps' own comment for
// why). A circle's footprint is smaller than its room's actual rectangle
// along the diagonals (an equal-area circle is narrower than a square at
// the corners), so two rooms can end up with non-overlapping circles but
// still-overlapping rectangles mid-session — harmless while the layout is
// visibly still settling, but accept() always runs one final resolveOverlaps
// pass regardless of mode so the committed result is never wrong, even
// after a 'circle' session.
function applyCollisionForce(simulation, nodes, shape) {
  if (shape === 'rectangle') {
    simulation.force('separation', () => resolveOverlaps(nodes))
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
// autoArrangeAffinity.js — soft nudges that are fine to fade as alpha
// decays. The adjacency tier is deliberately excluded here; it's a hard
// constraint from the user's own data, handled by resolveAdjacency's
// unconditional position solver above instead, not this soft velocity path.
//
// The keyword tier can now carry a NEGATIVE strength (a "repel" edge from
// TERM_RELATIONS in autoArrangeAffinity.js, e.g. wc-away-from-kitchen) —
// every other tier is attract-only. Attract and repel deliberately use
// opposite distance shapes, not just a sign flip on the same formula:
// attract is a spring that pulls harder the FURTHER apart the pair is
// (capped, so it keeps tugging distant rooms closer), while repel is a
// short-range push that's strongest when the pair is already CLOSE and
// fades to nothing past REPEL_RANGE_PX (the same shape the generic
// repulsion above uses). Reusing the attract formula for a repel edge would
// do the opposite of what "keep these apart" needs — the push would
// weaken exactly when the pair is closest and most in need of separating.
function makeForce(nodes, affinities, centroid) {
  const byId = new Map(nodes.map((node) => [node.id, node]))

  return (alpha) => {
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeA = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const nodeB = nodes[j]
        const dx = nodeB.x - nodeA.x
        const dy = nodeB.y - nodeA.y
        const distance = Math.hypot(dx, dy) || 1
        const ux = dx / distance
        const uy = dy / distance

        const repulse = Math.min(REPULSION_STRENGTH / (distance * distance), MAX_REPULSION_PX) * alpha
        nodeA.vx -= ux * repulse
        nodeA.vy -= uy * repulse
        nodeB.vx += ux * repulse
        nodeB.vy += uy * repulse
      }
    }

    affinities.forEach(({ tier, aId, bId, strength }) => {
      if (tier === 'adjacency') return
      const nodeA = byId.get(aId)
      const nodeB = byId.get(bId)
      if (!nodeA || !nodeB) return
      const dx = nodeB.x - nodeA.x
      const dy = nodeB.y - nodeA.y
      const distance = Math.hypot(dx, dy) || 1

      let pull
      if (strength >= 0) {
        pull = strength * alpha * Math.min(distance, AFFINITY_DISTANCE_CAP_PX) * AFFINITY_PULL_FACTOR
      } else {
        const closeness = Math.max(0, REPEL_RANGE_PX - distance)
        if (closeness === 0) return
        pull = strength * alpha * closeness * AFFINITY_PULL_FACTOR
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
// sees this as a single gesture, the same as any other discrete action in
// the app (see useUndoHistory.js).
export function useAutoArrange({ roomBoxes, setRoomBoxes, scale, recordHistory }) {
  const [isArranging, setIsArranging] = useState(false)
  const [previewBoxes, setPreviewBoxes] = useState([])
  // 'circle' lets rooms slide past each other while settling — circle-circle
  // separation pushes along the full center-to-center line in any direction,
  // where rectangle separation only ever pushes along X or Y, which tends to
  // lock rooms into place rather than letting them route around each other.
  // 'rectangle' collides against the room's real footprint the whole time
  // instead, which is tighter but less free-flowing. Switchable live via
  // setCollisionShape below, which hot-swaps the running simulation's force.
  const [collisionShape, setCollisionShapeState] = useState('circle')
  const simulationRef = useRef(null)
  const nodesRef = useRef([])
  const affinitiesRef = useRef([])
  const roomBoxesRef = useRef(roomBoxes)
  roomBoxesRef.current = roomBoxes
  // Which node a pointer is actively dragging, if any — see dragPreview's
  // own comment for why this guard is needed.
  const draggingIdRef = useRef(null)

  const readPreview = useCallback(() => {
    setPreviewBoxes(
      roomBoxesRef.current.map((box) => {
        const node = nodesRef.current.find((n) => n.id === box.id)
        if (!node) return box
        return { ...box, x: node.x - node.width / 2, y: node.y - node.height / 2, radius: node.radius }
      }),
    )
  }, [])

  const stop = useCallback(() => {
    simulationRef.current?.stop()
    simulationRef.current = null
    nodesRef.current = []
    affinitiesRef.current = []
    draggingIdRef.current = null
    setIsArranging(false)
    setPreviewBoxes([])
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(() => {
    const boxes = roomBoxesRef.current
    if (boxes.length === 0) return

    const centroid = {
      x: boxes.reduce((sum, box) => sum + box.x + box.width / 2, 0) / boxes.length,
      y: boxes.reduce((sum, box) => sum + box.y + box.height / 2, 0) / boxes.length,
    }
    // A small random jitter breaks perfectly-stacked starting positions
    // (e.g. every room freshly imported at the same spot) so repulsion has
    // something to push apart from the very first tick. `radius` is the
    // equal-area circle for the room's real (target-area-derived) footprint
    // — box.area is already in the same px² space box.width/height live in.
    const nodes = boxes.map((box) => ({
      id: box.id,
      width: box.width,
      height: box.height,
      radius: Math.sqrt(box.area / Math.PI),
      x: box.x + box.width / 2 + (Math.random() - 0.5) * 4,
      y: box.y + box.height / 2 + (Math.random() - 0.5) * 4,
      vx: 0,
      vy: 0,
    }))
    nodesRef.current = nodes

    const affinities = computeAffinities(boxes, scale)
    affinitiesRef.current = affinities
    const simulation = forceSimulation(nodes)
      .force('layout', makeForce(nodes, affinities, centroid))
      // Registered between the soft layout force and collision, so each
      // tick's order is: soft nudges → adjacency pulls violating pairs
      // together (possibly creating fresh overlaps in doing so) → collision
      // immediately resolves whatever overlaps exist now. That ordering is
      // what makes adjacency actually able to "push through" a crowded
      // cluster: collision always gets the last word on overlap-freedom, but
      // adjacency gets to force the crowding that makes room in the first
      // place, every single tick, not just when alpha happens to be high.
      .force('adjacency', () => resolveAdjacency(nodes, affinities))
      .alphaDecay(0.02)
      .on('tick', readPreview)

    applyCollisionForce(simulation, nodes, collisionShape)

    simulationRef.current = simulation
    setIsArranging(true)
    readPreview()
  }, [scale, readPreview, collisionShape])

  // Wraps the raw setState so switching mode mid-session actually takes
  // effect immediately — d3-force forces can be reassigned on a running
  // simulation via simulation.force(name, ...), so this just re-registers
  // 'separation' under the new strategy and gives it a small alpha bump to
  // make sure it visibly does something rather than sitting idle if the
  // simulation had already mostly cooled down.
  const setCollisionShape = useCallback((shape) => {
    setCollisionShapeState(shape)
    const simulation = simulationRef.current
    if (!simulation) return
    applyCollisionForce(simulation, nodesRef.current, shape)
    simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart()
  }, [])

  const reshuffle = useCallback(() => {
    if (!simulationRef.current) return
    nodesRef.current.forEach((node) => {
      node.x += (Math.random() - 0.5) * 200
      node.y += (Math.random() - 0.5) * 200
      node.fx = null
      node.fy = null
    })
    simulationRef.current.alpha(1).restart()
  }, [])

  const pinNode = useCallback((id, x, y) => {
    const node = nodesRef.current.find((n) => n.id === id)
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
    // cursor happened to be passing over, not just the one actually being
    // dragged (mirrors the dragState.current guard useRoomDrag.js uses for
    // exactly the same reason).
    if (draggingIdRef.current !== id) return
    const node = nodesRef.current.find((n) => n.id === id)
    if (!node) return
    node.fx = x
    node.fy = y
  }, [])

  const releaseNode = useCallback((id) => {
    if (draggingIdRef.current === id) draggingIdRef.current = null
    const node = nodesRef.current.find((n) => n.id === id)
    if (node) {
      node.fx = null
      node.fy = null
    }
    simulationRef.current?.alphaTarget(0)
  }, [])

  const cancel = useCallback(() => stop(), [stop])

  const accept = useCallback(() => {
    if (!isArranging) return
    // resolveAdjacency is deliberately gradual now (see its own comment), so
    // one call barely nudges anything — run it interleaved with overlap
    // cleanup a few times, the same order every live tick already used, to
    // let it actually converge before committing rather than just taking
    // whatever the last live tick happened to land on. Also guarantees a
    // non-overlapping rectangle result even after a 'circle' session, where
    // two rooms' circles can settle non-overlapping while their actual
    // rectangles still clip along a diagonal (see start()).
    for (let i = 0; i < 20; i += 1) {
      resolveAdjacency(nodesRef.current, affinitiesRef.current)
      resolveOverlaps(nodesRef.current)
    }
    recordHistory()
    setRoomBoxes(
      roomBoxesRef.current.map((box) => {
        const node = nodesRef.current.find((n) => n.id === box.id)
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
