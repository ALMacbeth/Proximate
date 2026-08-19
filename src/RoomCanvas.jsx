import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
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
import { useDragSelect } from './useDragSel.js'

function AddNewConnection({ onApply, onClose }) {
    const [toRoomId, setToRoomId] = useState('')
    const [maxDistance, setMaxDistance] = useState(1)
    const applyNewConnections = (e) => {
        e.preventDefault() // stop the native form submit from reloading the page
        onApply({ toRoomName: toRoomId, maxDistance: Number(maxDistance) })
        onClose()
    }


    return (
        <div
            className="add_connection_menu"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}

            style={{ position: 'absolute', top: 12, left: 12, zIndex: 20 }}
        >
            <form onSubmit={applyNewConnections} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg)', padding: 8, borderRadius: 8, boxShadow: 'var(--shadow)' }}>
                <p fontSize="12px" >The currently selected rooms will be linked with:</p>
                <input type="text" placeholder="Target Room Name" value={toRoomId} onChange={(e) => setToRoomId(e.target.value)} />
                <p fontSize="12px" >The maximum allowed seperation (m):</p>
                <input type="number" placeholder="Max Distance" value={maxDistance} onChange={(e) => setMaxDistance(e.target.value)} />
                <button type="submit">Connect</button>
                <button type="button" onClick={onClose}>Cancel</button>

            </form>
        </div>)
}

// Proper React component for the add-room menu. Hooks are allowed here.
function AddRoomMenu({ onAdd, onClose, existingColors, scale }) {
    const [roomName, setRoomName] = useState('')
    const [targetArea, setTargetArea] = useState('')
    const [minWidth, setMinWidth] = useState('')
    const [color, setColor] = useState('')
    const [showColorSwatches, setShowColorSwatches] = useState(false)
    const [showCustomPicker, setShowCustomPicker] = useState(false)
    const [draftColor, setDraftColor] = useState('#000000')

    const swatchColorSelected = (swatch) => {
        setColor(swatch);
        setShowColorSwatches(false);
    }


    const handleAcceptSwatch = () => {
        setColor(draftColor)
        setShowCustomPicker(false)
        setShowColorSwatches(false);

    }
    const handleSubmitNewRoom = (e) => {
        e.preventDefault()
        const targetAreaMeters = Number.parseFloat(targetArea) || 1
        const area = targetAreaMeters * scale * scale

        const id = `room-${Date.now()}`
        // Simple default size based on area; tweak as needed.
        const sizePx = Math.max(40, Math.sqrt(area))
        const newRoom = {
            id,
            roomName: roomName || `Room ${id}`,
            targetArea: targetAreaMeters,
            area,
            width: sizePx,
            height: sizePx,
            x: 20,
            y: 20,

            minWidth: Number.isFinite(Number(minWidth)) ? Number(minWidth) : undefined,
            adjacentRooms: {}, // Add this � empty object for no adjacency rules
            color: color || undefined,
        }
        onAdd(newRoom)
        onClose()
    }



    return (
        <div
            className="add_room_menu"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 12, left: 12, zIndex: 20 }}
        >
            <form onSubmit={handleSubmitNewRoom} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg)', padding: 8, borderRadius: 8, boxShadow: 'var(--shadow)' }}>
                <input type="text" placeholder="Room Name" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
                <input type="number" placeholder="Target Area" value={targetArea} onChange={(e) => setTargetArea(e.target.value)} />
                <input type="number" placeholder="Min Width" value={minWidth} onChange={(e) => setMinWidth(e.target.value)} />
                <span style={{ position: 'relative', display: 'inline-block' }}>
                <button
                    type="button"
                    className={`color-swatch${color === color ? ' color-swatch--selected' : ''}`}
                    style={{ backgroundColor: color }}

                    onClick={() => setShowColorSwatches(true)}
                />
                {existingColors.length > 0 && showColorSwatches && (
                    <div className="color-swatches" style={{ position: 'absolute', top: '100%', display:'flex' , gap: 8, alignItems: 'center', background: 'var(--bg)', padding: 8, borderRadius: 8, boxShadow: 'var(--shadow)' }}>
                        {existingColors.map((swatch) => (
                            <button
                                key={swatch}
                                type="button"
                                className={`color-swatch${color === swatch ? ' color-swatch--selected' : ''}`}
                                style={{ backgroundColor: swatch }}
                                aria-pressed={color === swatch}
                                aria-label={`Use color ${swatch}`}
                                onClick={() => swatchColorSelected(swatch)}
                            />
                            
                        ))}
                            <button type="button" onClick={() => setShowCustomPicker(true)}>
                                New
                            </button>

                            {showCustomPicker && (
                                <div className="custom-picker-panel" style={{ position: 'absolute', top: '100%' }}>
                                    <HexColorPicker color={draftColor} onChange={setDraftColor} />
                                    <button onClick={handleAcceptSwatch}>Accept</button>
                                    <button onClick={() => setShowCustomPicker(false)}>Cancel</button>
                                </div>
                            )}

                        </div>

                    
                    )}
                </span>
                <button type="submit">Add Room</button>
                <button type="button" onClick={onClose}>Cancel</button>
            </form>
        </div>
    )
}

