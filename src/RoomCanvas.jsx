import { useLayoutEffect, useRef, useState } from 'react'
import { buildDxf } from './dxfExport.js'
import { downloadFile } from './download.js'
import {
  computeScale,
  computeRoomBoxes,
  packRoomBoxes,
  computeConnections,
  clampWidthToArea,
  formatDimensions,
  getContrastTextColor,
} from './geometry.js'
import { usePanZoom } from './usePanZoom.js'
import { useRoomDrag } from './useRoomDrag.js'
import { useRoomResize } from './useRoomResize.js'
import { useUndoHistory } from './useUndoHistory.js'

function RoomCanvas({ rooms }) {
  const containerRef = useRef(null)
  const [roomBoxes, setRoomBoxes] = useState([])
  const [scale, setScale] = useState(1)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')

  const { view, isPanning, resetView, getLayoutPointerPosition, handlePanPointerDown, handlePanPointerMove, handlePanPointerUp } =
    usePanZoom(containerRef)

  const { recordHistory, clearHistory } = useUndoHistory(roomBoxes, setRoomBoxes)

  const {
    selectedIds,
    setSelectedIds,
    snapGuides: dragSnapGuides,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useRoomDrag({
    roomBoxes,
    setRoomBoxes,
    getLayoutPointerPosition,
    zoom: view.zoom,
    recordHistory,
  })

  const {
    handleResizePointerDown,
    handleResizePointerMove,
    handleResizePointerUp,
    snapGuides: resizeSnapGuides,
  } = useRoomResize({
    roomBoxes,
    setRoomBoxes,
    scale,
    zoom: view.zoom,
    recordHistory,
  })

  const snapGuides = [...dragSnapGuides, ...resizeSnapGuides]

  useLayoutEffect(() => {
    // A fresh file (or reset) invalidates any history from whatever was
    // loaded before it, so undo can't reach back into a different room set.
    clearHistory()

    if (rooms.length === 0) {
      setRoomBoxes([])
      setScale(1)
      resetView()
      return
    }
    const computedScale = computeScale(rooms)
    setScale(computedScale)

    // A previously exported layout JSON already carries x/y/width/height (and
    // area) for every room, so re-importing it should restore that exact
    // arrangement instead of re-running the fresh-import packing layout.
    const hasSavedLayout = rooms.every(
      (room) =>
        Number.isFinite(room.x) &&
        Number.isFinite(room.y) &&
        Number.isFinite(room.width) &&
        Number.isFinite(room.height),
    )

    if (hasSavedLayout) {
      setRoomBoxes(rooms.map((room) => ({ ...room })))
    } else {
      const width = containerRef.current?.clientWidth || 800
      setRoomBoxes(packRoomBoxes(computeRoomBoxes(rooms, computedScale), width))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms])

  // Clicking empty canvas background (not shift-held) deselects, matching
  // the usual "click empty space to deselect" convention alongside panning.
  const handleCanvasPointerDown = (event) => {
    if (!event.shiftKey) setSelectedIds(new Set())
    handlePanPointerDown(event)
  }

  const handleRoomDoubleClick = (event, roomBox) => {
    event.stopPropagation()
    if (editingId === roomBox.id) return
    setEditingId(roomBox.id)
    setEditValue((roomBox.width / scale).toFixed(2))
  }

  const commitWidthEdit = (id) => {
    const widthMeters = parseFloat(editValue)
    if (Number.isFinite(widthMeters) && widthMeters > 0) {
      recordHistory()
      setRoomBoxes((prev) =>
        prev.map((box) => {
          if (box.id !== id) return box
          const minWidthPx = Number.isFinite(box.minWidth) && box.minWidth > 0 ? box.minWidth * scale : 0
          const { width, height } = clampWidthToArea(widthMeters * scale, box.area, minWidthPx)
          return { ...box, width, height }
        }),
      )
    }
    setEditingId(null)
  }

  const connections = computeConnections(roomBoxes, scale)
  const violatedIds = new Set(connections.filter((c) => c.violated).flatMap((c) => [c.from.id, c.to.id]))

  const handleExportDxf = () => {
    const dxf = buildDxf({ rooms: roomBoxes, connections, violatedIds, scale })
    downloadFile(dxf, 'room-layout.dxf', 'application/dxf')
  }

  const handleExportJson = () => {
    downloadFile(JSON.stringify(roomBoxes, null, 2), 'room-layout.json', 'application/json')
    }



  return (
    <>
      {roomBoxes.length > 0 && (
        <div className="export-actions">
          <button type="button" className="export-button" onClick={handleExportDxf}>
            Export as CAD (.dxf)
          </button>
          <button type="button" className="export-button" onClick={handleExportJson}>
            Save layout file (.json)
          </button>
              </div>

      )}
      <div
        className={`canvas${isPanning ? ' canvas--panning' : ''}`}
        ref={containerRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerUp}
      >
        {roomBoxes.length === 0 && <p className="canvas-empty">Load a file to see your rooms.</p>}
        {/* Pan handlers live on this outer, never-scaled .canvas element
           rather than .canvas-content below: a CSS-transformed element's own
           hit-test box shrinks/grows with its visual scale, so panning would
           stop registering past its shrunk edges once zoomed out. */}
        <div
          className="canvas-content"
          style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` }}
        >
          <svg className="canvas-lines">
            {connections.map((connection) => (
              <line
                key={connection.id}
                x1={connection.fromPoint.x}
                y1={connection.fromPoint.y}
                x2={connection.toPoint.x}
                y2={connection.toPoint.y}
                className={`connection${connection.violated ? ' connection--violated' : ' connection--ok'}`}
              />
            ))}
            {snapGuides.map((guide, index) => (
              <line
                key={`snap-guide-${index}`}
                x1={guide.orientation === 'vertical' ? guide.position : guide.from}
                y1={guide.orientation === 'vertical' ? guide.from : guide.position}
                x2={guide.orientation === 'vertical' ? guide.position : guide.to}
                y2={guide.orientation === 'vertical' ? guide.to : guide.position}
                className="snap-guide"
              />
            ))}
          </svg>
          {roomBoxes.map((roomBox) => (
            <div
              key={roomBox.id}
              className={`room-card${violatedIds.has(roomBox.id) ? ' room-card--violated' : ''}${selectedIds.has(roomBox.id) ? ' room-card--selected' : ''}`}
              style={{
                width: roomBox.width,
                height: roomBox.height,
                transform: `translate(${roomBox.x}px, ${roomBox.y}px)`,
                ...(roomBox.color && !violatedIds.has(roomBox.id) ? { backgroundColor: roomBox.color } : {}),
              }}
              onPointerDown={(event) => handlePointerDown(event, roomBox)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={(event) => handleRoomDoubleClick(event, roomBox)}
            >
              <div
                className="room-card__resize-handle"
                onPointerDown={(event) => handleResizePointerDown(event, roomBox)}
                onPointerMove={(event) => handleResizePointerMove(event, roomBox.id)}
                onPointerUp={(event) => handleResizePointerUp(event, roomBox.id)}
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
            </div>
          ))}
          {/* Rendered as a second pass, after every room card, so labels
             always stack above all cards regardless of overlap order. They
             also live outside .room-card entirely (not just visually on
             top), since text nested inside a clipped card gets cut off once
             the card shrinks smaller than the text needs. */}
          {roomBoxes.map((roomBox) => (
            <div
              key={`${roomBox.id}-label`}
              className="room-card-label"
              style={{
                width: roomBox.width,
                height: roomBox.height,
                fontSize: Math.max(11, Math.min(roomBox.width, roomBox.height) / 8),
                transform: `translate(${roomBox.x}px, ${roomBox.y}px)`,
                ...(roomBox.color && !violatedIds.has(roomBox.id)
                  ? { color: getContrastTextColor(roomBox.color) }
                  : {}),
              }}
            >
              <span className="room-card__name">{roomBox.roomName}</span>
              {editingId === roomBox.id ? (
                <label className="room-card__dimension-label">
                  Set width:
                  <input
                    type="number"
                    className="room-card__dimension-input"
                    value={editValue}
                    step="0.01"
                    min="0"
                    autoFocus
                    onChange={(event) => setEditValue(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => commitWidthEdit(roomBox.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitWidthEdit(roomBox.id)
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                </label>
              ) : (
                <span className="room-card__area">{formatDimensions(roomBox, scale)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default RoomCanvas
