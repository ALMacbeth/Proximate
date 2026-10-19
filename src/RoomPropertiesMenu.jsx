import { useEffect, useRef, useState } from 'react'

// Right-click properties popup for a single room, positioned at the cursor.
// Area and minimum dimension are both in metres (m² / m); a blank minimum
// dimension means "no minimum". Applies on Enter or the Apply button, and
// closes on Escape or any pointer press outside it.
function RoomPropertiesMenu({ left, top, initialArea, initialMinWidth, roomName, onApply, onClose }) {
  const [areaValue, setAreaValue] = useState(initialArea)
  const [minWidthValue, setMinWidthValue] = useState(initialMinWidth)
  const menuRef = useRef(null)

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [onClose])

  const area = parseFloat(areaValue)
  const minWidth = minWidthValue.trim() === '' ? undefined : parseFloat(minWidthValue)
  const isAreaValid = Number.isFinite(area) && area > 0
  const isMinWidthValid = minWidth === undefined || (Number.isFinite(minWidth) && minWidth > 0)
  const canApply = isAreaValid && isMinWidthValid

  const apply = () => {
    if (!canApply) return
    onApply({ areaMeters: area, minWidthMeters: minWidth })
    onClose()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') apply()
    if (event.key === 'Escape') onClose()
  }

  return (
    <div
      ref={menuRef}
      className="room_properties_menu"
      role="dialog"
      aria-label={`Properties for ${roomName}`}
      style={{ position: 'absolute', left, top, zIndex: 30 }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <strong className="room_properties_menu__title">{roomName}</strong>
      <label>
        Area (m²)
        <input
          type="number"
          value={areaValue}
          step="0.01"
          min="0"
          autoFocus
          aria-invalid={!isAreaValid}
          onChange={(event) => setAreaValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <label>
        Minimum dimension (m)
        <input
          type="number"
          value={minWidthValue}
          step="0.01"
          min="0"
          placeholder="none"
          aria-invalid={!isMinWidthValid}
          onChange={(event) => setMinWidthValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <div className="room_properties_menu__actions">
        <button type="button" onClick={apply} disabled={!canApply}>
          Apply
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default RoomPropertiesMenu
