import { memo } from 'react'
import { formatArea, formatDimensions, getContrastTextColor } from './geometry.js'

// Both components take only primitives plus identity-stable callbacks, so
// React.memo can skip every room whose own props didn't change — a pan, zoom,
// selection or single-room drag then re-renders only the rooms it touched
// instead of every card and label on the canvas. Callbacks receive the
// room's id as their last argument rather than closing over a room object,
// which is what lets one stable function serve every room.

export const RoomCard = memo(function RoomCard({
  id,
  x,
  y,
  width,
  height,
  color,
  isViolated,
  isSelected,
  isArranging,
  isCircle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
  onContextMenu,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}) {
  return (
    <div
      className={`room-card${isViolated ? ' room-card--violated' : ''}${isSelected ? ' room-card--selected' : ''}${isArranging ? ' room-card--arranging' : ''}${isCircle ? ' room-card--circle' : ''}`}
      style={{
        width,
        height,
        transform: `translate(${x}px, ${y}px)`,
        ...(color && !isViolated ? { backgroundColor: color } : {}),
      }}
      onPointerDown={(event) => onPointerDown(event, id)}
      onPointerMove={(event) => onPointerMove(event, id)}
      onPointerUp={(event) => onPointerUp(event, id)}
      onDoubleClick={(event) => onDoubleClick(event, id)}
      onContextMenu={(event) => onContextMenu(event, id)}
    >
      {!isArranging && (
        <div
          className="room-card__resize-handle"
          onPointerDown={(event) => onResizePointerDown(event, id)}
          onPointerMove={(event) => onResizePointerMove(event, id)}
          onPointerUp={(event) => onResizePointerUp(event, id)}
        >
          <svg
            className="room-card__resize-icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12H21M3 12L7 8M3 12L7 16M21 12L17 8M21 12L17 16" />
          </svg>
        </div>
      )}
    </div>
  )
})

// Labels are rendered as a separate pass after every card (see RoomCanvas),
// so they always stack above all cards regardless of overlap order, and live
// outside .room-card so text isn't clipped once a card shrinks smaller than
// the text needs. editValue/editAreaValue are only passed to the one room
// being edited, so typing doesn't re-render every other label.
export const RoomLabel = memo(function RoomLabel({
  id,
  roomName,
  x,
  y,
  width,
  height,
  color,
  isViolated,
  labelMode,
  scale,
  dimWidth,
  dimHeight,
  area,
  isEditing,
  editHeightValue,
  editValue,
  onEditHeightChange,
  onEditWidthChange,
  onCommitEdit,
  onCancelEdit,
}) {
  const handleEditKeyDown = (event) => {
    if (event.key === 'Enter') onCommitEdit(id)
    if (event.key === 'Escape') onCancelEdit()
  }

  return (
    <div
      className="room-card-label"
      style={{
        width,
        height,
        fontSize: Math.max(11, Math.min(width, height) / 8),
        transform: `translate(${x}px, ${y}px)`,
        ...(color && !isViolated ? { color: getContrastTextColor(color) } : {}),
      }}
    >
      <span className="room-card__name">{roomName}</span>
      {isEditing ? (
        <div>
          <label className="room-card__dimension-label">
            Set width:
            <input
              type="number"
              className="room-card__dimension-input"
              value={editValue}
              step="0.01"
              min="0"
              autoFocus
              onChange={(event) => onEditWidthChange(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={handleEditKeyDown}
            />
          </label>
          <label className="room-card__dimension-label">
            Set height:
            <input
              type="number"
              className="room-card__dimension-input"
              value={editHeightValue}
              step="0.01"
              min="0"
              onChange={(event) => onEditHeightChange(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={handleEditKeyDown}
            />
          </label>
        </div>
      ) : (
        <span className="room-card__area">
          {labelMode === 'area'
            ? formatArea({ area }, scale)
            : formatDimensions({ width: dimWidth, height: dimHeight }, scale)}
        </span>
      )}
    </div>
  )
})
