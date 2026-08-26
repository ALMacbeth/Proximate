import { useState } from 'react'

// Shown once a chain of points has been placed, asking for the width that
// applies to every edge in that chain (mirrors AddNewConnection's popover
// pattern in RoomCanvas.jsx).
export function CorridorWidthPrompt({ onApply, onCancel }) {
  const [widthMeters, setWidthMeters] = useState(1.2)

  const applyWidth = (e) => {
    e.preventDefault()
    const value = Number(widthMeters)
    if (!Number.isFinite(value) || value <= 0) return
    onApply(value)
  }

  return (
    <div
      className="add_corridor_width_menu"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 12, left: 12, zIndex: 20 }}
    >
      <form
        onSubmit={applyWidth}
        style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg)', padding: 8, borderRadius: 8, boxShadow: 'var(--shadow)' }}
      >
        <p fontSize="12px">Corridor width (m):</p>
        <input
          type="number"
          placeholder="Width"
          value={widthMeters}
          step="any"
          min="0"
          autoFocus
          onChange={(e) => setWidthMeters(e.target.value)}
        />
        <button type="submit">Add Corridor</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  )
}
