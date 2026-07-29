import { useRef } from 'react'
import { clampWidthToArea } from './geometry.js'

// Dragging the resize handle sets a room box's width directly; height is
// derived via clampWidthToArea to keep the room's area constant.
export function useRoomResize({ setRoomBoxes, scale, zoom }) {
  const resizeState = useRef({})

  const handleResizePointerDown = (event, roomBox) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeState.current[roomBox.id] = {
      startX: event.clientX,
      startWidth: roomBox.width,
      area: roomBox.area,
      minWidth: roomBox.minWidth,
    }
  }

  const handleResizePointerMove = (event, id) => {
    event.stopPropagation()
    const state = resizeState.current[id]
    if (!state) return

    const minWidthPx = Number.isFinite(state.minWidth) && state.minWidth > 0 ? state.minWidth * scale : 0
    const desiredWidth = state.startWidth + (event.clientX - state.startX) / zoom
    const { width, height } = clampWidthToArea(desiredWidth, state.area, minWidthPx)

    setRoomBoxes((prev) => prev.map((box) => (box.id === id ? { ...box, width, height } : box)))
  }

  const handleResizePointerUp = (event, id) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    delete resizeState.current[id]
  }

  return { handleResizePointerDown, handleResizePointerMove, handleResizePointerUp }
}
