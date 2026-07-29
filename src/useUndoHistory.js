import { useEffect, useRef } from 'react'

const MAX_HISTORY = 50

// Tracks past `roomBoxes` snapshots for Ctrl/Cmd+Z undo. Callers record a
// snapshot themselves right before a discrete action (drag, resize, width
// edit) starts changing state — not on every intermediate update — so one
// undo step reverts one whole gesture, not one per pointermove frame.
export function useUndoHistory(roomBoxes, setRoomBoxes) {
  const historyRef = useRef([])
  const roomBoxesRef = useRef(roomBoxes)
  roomBoxesRef.current = roomBoxes

  const recordHistory = () => {
    historyRef.current.push(roomBoxesRef.current)
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift()
  }

  const clearHistory = () => {
    historyRef.current = []
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      const isUndoShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
      if (!isUndoShortcut) return

      // Let the browser's native text-field undo work normally while typing
      // (e.g. in the width-edit input) instead of hijacking it.
      const target = event.target
      const isEditingText = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isEditingText) return

      const previous = historyRef.current.pop()
      if (!previous) return
      event.preventDefault()
      setRoomBoxes(previous)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setRoomBoxes])

  return { recordHistory, clearHistory }
}
