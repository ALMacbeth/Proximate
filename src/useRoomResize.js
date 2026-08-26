import { useRef, useState } from 'react'
import { clampWidthToArea, computeResizeSnap } from './geometry.js'

const SNAP_THRESHOLD_PX = 8

// Dragging the resize handle sets a room box's width directly; height is
// derived via clampWidthToArea to keep the room's area constant.
export function useRoomResize({ roomBoxes, setRoomBoxes, scale, zoom, recordHistory, corridorSnapCandidates }) {
  const resizeState = useRef({})
  const [snapGuides, setSnapGuides] = useState([])
  const corridorX = corridorSnapCandidates?.xCandidates ?? []

  const handleResizePointerDown = (event, roomBox) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    recordHistory()
    resizeState.current[roomBox.id] = {
      startX: event.clientX,
      startWidth: roomBox.width,
      area: roomBox.area,
      minWidth: roomBox.minWidth,
      x: roomBox.x,
      y: roomBox.y,
      height: roomBox.height,
    }
  }

  const handleResizePointerMove = (event, id) => {
    event.stopPropagation()
    const state = resizeState.current[id]
    if (!state) return

    const minWidthPx = Number.isFinite(state.minWidth) && state.minWidth > 0 ? state.minWidth * scale : 0
    const desiredWidth = state.startWidth + (event.clientX - state.startX) / zoom

    // The room's left edge (state.x) is anchored during resize — only the
    // right edge (x + width) moves — so snapping only checks that edge
    // against other rooms' edges/centers, unlike drag which snaps a whole box.
    const others = roomBoxes
      .filter((box) => box.id !== id)
      .map((box) => ({ min: box.x, size: box.width, crossMin: box.y, crossSize: box.height }))
    const threshold = SNAP_THRESHOLD_PX / zoom
    const { delta, guide } = computeResizeSnap(state.x, desiredWidth, state.y, state.height, [...others, ...corridorX], threshold)
    setSnapGuides(guide ? [{ orientation: 'vertical', ...guide }] : [])

    const { width, height } = clampWidthToArea(desiredWidth + delta, state.area, minWidthPx)
    setRoomBoxes((prev) => prev.map((box) => (box.id === id ? { ...box, width, height } : box)))
  }

  const handleResizePointerUp = (event, id) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    delete resizeState.current[id]
    setSnapGuides([])
  }

  return { handleResizePointerDown, handleResizePointerMove, handleResizePointerUp, snapGuides }
}
