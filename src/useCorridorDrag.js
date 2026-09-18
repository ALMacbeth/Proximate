import { useRef } from 'react'
import { resolveCorridorTopology, constrainToAxis, corridorGroupNodeIds } from './corridorGeometry.js'

// Dragging a corridor node or an edge's body. Because every edge just
// references node ids, moving a node's x/y is all that's needed for every
// edge attached to it (not only the one grabbed) to follow — "propagating"
// a shared-endpoint move to the rest of the network falls out of the data
// model for free, with no extra bookkeeping here.
//
// Selection is tracked as two Sets (nodes/edges), owned by the caller (not
// this hook) so useRoomDrag.js can read/clear them too — that's what lets a
// mixed room+corridor selection move together regardless of which element
// started the drag. Clicking an element already part of a multi-selection
// (rooms included) keeps the whole group selected and drags all of it
// together; clicking anything else selects just that one element and starts
// a single-element drag — the same distinction useRoomDrag.js makes for
// rooms.
export function useCorridorDrag({
  corridorNodes,
  setCorridorNodes,
  corridorEdges,
  setCorridorEdges,
  selectedNodeIds,
  setSelectedNodeIds,
  selectedEdgeIds,
  setSelectedEdgeIds,
  roomBoxes,
  setRoomBoxes,
  selectedRoomIds,
  setSelectedRoomIds,
  getLayoutPointerPosition,
  recordHistory,
}) {
  const dragState = useRef(null)

  const toggleSelection = (setSelected, id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const beginDrag = (event, movingNodeIds, movingRoomIds = []) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    recordHistory()

    const pointerStart = getLayoutPointerPosition(event)
    const startPositions = new Map()
    corridorNodes.forEach((node) => {
      if (movingNodeIds.includes(node.id)) startPositions.set(node.id, { x: node.x, y: node.y })
    })
    const roomStartPositions = new Map()
    roomBoxes.forEach((box) => {
      if (movingRoomIds.includes(box.id)) roomStartPositions.set(box.id, { x: box.x, y: box.y })
    })

    dragState.current = {
      movingNodeIds,
      startPointerX: pointerStart.x,
      startPointerY: pointerStart.y,
      startPositions,
      roomStartPositions,
      // Axis-constrain only applies to a lone node with no rooms riding
      // along — a mixed group drag has no single "anchor" to constrain to.
      anchorNode: movingNodeIds.length === 1 && movingRoomIds.length === 0 ? findSingleNeighborAnchor(movingNodeIds[0]) : null,
    }
  }

  // For Shift axis-constrain while dragging a single node: anchor on the
  // nearest neighbor when the node has more than one incident edge (a
  // deterministic but arbitrary tie-break — a single new position can't
  // axis-align to every neighbor at once).
  const findSingleNeighborAnchor = (nodeId) => {
    const node = corridorNodes.find((n) => n.id === nodeId)
    if (!node) return null
    let nearest = null
    let nearestDistance = Infinity
    corridorEdges.forEach((edge) => {
      const otherId = edge.nodeAId === nodeId ? edge.nodeBId : edge.nodeBId === nodeId ? edge.nodeAId : null
      if (!otherId) return
      const other = corridorNodes.find((n) => n.id === otherId)
      if (!other) return
      const distance = Math.hypot(other.x - node.x, other.y - node.y)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = other
      }
    })
    return nearest
  }

  // A click on an element that's already part of a multi-selection (more
  // than one element selected in total, rooms included) keeps the group
  // intact instead of collapsing it down to just the one clicked.
  const isGroupMember = (type, id) => {
    if (selectedRoomIds.size + selectedNodeIds.size + selectedEdgeIds.size <= 1) return false
    return type === 'node' ? selectedNodeIds.has(id) : selectedEdgeIds.has(id)
  }

  const handleNodePointerDown = (event, node) => {
    if (event.shiftKey) {
      event.stopPropagation()
      toggleSelection(setSelectedNodeIds, node.id)
      return
    }
    if (isGroupMember('node', node.id)) {
      beginDrag(event, [...corridorGroupNodeIds(corridorEdges, selectedNodeIds, selectedEdgeIds)], [...selectedRoomIds])
      return
    }
    beginDrag(event, [node.id])
    setSelectedNodeIds(new Set([node.id]))
    setSelectedEdgeIds(new Set())
    setSelectedRoomIds(new Set())
  }

  const handleEdgePointerDown = (event, edge) => {
    if (event.shiftKey) {
      event.stopPropagation()
      toggleSelection(setSelectedEdgeIds, edge.id)
      return
    }
    if (isGroupMember('edge', edge.id)) {
      beginDrag(event, [...corridorGroupNodeIds(corridorEdges, selectedNodeIds, selectedEdgeIds)], [...selectedRoomIds])
      return
    }
    beginDrag(event, [edge.nodeAId, edge.nodeBId])
    setSelectedEdgeIds(new Set([edge.id]))
    setSelectedNodeIds(new Set())
    setSelectedRoomIds(new Set())
  }

  const applyDelta = (event) => {
    const state = dragState.current
    if (!state) return

    const pointerNow = getLayoutPointerPosition(event)
    let deltaX = pointerNow.x - state.startPointerX
    let deltaY = pointerNow.y - state.startPointerY

    if (event.shiftKey && state.anchorNode) {
      const movingId = state.movingNodeIds[0]
      const start = state.startPositions.get(movingId)
      const rawPoint = { x: start.x + deltaX, y: start.y + deltaY }
      const constrained = constrainToAxis(state.anchorNode, rawPoint)
      deltaX = constrained.x - start.x
      deltaY = constrained.y - start.y
    }

    setCorridorNodes((prev) =>
      prev.map((node) => {
        const start = state.startPositions.get(node.id)
        if (!start) return node
        return { ...node, x: start.x + deltaX, y: start.y + deltaY }
      }),
    )

    if (state.roomStartPositions.size > 0) {
      setRoomBoxes((prev) =>
        prev.map((box) => {
          const start = state.roomStartPositions.get(box.id)
          if (!start) return box
          return { ...box, x: start.x + deltaX, y: start.y + deltaY }
        }),
      )
    }
  }

  const handleNodePointerMove = applyDelta
  const handleEdgePointerMove = applyDelta

  const endDrag = (event) => {
    const state = dragState.current
    if (!state) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragState.current = null

    const resolved = resolveCorridorTopology(corridorNodes, corridorEdges)
    setCorridorNodes(resolved.nodes)
    setCorridorEdges(resolved.edges)
  }

  const handleNodePointerUp = endDrag
  const handleEdgePointerUp = endDrag

  return {
    handleNodePointerDown,
    handleNodePointerMove,
    handleNodePointerUp,
    handleEdgePointerDown,
    handleEdgePointerMove,
    handleEdgePointerUp,
  }
}
