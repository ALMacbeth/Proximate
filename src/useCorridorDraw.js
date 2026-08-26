import { useEffect, useState } from 'react'
import { constrainToAxis } from './corridorGeometry.js'

const DOUBLE_CLICK_DEDUPE_PX = 6

// Click-to-place-chain-points tool, active only while `activeTool` is
// 'draw-corridor'. Each click adds a point (axis-constrained to the
// previous point when Shift is held); Enter or a double-click commits the
// chain (handing the finished point list to `onCommit`, which is
// responsible for prompting for a width and turning it into real
// corridorNodes/corridorEdges); Escape discards the whole in-progress chain.
export function useCorridorDraw({ activeTool, getLayoutPointerPosition, onCommit, onExitTool }) {
  const [draftPoints, setDraftPoints] = useState([])
  const [cursorPoint, setCursorPoint] = useState(null)

  const isDrawing = activeTool === 'draw-corridor'

  useEffect(() => {
    if (!isDrawing) {
      setDraftPoints([])
      setCursorPoint(null)
    }
  }, [isDrawing])

  const constrainedPoint = (raw, shiftKey) => {
    const anchor = draftPoints[draftPoints.length - 1]
    return anchor && shiftKey ? constrainToAxis(anchor, raw) : raw
  }

  const placePoint = (event) => {
    if (!isDrawing) return
    event.stopPropagation()
    const point = constrainedPoint(getLayoutPointerPosition(event), event.shiftKey)
    setDraftPoints((prev) => [...prev, point])
  }

  const updateCursor = (event) => {
    if (!isDrawing) return
    setCursorPoint(constrainedPoint(getLayoutPointerPosition(event), event.shiftKey))
  }

  const cancelChain = () => {
    setDraftPoints([])
    setCursorPoint(null)
  }

  const commitChain = () => {
    setDraftPoints((prev) => {
      // A double-click's second click already added a point almost on top
      // of the one before it — drop that trailing duplicate rather than
      // committing a near-zero-length final segment.
      let points = prev
      if (points.length >= 2) {
        const last = points[points.length - 1]
        const secondLast = points[points.length - 2]
        if (Math.hypot(last.x - secondLast.x, last.y - secondLast.y) <= DOUBLE_CLICK_DEDUPE_PX) {
          points = points.slice(0, -1)
        }
      }
      if (points.length >= 2) onCommit(points)
      return []
    })
    setCursorPoint(null)
  }

  useEffect(() => {
    if (!isDrawing) return

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return

      // With no chain in progress, Escape/Enter have nothing to
      // cancel/commit — treat them the same as clicking the toolbar
      // button again and leave the tool entirely.
      if (draftPoints.length === 0) {
        onExitTool()
        return
      }

      if (event.key === 'Escape') cancelChain()
      else commitChain()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawing, draftPoints])

  return { isDrawing, draftPoints, cursorPoint, placePoint, updateCursor, commitChain, cancelChain }
}
