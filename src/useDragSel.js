import { useRef, useState } from 'react'

const CLICK_THRESHOLD = 4

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

// An edge has no single box of its own, so its two endpoints' bounding box
// stands in for it — the same coarse "does the box overlap" test rooms
// already use, not an exact line-segment intersection.
function edgeBoundingBox(nodeA, nodeB) {
  const x = Math.min(nodeA.x, nodeB.x)
  const y = Math.min(nodeA.y, nodeB.y)
  return { x, y, width: Math.max(nodeA.x, nodeB.x) - x, height: Math.max(nodeA.y, nodeB.y) - y }
}

// Click-and-drag on empty canvas background to draw a marquee selection
// rectangle; any room, corridor node, or corridor edge whose geometry
// overlaps it becomes selected. Holding Shift adds to the existing
// selection instead of replacing it. A drag that never moves more than a
// few pixels is treated as a plain click on empty space, which clears the
// selection (or leaves it alone, if Shift was held) rather than leaving
// whatever the near-zero rectangle happened to touch.
export function useDragSelect({
  roomBoxes,
  selectedIds,
  setSelectedIds,
  corridorNodes,
  corridorEdges,
  selectedCorridorNodeIds,
  setSelectedCorridorNodeIds,
  selectedCorridorEdgeIds,
  setSelectedCorridorEdgeIds,
  getLayoutPointerPosition,
}) {
  const dragRef = useRef(null)
  const [selectionRect, setSelectionRect] = useState(null)

  const handlePointerDown = (event) => {
    // Without this, the browser can start its own native drag/text-selection
    // gesture on mousedown+move — showing a "no-drop" cursor and suppressing
    // our pointermove events until release, which is why the selection box
    // would only appear to "catch up" on pointerup instead of live-updating.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = getLayoutPointerPosition(event)
    dragRef.current = {
      start,
      baseSelection: event.shiftKey ? new Set(selectedIds) : new Set(),
      baseNodeSelection: event.shiftKey ? new Set(selectedCorridorNodeIds) : new Set(),
      baseEdgeSelection: event.shiftKey ? new Set(selectedCorridorEdgeIds) : new Set(),
    }
    setSelectionRect({ x: start.x, y: start.y, width: 0, height: 0 })
  }

  const handlePointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return

    const current = getLayoutPointerPosition(event)
    const rect = {
      x: Math.min(drag.start.x, current.x),
      y: Math.min(drag.start.y, current.y),
      width: Math.abs(current.x - drag.start.x),
      height: Math.abs(current.y - drag.start.y),
    }
    setSelectionRect(rect)

    const nextRooms = new Set(drag.baseSelection)
    roomBoxes.forEach((box) => {
      if (rectsIntersect(rect, box)) nextRooms.add(box.id)
    })
    setSelectedIds(nextRooms)

    const nextNodes = new Set(drag.baseNodeSelection)
    corridorNodes.forEach((node) => {
      if (pointInRect(node, rect)) nextNodes.add(node.id)
    })
    setSelectedCorridorNodeIds(nextNodes)

    // Nodes take priority over edges: an edge's bounding box test above is
    // coarse (it's the box spanning both endpoints, not the edge's actual
    // shape), so a marquee that merely touches a node reliably also
    // "touches" every edge attached to it. Once that node is captured,
    // skip its edges rather than select both — a marquee meant to grab one
    // node shouldn't also sweep in its whole surrounding network.
    const nextEdges = new Set(drag.baseEdgeSelection)
    corridorEdges.forEach((edge) => {
      if (nextNodes.has(edge.nodeAId) || nextNodes.has(edge.nodeBId)) return
      const nodeA = corridorNodes.find((n) => n.id === edge.nodeAId)
      const nodeB = corridorNodes.find((n) => n.id === edge.nodeBId)
      if (!nodeA || !nodeB) return
      if (rectsIntersect(rect, edgeBoundingBox(nodeA, nodeB))) nextEdges.add(edge.id)
    })
    setSelectedCorridorEdgeIds(nextEdges)
  }

  const handlePointerUp = (event) => {
    const drag = dragRef.current
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    const rect = selectionRect
    if (rect && rect.width < CLICK_THRESHOLD && rect.height < CLICK_THRESHOLD) {
      setSelectedIds(drag.baseSelection)
      setSelectedCorridorNodeIds(drag.baseNodeSelection)
      setSelectedCorridorEdgeIds(drag.baseEdgeSelection)
    }

    dragRef.current = null
    setSelectionRect(null)
  }

  return { selectionRect, handlePointerDown, handlePointerMove, handlePointerUp }
}
