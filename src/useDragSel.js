import { useRef, useState } from 'react'

const CLICK_THRESHOLD = 4

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// Click-and-drag on empty canvas background to draw a marquee selection
// rectangle; any room whose box overlaps it becomes selected. Holding Shift
// adds to the existing selection instead of replacing it. A drag that never
// moves more than a few pixels is treated as a plain click on empty space,
// which clears the selection (or leaves it alone, if Shift was held) rather
// than leaving whatever the near-zero rectangle happened to touch.
export function useDragSelect({ roomBoxes, selectedIds, setSelectedIds, getLayoutPointerPosition }) {
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

    const next = new Set(drag.baseSelection)
    roomBoxes.forEach((box) => {
      if (rectsIntersect(rect, box)) next.add(box.id)
    })
    setSelectedIds(next)
  }

  const handlePointerUp = (event) => {
    const drag = dragRef.current
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    const rect = selectionRect
    if (rect && rect.width < CLICK_THRESHOLD && rect.height < CLICK_THRESHOLD) {
      setSelectedIds(drag.baseSelection)
    }

    dragRef.current = null
    setSelectionRect(null)
  }

  return { selectionRect, handlePointerDown, handlePointerMove, handlePointerUp }
}
