import { useRef, useState } from 'react'
import { computeDragSnap } from './geometry.js'

const SNAP_THRESHOLD_PX = 8

// Click-to-select (shift-click to add/remove from a multi-selection) and
// drag-to-move every selected room box together as a group. Movement is
// tracked as a delta from the pointer's position at drag-start rather than a
// per-room "grab offset", so the whole selection translates by the same
// amount regardless of which room in the group was actually grabbed.
export function useRoomDrag({
  roomBoxes,
  setRoomBoxes,
  getLayoutPointerPosition,
  zoom,
  recordHistory,
  corridorSnapCandidates,
}) {
  const corridorX = corridorSnapCandidates?.xCandidates ?? []
  const corridorY = corridorSnapCandidates?.yCandidates ?? []
  const dragState = useRef(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [snapGuides, setSnapGuides] = useState([])

  const handlePointerDown = (event, roomBox) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    if (event.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(roomBox.id)) next.delete(roomBox.id)
        else next.add(roomBox.id)
        return next
      })
      return
    }

    // Clicking a room already part of a multi-selection keeps the group
    // selected and drags all of them; clicking anything else selects just
    // that one room and starts a single-room drag.
    const isGroupMember = selectedIds.has(roomBox.id) && selectedIds.size > 1
    const activeSelection = isGroupMember ? selectedIds : new Set([roomBox.id])
    if (!isGroupMember) setSelectedIds(activeSelection)

    recordHistory()

    const pointerStart = getLayoutPointerPosition(event)
    const startPositions = new Map()
    roomBoxes.forEach((box) => {
      if (activeSelection.has(box.id)) startPositions.set(box.id, { x: box.x, y: box.y })
    })

    dragState.current = {
      primaryId: roomBox.id,
      primaryWidth: roomBox.width,
      primaryHeight: roomBox.height,
      startPointerX: pointerStart.x,
      startPointerY: pointerStart.y,
      startPositions,
    }
  }

  const handlePointerMove = (event) => {
    event.stopPropagation()
    const state = dragState.current
    if (!state) return

    const pointerNow = getLayoutPointerPosition(event)
    let deltaX = pointerNow.x - state.startPointerX
    let deltaY = pointerNow.y - state.startPointerY
    const guides = []

    // Snapping is checked against the primary (clicked) room only, and the
    // resulting adjustment applied to the whole group — snapping every
    // selected room independently would fight itself when several move
    // together.
    const primaryStart = state.startPositions.get(state.primaryId)
    if (primaryStart) {
      const others = roomBoxes.filter((box) => !state.startPositions.has(box.id))
      const threshold = SNAP_THRESHOLD_PX / zoom

      const xSnap = computeDragSnap(
        primaryStart.x + deltaX,
        state.primaryWidth,
        primaryStart.y + deltaY,
        state.primaryHeight,
        [...others.map((box) => ({ min: box.x, size: box.width, crossMin: box.y, crossSize: box.height })), ...corridorX],
        threshold,
      )
      deltaX += xSnap.delta
      if (xSnap.guide) guides.push({ orientation: 'vertical', ...xSnap.guide })

      const ySnap = computeDragSnap(
        primaryStart.y + deltaY,
        state.primaryHeight,
        primaryStart.x + deltaX,
        state.primaryWidth,
        [...others.map((box) => ({ min: box.y, size: box.height, crossMin: box.x, crossSize: box.width })), ...corridorY],
        threshold,
      )
      deltaY += ySnap.delta
      if (ySnap.guide) guides.push({ orientation: 'horizontal', ...ySnap.guide })
    }

    setSnapGuides(guides)
    setRoomBoxes((prev) =>
      prev.map((box) => {
        const start = state.startPositions.get(box.id)
        if (!start) return box
        return { ...box, x: start.x + deltaX, y: start.y + deltaY }
      }),
    )
  }

  const handlePointerUp = (event) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragState.current = null
    setSnapGuides([])
  }

  return { selectedIds, setSelectedIds, snapGuides, handlePointerDown, handlePointerMove, handlePointerUp }
}
