import { useState } from 'react'

// Shown once a dropped PDF's first page has been rendered, asking for the
// drawing scale it was plotted at (e.g. 500 for a 1:500 drawing) so the
// underlay can be sized in the same meters-to-px space as rooms and
// corridors (mirrors CorridorWidthPrompt's popover pattern) — the real-world
// size is the page's own printed size times this ratio, computed by the
// caller from the PDF's actual page dimensions.
export function UnderlayScalePrompt({ onApply, onCancel }) {
  const [scaleRatio, setScaleRatio] = useState(100)

  const applyScale = (e) => {
    e.preventDefault()
    const value = Number(scaleRatio)
    if (!Number.isFinite(value) || value <= 0) return
    onApply(value)
  }

  return (
    <div
      className="underlay_scale_menu"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 12, left: 12, zIndex: 20 }}
    >
      <form
        onSubmit={applyScale}
        style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg)', padding: 8, borderRadius: 8, boxShadow: 'var(--shadow)' }}
      >
        <p fontSize="12px">Drawing scale — enter 500 for a 1:500 drawing:</p>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          1 :
          <input
            type="number"
            placeholder="Scale"
            value={scaleRatio}
            step="any"
            min="0"
            autoFocus
            onChange={(e) => setScaleRatio(e.target.value)}
          />
        </span>
        <button type="submit">Place Underlay</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  )
}
