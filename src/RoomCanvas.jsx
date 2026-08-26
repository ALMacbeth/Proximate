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
import {
  computeEdgeOffsetPolygon,
  computeJunctionFill,
  computeNodeDegrees,
  computeCorridorRoomSnapCandidates,
  resolveCorridorTopology,
} from './corridorGeometry.js'
import { usePanZoom } from './usePanZoom.js'
import { useRoomDrag } from './useRoomDrag.js'
import { useRoomResize } from './useRoomResize.js'
import { useUndoHistory } from './useUndoHistory.js'
import { useDragSelect } from './useDragSel.js'
import { useCorridorDraw } from './useCorridorDraw.js'
import { useCorridorDrag } from './useCorridorDrag.js'
import { CorridorWidthPrompt } from './CorridorMenus.jsx'
import { UnderlayScalePrompt } from './UnderlayMenus.jsx'
import { renderPdfFirstPageToImage, pointsToMeters } from './pdfUnderlay.js'

const NODE_HIT_RADIUS_SCREEN_PX = 10
const PDF_FILE_PATTERN = /\.pdf$/i

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

function RoomCanvas({ rooms, corridorNodes: initialCorridorNodes, corridorEdges: initialCorridorEdges, initialUnderlayFile }) {
  const containerRef = useRef(null)
  const gestureModeRef = useRef(null)
  const [roomBoxes, setRoomBoxes] = useState([])
  const [scale, setScale] = useState(1)
  const [editingId, setEditingId] = useState(null)
    const [editValue, setEditValue] = useState('')
    const [editAreaValue, setEditAreaValue] = useState('')
  const [showAddRoomMenu, setShowAddRoomMenu] = useState(false)
  const [showAddConnectionMenu, setShowAddConnectionMenu] = useState(false)
  const [activeTool, setActiveTool] = useState('select')
  const [corridorNodes, setCorridorNodes] = useState([])
  const [corridorEdges, setCorridorEdges] = useState([])
  const [showCorridorWidthPrompt, setShowCorridorWidthPrompt] = useState(false)
  const [corridorWidthMeters, setCorridorWidthMeters] = useState(null)
  const [editingCorridorEdgeId, setEditingCorridorEdgeId] = useState(null)
  const [editingCorridorWidthValue, setEditingCorridorWidthValue] = useState('')
  const [underlay, setUnderlay] = useState(null)
  const [pendingUnderlayImage, setPendingUnderlayImage] = useState(null)
  const [underlayError, setUnderlayError] = useState('')

  const { view, isPanning, resetView, getLayoutPointerPosition, handlePanPointerDown, handlePanPointerMove, handlePanPointerUp } =
    usePanZoom(containerRef)

  const { recordHistory, clearHistory } = useUndoHistory({
    roomBoxes: [roomBoxes, setRoomBoxes],
    corridorNodes: [corridorNodes, setCorridorNodes],
    corridorEdges: [corridorEdges, setCorridorEdges],
  })

  const corridorSnapCandidates = computeCorridorRoomSnapCandidates(corridorNodes, corridorEdges, scale)

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
    corridorSnapCandidates,
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
    corridorSnapCandidates,
  })

  const snapGuides = [...dragSnapGuides, ...resizeSnapGuides]

  const {
    selectedNodeIds: selectedCorridorNodeIds,
    setSelectedNodeIds: setSelectedCorridorNodeIds,
    selectedEdgeIds: selectedCorridorEdgeIds,
    setSelectedEdgeIds: setSelectedCorridorEdgeIds,
    handleNodePointerDown: handleCorridorNodePointerDown,
    handleNodePointerMove: handleCorridorNodePointerMove,
    handleNodePointerUp: handleCorridorNodePointerUp,
    handleEdgePointerDown: handleCorridorEdgePointerDown,
    handleEdgePointerMove: handleCorridorEdgePointerMove,
    handleEdgePointerUp: handleCorridorEdgePointerUp,
  } = useCorridorDrag({
    corridorNodes,
    setCorridorNodes,
    corridorEdges,
    setCorridorEdges,
    getLayoutPointerPosition,
    recordHistory,
  })

  const {
    selectionRect,
    handlePointerDown: handleSelectPointerDown,
    handlePointerMove: handleSelectPointerMove,
    handlePointerUp: handleSelectPointerUp,
  } = useDragSelect({
    roomBoxes,
    selectedIds,
    setSelectedIds,
    corridorNodes,
    corridorEdges,
    selectedCorridorNodeIds,
    setSelectedCorridorNodeIds,
    selectedCorridorEdgeIds,
    setSelectedCorridorEdgeIds,
    getLayoutPointerPosition,
  })

  const clearCorridorSelection = () => {
    setSelectedCorridorNodeIds(new Set())
    setSelectedCorridorEdgeIds(new Set())
  }

  // Shared by the toolbar toggle button and by Escape/Enter (when pressed
  // with no chain in progress) so both exit the tool identically.
  const exitCorridorDrawTool = () => {
    setActiveTool('select')
    clearCorridorSelection()
  }

  const {
    isDrawing: isDrawingCorridor,
    draftPoints,
    cursorPoint,
    placePoint,
    updateCursor,
    commitChain,
    cancelChain,
  } = useCorridorDraw({
    activeTool,
    getLayoutPointerPosition,
    // Width was already collected up front (before drawing started, via the
    // showCorridorWidthPrompt flow below), so a finished chain can be turned
    // straight into real nodes/edges without a second prompt.
    onCommit: (points) => {
      recordHistory()
      const newNodes = points.map((point, index) => ({
        id: `corridor-node-${Date.now()}-${index}`,
        x: point.x,
        y: point.y,
      }))
      const newEdges = newNodes.slice(1).map((node, index) => ({
        id: `corridor-edge-${Date.now()}-${index}`,
        nodeAId: newNodes[index].id,
        nodeBId: node.id,
        widthMeters: corridorWidthMeters,
      }))
      const resolved = resolveCorridorTopology([...corridorNodes, ...newNodes], [...corridorEdges, ...newEdges])
      setCorridorNodes(resolved.nodes)
      setCorridorEdges(resolved.edges)
      setCorridorWidthMeters(null)
      exitCorridorDrawTool()
    },
    onExitTool: exitCorridorDrawTool,
  })

  useLayoutEffect(() => {
    // A fresh file (or reset) invalidates any history from whatever was
    // loaded before it, so undo can't reach back into a different room set.
    clearHistory()

    if (rooms.length === 0) {
      setRoomBoxes([])
      setScale(1)
      setCorridorNodes([])
      setCorridorEdges([])
      resetView()
      return
    }
    const computedScale = computeScale(rooms)
    setScale(computedScale)
    setCorridorNodes(initialCorridorNodes ?? [])
    setCorridorEdges(initialCorridorEdges ?? [])

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

  // With no rooms to derive a scale from, an underlay needs *some* scale to
  // render at. Deriving it from the underlay's own real-world size (fitting
  // the whole page into a fixed pixel width) meant any room added
  // afterward inherited that same scale — and a real, to-scale drawing can
  // span hundreds of meters, which produces a tiny px-per-meter ratio that
  // makes every room look microscopic. Use the same px-per-meter a
  // normally-sized room would get from computeScale instead, so rooms
  // added later still look reasonable; the underlay itself may then span
  // many screen-widths, which is what panning/zooming is for.
  // Only when rooms are empty: once real rooms exist they're the
  // authoritative source for scale, exactly as a manually-added room never
  // retroactively rescales an existing loaded layout either.
  useEffect(() => {
    if (rooms.length === 0 && underlay) {
      const REFERENCE_ROOM_AREA_SQM = 20
      setScale(computeScale([{ targetArea: REFERENCE_ROOM_AREA_SQM }]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlay])

  const processUnderlayFile = async (file) => {
    setUnderlayError('')
    try {
      const rendered = await renderPdfFirstPageToImage(file)
      setPendingUnderlayImage(rendered)
    } catch (err) {
      console.error('Failed to render PDF underlay:', err)
      setUnderlayError('Could not read that PDF.')
    }
  }

  useEffect(() => {
    if (initialUnderlayFile) processUnderlayFile(initialUnderlayFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUnderlayFile])

  const handleCanvasDragOver = (event) => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }

  const handleCanvasDrop = (event) => {
    const file = event.dataTransfer.files?.[0]
    if (!file || !PDF_FILE_PATTERN.test(file.name)) return
    event.preventDefault()
    processUnderlayFile(file)
  }

  // Middle-mouse-button drag on empty canvas background pans the view;
  // left-button drag draws a marquee selection instead, unless the
  // draw-corridor tool is armed, in which case a left click places the next
  // chain point instead. gestureModeRef is set synchronously here (not via
  // React state) so the move/up handlers route correctly even before a
  // re-render lands.
  const handleCanvasPointerDown = (event) => {
    if (isDrawingCorridor) {
      if (event.button === 0) placePoint(event)
      return
    }
    if (event.button === 1) {
      gestureModeRef.current = 'pan'
      handlePanPointerDown(event)
    } else if (event.button === 0) {
      gestureModeRef.current = 'select'
      handleSelectPointerDown(event)
    }
  }

  const handleCanvasDoubleClick = () => {
    if (isDrawingCorridor) commitChain()
  }

  const deleteSelectedRooms = () => {
    if (selectedIds.size === 0) return
    recordHistory()
    setRoomBoxes((prev) => prev.filter((box) => !selectedIds.has(box.id)))
    setSelectedIds(new Set())
  }

  const deleteSelectedCorridorElements = () => {
    if (selectedCorridorNodeIds.size === 0 && selectedCorridorEdgeIds.size === 0) return
    recordHistory()

    // An edge is removed if it was selected directly, or if either of its
    // endpoint nodes was selected (deleting a node takes its edges with it).
    const removedEdges = corridorEdges.filter(
      (edge) =>
        selectedCorridorEdgeIds.has(edge.id) ||
        selectedCorridorNodeIds.has(edge.nodeAId) ||
        selectedCorridorNodeIds.has(edge.nodeBId),
    )
    const removedEdgeIds = new Set(removedEdges.map((edge) => edge.id))
    const survivingEdges = corridorEdges.filter((edge) => !removedEdgeIds.has(edge.id))

    const stillUsed = new Set()
    survivingEdges.forEach((edge) => {
      stillUsed.add(edge.nodeAId)
      stillUsed.add(edge.nodeBId)
    })
    const affectedNodeIds = new Set()
    removedEdges.forEach((edge) => {
      affectedNodeIds.add(edge.nodeAId)
      affectedNodeIds.add(edge.nodeBId)
    })

    setCorridorEdges(survivingEdges)
    setCorridorNodes((prev) =>
      prev.filter((node) => {
        if (selectedCorridorNodeIds.has(node.id)) return false // explicitly deleted
        if (affectedNodeIds.has(node.id) && !stillUsed.has(node.id)) return false // orphaned by this deletion
        return true
      }),
    )
    clearCorridorSelection()
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      const isEditingText = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isEditingText) return
      if (selectedCorridorNodeIds.size > 0 || selectedCorridorEdgeIds.size > 0) deleteSelectedCorridorElements()
      else deleteSelectedRooms()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const handleCanvasPointerMove = (event) => {
    if (isDrawingCorridor) {
      updateCursor(event)
      return
    }
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

  const nodeById = new Map(corridorNodes.map((node) => [node.id, node]))
  const nodeDegrees = computeNodeDegrees(corridorEdges)
  const nodeHitRadius = NODE_HIT_RADIUS_SCREEN_PX / view.zoom

  const handleCorridorEdgeDoubleClick = (event, edge) => {
    event.stopPropagation()
    setEditingCorridorEdgeId(edge.id)
    setEditingCorridorWidthValue(String(edge.widthMeters))
  }

  const commitCorridorWidthEdit = (id) => {
    const widthMeters = parseFloat(editingCorridorWidthValue)
    if (Number.isFinite(widthMeters) && widthMeters > 0) {
      recordHistory()
      setCorridorEdges((prev) => prev.map((edge) => (edge.id === id ? { ...edge, widthMeters } : edge)))
    }
    setEditingCorridorEdgeId(null)
  }

  const handleExportDxf = () => {
    const dxf = buildDxf({ rooms: roomBoxes, connections, violatedIds, scale })
    downloadFile(dxf, 'room-layout.dxf', 'application/dxf')
  }

  const handleExportJson = () => {
    downloadFile(
      JSON.stringify({ version: 2, rooms: roomBoxes, corridorNodes, corridorEdges }, null, 2),
      'room-layout.json',
      'application/json',
    )
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
        className={`canvas${isPanning ? ' canvas--panning' : ''}${isDrawingCorridor ? ' canvas--drawing-corridor' : ''}`}
        ref={containerRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onDoubleClick={handleCanvasDoubleClick}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        {roomBoxes.length === 0 && !underlay && <p className="canvas-empty">Load a file to see your rooms.</p>}



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
              {underlay && (
                  <button
                      className="remove_underlay_button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                          e.stopPropagation()
                          recordHistory()
                          setUnderlay(null)
                      }}
                      style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 10 }}
                  >
                      Remove underlay
                  </button>
              )}
              {underlayError && (
                  <p className="underlay_error" style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10 }}>
                      {underlayError}
                  </p>
              )}
              {pendingUnderlayImage && (
                  <UnderlayScalePrompt
                      onApply={(scaleRatio) => {
                          recordHistory()
                          // The real-world size is a multiple of the page's
                          // own printed size, not of however many pixels it
                          // was rendered at.
                          const widthMeters = pointsToMeters(pendingUnderlayImage.pageWidthPoints) * scaleRatio
                          setUnderlay({ ...pendingUnderlayImage, widthMeters })
                          setPendingUnderlayImage(null)
                      }}
                      onCancel={() => setPendingUnderlayImage(null)}
                  />
              )}
              {roomBoxes.length > 0 && (
                  <button
                      className={`add_corridor_button${isDrawingCorridor ? ' add_corridor_button--active' : ''}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                          e.stopPropagation()
                          if (isDrawingCorridor) {
                              cancelChain()
                              exitCorridorDrawTool()
                          } else {
                              clearCorridorSelection()
                              setShowCorridorWidthPrompt(true)
                          }
                      }}
                      style={{ position: 'absolute', top: 12, right: 54, zIndex: 10 }}
                  >
                      {isDrawingCorridor ? 'Click to place points, Enter to finish' : 'Add corridor'}
                  </button>
              )}
              {showCorridorWidthPrompt && (
                  <CorridorWidthPrompt
                      onApply={(widthMeters) => {
                          setCorridorWidthMeters(widthMeters)
                          setShowCorridorWidthPrompt(false)
                          setActiveTool('draw-corridor')
                      }}
                      onCancel={() => setShowCorridorWidthPrompt(false)}
                  />
              )}
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
          {underlay && (
            <img
              src={underlay.dataUrl}
              alt=""
              className="canvas-underlay"
              style={{
                width: underlay.widthMeters * scale,
                height: underlay.widthMeters * (underlay.pixelHeight / underlay.pixelWidth) * scale,
              }}
            />
          )}
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
          <svg className="canvas-corridors">
            {corridorEdges.map((edge) => {
              const nodeA = nodeById.get(edge.nodeAId)
              const nodeB = nodeById.get(edge.nodeBId)
              if (!nodeA || !nodeB) return null
              const polygon = computeEdgeOffsetPolygon(nodeA, nodeB, edge.widthMeters * scale)
              if (!polygon) return null
              const points = polygon.map((p) => `${p.x},${p.y}`).join(' ')
              const isSelected = selectedCorridorEdgeIds.has(edge.id)
              return (
                <polygon
                  key={edge.id}
                  points={points}
                  className={`corridor-edge${isSelected ? ' corridor-edge--selected' : ''}`}
                  style={edge.color ? { fill: edge.color } : undefined}
                  onPointerDown={(event) => {
                    // While the draw-corridor tool is armed, clicking on top
                    // of an existing edge must place a new chain point there
                    // (which splices a connecting node into this edge at
                    // commit time) rather than grab-selecting the edge — so
                    // leave the event unhandled and let it bubble up to the
                    // canvas's placePoint handler instead.
                    if (isDrawingCorridor) return
                    handleCorridorEdgePointerDown(event, edge)
                  }}
                  onPointerMove={handleCorridorEdgePointerMove}
                  onPointerUp={handleCorridorEdgePointerUp}
                  onDoubleClick={(event) => handleCorridorEdgeDoubleClick(event, edge)}
                />
              )
            })}
            {corridorNodes
              .filter((node) => (nodeDegrees.get(node.id) || 0) >= 2)
              .map((node) => {
                const incidentWidthsPx = corridorEdges
                  .filter((edge) => edge.nodeAId === node.id || edge.nodeBId === node.id)
                  .map((edge) => edge.widthMeters * scale)
                const fill = computeJunctionFill(node, incidentWidthsPx)
                if (!fill) return null
                // Purely decorative (pointer-events: none in CSS) — the
                // dedicated hit-target circle rendered with every node below
                // handles selection/drag uniformly regardless of degree.
                return (
                  <circle
                    key={`junction-${node.id}`}
                    cx={fill.cx}
                    cy={fill.cy}
                    r={fill.r}
                    className="corridor-junction-fill"
                  />
                )
              })}
            {corridorNodes.map((node) => (
              // A larger invisible hit-target circle, rendered on top of
              // every edge/junction fill, so a click anywhere near a node
              // always grabs the node rather than whatever edge happens to
              // sit underneath it — the visible dot itself stays small and
              // is purely cosmetic (pointer-events: none; revealed by the
              // group's own hover, since it can't be hovered directly).
              <g key={`node-${node.id}`} className="corridor-node-group">
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={nodeHitRadius}
                  className="corridor-node-hit-target"
                  onPointerDown={(event) => {
                    // Same rationale as the edge/junction handlers above:
                    // while drawing, clicking an existing node should place
                    // a chain point there (merging into it) rather than
                    // grab it.
                    if (isDrawingCorridor) return
                    handleCorridorNodePointerDown(event, node)
                  }}
                  onPointerMove={handleCorridorNodePointerMove}
                  onPointerUp={handleCorridorNodePointerUp}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={5}
                  className={`corridor-node-handle${
                    selectedCorridorNodeIds.has(node.id) ? ' corridor-node-handle--selected' : ''
                  }`}
                />
              </g>
            ))}
          </svg>
          {isDrawingCorridor && (
            <svg className="canvas-corridor-draft">
              {draftPoints.map((point, index) => {
                const next = draftPoints[index + 1] || (index === draftPoints.length - 1 ? cursorPoint : null)
                if (!next) return null
                return (
                  <line
                    key={`draft-segment-${index}`}
                    x1={point.x}
                    y1={point.y}
                    x2={next.x}
                    y2={next.y}
                    className="corridor-draft-line"
                  />
                )
              })}
              {draftPoints.map((point, index) => (
                <circle key={`draft-point-${index}`} cx={point.x} cy={point.y} r={4} className="corridor-draft-point" />
              ))}
            </svg>
          )}
          {editingCorridorEdgeId &&
            (() => {
              const edge = corridorEdges.find((e) => e.id === editingCorridorEdgeId)
              const nodeA = edge && nodeById.get(edge.nodeAId)
              const nodeB = edge && nodeById.get(edge.nodeBId)
              if (!edge || !nodeA || !nodeB) return null
              const midX = (nodeA.x + nodeB.x) / 2
              const midY = (nodeA.y + nodeB.y) / 2
              return (
                <div
                  className="corridor-width-edit"
                  style={{ position: 'absolute', transform: `translate(${midX}px, ${midY}px)` }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="number"
                    className="corridor-width-edit__input"
                    value={editingCorridorWidthValue}
                    step="0.1"
                    min="0"
                    autoFocus
                    onChange={(event) => setEditingCorridorWidthValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitCorridorWidthEdit(editingCorridorEdgeId)
                      if (event.key === 'Escape') setEditingCorridorEdgeId(null)
                    }}
                  />
                </div>
              )
            })()}
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
