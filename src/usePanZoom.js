import { useEffect, useRef, useState } from 'react'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_SPEED = 0.001

// Wheel-to-zoom (anchored at the pointer) and click-drag-to-pan for the room
// canvas. `containerRef` must point to the outer, unscaled canvas element —
// not the transformed content layer — since pan/zoom math measures pointer
// position against that element's own (never-scaled) bounding box.
export function usePanZoom(containerRef) {
  const panState = useRef(null)
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [isPanning, setIsPanning] = useState(false)

  const resetView = () => setView({ zoom: 1, pan: { x: 0, y: 0 } })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // React's JSX onWheel handler is registered as a passive listener, so
    // calling preventDefault() inside it is silently ignored and the page
    // scrolls instead of zooming. A manually-attached listener with
    // { passive: false } is required to actually block the default scroll.
    const handleWheel = (event) => {
      event.preventDefault()
      const containerRect = container.getBoundingClientRect()
      const pointerX = event.clientX - containerRect.left
      const pointerY = event.clientY - containerRect.top

      setView((prev) => {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom - event.deltaY * ZOOM_SPEED))
        // Solves for the pan offset that keeps the point under the pointer
        // fixed on screen as zoom changes, so zooming expands from wherever
        // the cursor is rather than a fixed corner.
        const ratio = nextZoom / prev.zoom
        return {
          zoom: nextZoom,
          pan: {
            x: pointerX - ratio * (pointerX - prev.pan.x),
            y: pointerY - ratio * (pointerY - prev.pan.y),
          },
        }
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [containerRef])

  // Converts a pointer event's screen position into the canvas's own
  // unscaled, unpanned coordinate space — the space room box x/y values live
  // in — by undoing the current pan translate and zoom scale.
  const getLayoutPointerPosition = (event) => {
    const containerRect = containerRef.current.getBoundingClientRect()
    return {
      x: (event.clientX - containerRect.left - view.pan.x) / view.zoom,
      y: (event.clientY - containerRect.top - view.pan.y) / view.zoom,
    }
  }

  const handlePanPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    panState.current = { startX: event.clientX, startY: event.clientY, startPan: view.pan }
    setIsPanning(true)
  }

  const handlePanPointerMove = (event) => {
    if (!panState.current) return
    const { startX, startY, startPan } = panState.current
    setView((prev) => ({
      ...prev,
      pan: {
        x: startPan.x + (event.clientX - startX),
        y: startPan.y + (event.clientY - startY),
      },
    }))
  }

  const handlePanPointerUp = (event) => {
    if (!panState.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    panState.current = null
    setIsPanning(false)
  }

  return {
    view,
    isPanning,
    resetView,
    getLayoutPointerPosition,
    handlePanPointerDown,
    handlePanPointerMove,
    handlePanPointerUp,
  }
}
