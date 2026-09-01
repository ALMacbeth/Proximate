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
  wallOffsetPx = 0,
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

      // Snap the offset wall outline (each edge pushed out by half the wall
      // thickness) rather than the raw room box. Adding the same constant
      // offset to both sides leaves same-side alignment (start-to-start,
      // center-to-center, end-to-end) unchanged, but start-to-end
      // ("placed next to") now correctly requires a gap of a full wall
      // thickness between the raw boxes, so the two rooms' wall outlines
      // end up flush instead of their bare interiors touching.
      const xSnap = computeDragSnap(
        primaryStart.x + deltaX - wallOffsetPx,
        state.primaryWidth + wallOffsetPx * 2,
        primaryStart.y + deltaY - wallOffsetPx,
        state.primaryHeight + wallOffsetPx * 2,
        [
          ...others.map((box) => ({
            min: box.x - wallOffsetPx,
            size: box.width + wallOffsetPx * 2,
            crossMin: box.y - wallOffsetPx,
            crossSize: box.height + wallOffsetPx * 2,
          })),
          ...corridorX,
        ],
        threshold,
      )
      deltaX += xSnap.delta
      if (xSnap.guide) guides.push({ orientation: 'vertical', ...xSnap.guide })

      const ySnap = computeDragSnap(
        primaryStart.y + deltaY - wallOffsetPx,
        state.primaryHeight + wallOffsetPx * 2,
        primaryStart.x + deltaX - wallOffsetPx,
        state.primaryWidth + wallOffsetPx * 2,
        [
          ...others.map((box) => ({
            min: box.y - wallOffsetPx,
            size: box.height + wallOffsetPx * 2,
            crossMin: box.x - wallOffsetPx,
            crossSize: box.width + wallOffsetPx * 2,
          })),
          ...corridorY,
        ],
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