function RoomCanvas({ rooms }) {
  const containerRef = useRef(null)
  const gestureModeRef = useRef(null)
  const [roomBoxes, setRoomBoxes] = useState([])
  const [scale, setScale] = useState(1)
  const [editingId, setEditingId] = useState(null)
    const [editValue, setEditValue] = useState('')
    const [editAreaValue, setEditAreaValue] = useState('')
  const [showAddRoomMenu, setShowAddRoomMenu] = useState(false)
  const [showAddConnectionMenu, setShowAddConnectionMenu] = useState(false)
    

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

  const {
    selectionRect,
    handlePointerDown: handleSelectPointerDown,
    handlePointerMove: handleSelectPointerMove,
    handlePointerUp: handleSelectPointerUp,
  } = useDragSelect({ roomBoxes, selectedIds, setSelectedIds, getLayoutPointerPosition })

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

  // Middle-mouse-button drag on empty canvas background pans the view;
  // left-button drag draws a marquee selection instead. gestureModeRef is
  // set synchronously here (not via React state) so the move/up handlers
  // route correctly even before a re-render lands.
  const handleCanvasPointerDown = (event) => {
    if (event.button === 1) {
      gestureModeRef.current = 'pan'
      handlePanPointerDown(event)
    } else if (event.button === 0) {
      gestureModeRef.current = 'select'
      handleSelectPointerDown(event)
    }
  }

  const deleteSelectedRooms = () => {
    if (selectedIds.size === 0) return
    recordHistory()
    setRoomBoxes((prev) => prev.filter((box) => !selectedIds.has(box.id)))
    setSelectedIds(new Set())
  }


  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      const isEditingText = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isEditingText) return
      deleteSelectedRooms()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const handleCanvasPointerMove = (event) => {
    if (gestureModeRef.current === 'pan') handlePanPointerMove(event)
    else if (gestureModeRef.current === 'select') handleSelectPointerMove(event)
  }

  const handleCanvasPointerUp = (event) => {
    if (gestureModeRef.current === 'pan') handlePanPointerUp(event)
    else if (gestureModeRef.current === 'select') handleSelectPointerUp(event)
    gestureModeRef.current = null
  }

  const handleRoomDoubleClick = (event, roomBox) => {
    event.stopPropagation()
    if (editingId === roomBox.id) return
    setEditingId(roomBox.id)
      setEditValue((roomBox.width / scale).toFixed(2))
      setEditAreaValue((roomBox.area / (scale * scale)).toFixed(2))
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

    const commitAreaEdit = (id) => {
        const areaMeters = parseFloat(editAreaValue)
        if (Number.isFinite(areaMeters) && areaMeters > 0) {
            recordHistory()
            setRoomBoxes((prev) =>
                prev.map((box) => {
                    if (box.id !== id) return box

                    const area = areaMeters * scale * scale
                    // Maintain whatever width is currently shown in the width
                    // input (falling back to the room's existing width if that
                    // field hasn't been touched), and derive height from the
                    // new area — same area/minWidth-bounded math already used
                    // for the resize handle, just solving for height instead.
                    const widthMeters = parseFloat(editValue)
                    const desiredWidth = Number.isFinite(widthMeters) && widthMeters > 0 ? widthMeters * scale : box.width
                    const minWidthPx = Number.isFinite(box.minWidth) && box.minWidth > 0 ? box.minWidth * scale : 0
                    const { width, height } = clampWidthToArea(desiredWidth, area, minWidthPx)

                    return { ...box, targetArea: areaMeters, area, width, height }
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
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
      >
        {roomBoxes.length === 0 && <p className="canvas-empty">Load a file to see your rooms.</p>}

        

              <button
                  className="add_room_button"
                  onPointerDown={(e) => {
                      e.stopPropagation()

                  }}
                  onClick={(e) => {
                      e.stopPropagation()

                      setShowAddRoomMenu(true)

                  }}
                  style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}
              >
                  +
              </button>
              {selectedIds.size > 0 && (
                  <button
                      className="add_connection_button"
                      onPointerDown={(e) => {
                          e.stopPropagation()

                      }}
                      onClick={(e) => {
                          e.stopPropagation()

                          setShowAddConnectionMenu(true)

                      }}
                      style={{ fontSize:"14px", position: 'absolute', top: 12, left: 12, zIndex: 10 }}
                  >
                      Add a connection to the selected {selectedIds.size>1 ? 'rooms' : 'room'}
                  </button>)}


        {showAddRoomMenu && (
          <>


                      <AddRoomMenu
                          scale={scale}
              existingColors={[...new Set(roomBoxes.map((box) => box.color).filter(Boolean))]}
              onAdd={(newRoom) => {

                recordHistory()
                setRoomBoxes((prev) => [...prev, newRoom])
              }}
              onClose={() => {

                setShowAddRoomMenu(false)
              }}
            />
          </>
              )}

              {showAddConnectionMenu && (
                  <AddNewConnection
                      onApply={({ toRoomName, maxDistance }) => {
                          recordHistory()
                          setRoomBoxes((prev) =>
                              prev.map((box) =>
                                  selectedIds.has(box.id)
                                      ? { ...box, adjacentRooms: { ...box.adjacentRooms, [toRoomName]: maxDistance } }
                                      : box,
                              ),
                          )
                      }}
                      onClose={() => setShowAddConnectionMenu(false)}
                  />
              )}


        <div
          className="canvas-content"
          style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` }}
        >
                  
          {selectionRect && (
            <div
              className="selection-rect"
              style={{
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
                position: 'absolute',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            />
          )}
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
                      <div>
                      <>
                  <label className="room-card__dimension-label">
                  Set Area:
                  <input
                    type="number"
                    className="room-card__area-input"
                    value={editAreaValue}
                    step="0.01"
                    min="0"
                    autoFocus
                    onChange={(event) => setEditAreaValue(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') commitWidthEdit(roomBox.id), commitAreaEdit(roomBox.id)
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                </label>
                <label className="room-card__dimension-label">
                  Set width:
                  <input
                    type="number"
                    className="room-card__dimension-input"
                    value={editValue}
                    step="0.01"
                    min="0"
                    onChange={(event) => setEditValue(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            commitWidthEdit(roomBox.id), commitAreaEdit(roomBox.id)
                        }
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                </label>
                      </>
                </div>
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
