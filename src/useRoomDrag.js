import { useRef, useState } from 'react'

// Click-to-select (shift-click to add/remove from a multi-selection) and
// drag-to-move every selected room box together as a group. Movement is
// tracked as a delta from the pointer's position at drag-start rather than a
// per-room "grab offset", so the whole selection translates by the same
// amount regardless of which room in the group was actually grabbed.
export function useRoomDrag({ roomBoxes, setRoomBoxes, getLayoutPointerPosition }) {
  const dragState = useRef(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

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

    const pointerStart = getLayoutPointerPosition(event)
    const startPositions = new Map()
    roomBoxes.forEach((box) => {
      if (activeSelection.has(box.id)) startPositions.set(box.id, { x: box.x, y: box.y })
    })

    dragState.current = {
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
    const deltaX = pointerNow.x - state.startPointerX
    const deltaY = pointerNow.y - state.startPointerY

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
  }

  return { selectedIds, setSelectedIds, handlePointerDown, handlePointerMove, handlePointerUp }
}
