import { useEffect, useRef } from 'react'

const MAX_HISTORY = 50

// Tracks past snapshots of one or more named state slices for Ctrl/Cmd+Z
// undo, e.g. useUndoHistory({ roomBoxes: [roomBoxes, setRoomBoxes],
// corridorNodes: [corridorNodes, setCorridorNodes] }). Callers record a
// snapshot themselves right before a discrete action (drag, resize, width
// edit) starts changing state — not on every intermediate update — so one
// undo step reverts one whole gesture (across every slice at once, not
// per-slice) rather than one per pointermove frame.
export function useUndoHistory(slices) {
  const historyRef = useRef([])
  const slicesRef = useRef(slices)
  slicesRef.current = slices

  const recordHistory = () => {
    const snapshot = {}
    Object.entries(slicesRef.current).forEach(([key, [value]]) => {
      snapshot[key] = value
    })
    historyRef.current.push(snapshot)
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift()
  }

  const clearHistory = () => {
    historyRef.current = []
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      const isUndoShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'
      if (!isUndoShortcut) return

      // Let the browser's native text-field undo work normally while typing
      // (e.g. in the width-edit input) instead of hijacking it.
      const target = event.target
      const isEditingText = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isEditingText) return

      const previous = historyRef.current.pop()
      if (!previous) return
      event.preventDefault()
      Object.entries(slicesRef.current).forEach(([key, [, setValue]]) => {
        if (key in previous) setValue(previous[key])
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return { recordHistory, clearHistory }
}
