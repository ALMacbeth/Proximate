import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoomCard, RoomLabel } from './RoomCard.jsx'
import RoomPropertiesMenu from './RoomPropertiesMenu.jsx'
import { HexColorPicker } from 'react-colorful'
import { buildDxf } from './dxfExport.js'
import { buildSvg } from './svgExport.js'
import { downloadFile } from './download.js'
import {
  computeScale,
  describeAreaSpread,
  recoverScaleFromRooms,
  computeRoomBoxes,
  packRoomBoxes,
  computeConnections,
  clampWidthToArea,
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
import { useAutoArrange } from './useAutoArrange.js'
import { CorridorWidthPrompt } from './CorridorMenus.jsx'
import { UnderlayScalePrompt } from './UnderlayMenus.jsx'
import { renderPdfFirstPageToImage, pointsToMeters } from './pdfUnderlay.js'

const NODE_HIT_RADIUS_SCREEN_PX = 10
const PDF_FILE_PATTERN = /\.pdf$/i
// Approximate rendered size of the right-click properties popup, used only to
// keep it fully inside the canvas when opened near the right/bottom edge.
const ROOM_MENU_WIDTH_PX = 230
const ROOM_MENU_HEIGHT_PX = 220
// Rooms are drawn in true proportion, so an area spread past this is almost
// always a unit/typo error in one row - flag it rather than silently
// producing a canvas thousands of pixels across.
const MAX_AREA_SPREAD_RATIO = 10000

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
        const parsedArea = Number.parseFloat(targetArea)
        const targetAreaMeters = parsedArea > 0 ? parsedArea : 1
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
                    className={`color-swatch${color ? ' color-swatch--selected' : ''}`}
                    style={{ backgroundColor: color }}
                    aria-label="Choose room colour"
                    onClick={() => setShowColorSwatches(true)}
                />
                {showColorSwatches && (
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
                                    <button type="button" onClick={handleAcceptSwatch}>Accept</button>
                                    <button type="button" onClick={() => setShowCustomPicker(false)}>Cancel</button>
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

function RoomCanvas({
  rooms,
  corridorNodes: initialCorridorNodes,
  corridorEdges: initialCorridorEdges,
  initialUnderlayFile,
  wallThicknessMm: initialWallThicknessMm,
}) {
  const containerRef = useRef(null)
  const gestureModeRef = useRef(null)
  // Clipboard for Ctrl+C/Ctrl+V room copy-paste - kept as a ref (not state)
  // since copied content doesn't need to trigger a render, only to exist
  // when a later paste reads it. pointerPositionRef tracks raw client
  // coordinates so Ctrl+V (a keyboard event with no position of its own)
  // can still paste at wherever the pointer currently is.
  const copiedRoomsRef = useRef(null)
  const pointerPositionRef = useRef(null)
  const [roomBoxes, setRoomBoxes] = useState([])
  const [scale, setScale] = useState(1)
  const [editingId, setEditingId] = useState(null)
    const [editValue, setEditValue] = useState('')
    const [editHeightValue, setEditHeightValue] = useState('')
    const lastEditedFieldRef = useRef('width')
    const [roomMenu, setRoomMenu] = useState(null)
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
  const [wallThicknessMm, setWallThicknessMm] = useState('150')
  const [showWallOutlines, setShowWallOutlines] = useState(false)
  const [labelMode, setLabelMode] = useState('dimensions')
  const [scaleWarning, setScaleWarning] = useState('')
  // Selection lives here (not inside useRoomDrag/useCorridorDrag) so both
  // hooks can read and clear each other's selection - that's what lets a
  // mixed room+corridor selection move together regardless of which
  // element started the drag.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [selectedCorridorNodeIds, setSelectedCorridorNodeIds] = useState(() => new Set())
  const [selectedCorridorEdgeIds, setSelectedCorridorEdgeIds] = useState(() => new Set())

  const { view, isPanning, resetView, getLayoutPointerPosition, handlePanPointerDown, handlePanPointerMove, handlePanPointerUp } =
    usePanZoom(containerRef)

  // Tracks raw pointer position for paste-at-cursor, independent of
  // everything else the canvas's own onPointerMove does. Attached in the
  // CAPTURE phase (runs before bubbling, so before any child's
  // stopPropagation() call - e.g. a room card's own drag handler) directly
  // via addEventListener rather than a React prop, since a synthetic bubble
  // listener on the container would miss pointer moves over a room/corridor
  // that stop propagation on their way up.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handlePointerMoveCapture = (event) => {
      pointerPositionRef.current = { clientX: event.clientX, clientY: event.clientY }
    }
    container.addEventListener('pointermove', handlePointerMoveCapture, { capture: true })
    return () => container.removeEventListener('pointermove', handlePointerMoveCapture, { capture: true })
  }, [])

  const { recordHistory, clearHistory } = useUndoHistory({
    roomBoxes: [roomBoxes, setRoomBoxes],
    corridorNodes: [corridorNodes, setCorridorNodes],
    corridorEdges: [corridorEdges, setCorridorEdges],
  })

  // Half the wall thickness, converted from the mm input down to the same
  // px space room boxes live in - both the wall-outline offset (rendered
  // further below) and room snapping (so rooms align by their wall's outer
  // face, not their own raw boundary) use this same value.
  const wallThicknessValue = Number(wallThicknessMm)
  const wallOffsetPx =
    Number.isFinite(wallThicknessValue) && wallThicknessValue > 0 ? ((wallThicknessValue / 1000) * scale) / 2 : 0

  const corridorSnapCandidates = useMemo(
    () => computeCorridorRoomSnapCandidates(corridorNodes, corridorEdges, scale, wallOffsetPx),
    [corridorNodes, corridorEdges, scale, wallOffsetPx],
  )

  const {
    snapGuides: dragSnapGuides,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useRoomDrag({
    roomBoxes,
    setRoomBoxes,
    selectedIds,
    setSelectedIds,
    getLayoutPointerPosition,
    zoom: view.zoom,
    recordHistory,
    corridorSnapCandidates,
    wallOffsetPx,
    corridorNodes,
    setCorridorNodes,
    corridorEdges,
    setCorridorEdges,
    selectedCorridorNodeIds,
    setSelectedCorridorNodeIds,
    selectedCorridorEdgeIds,
    setSelectedCorridorEdgeIds,
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
    wallOffsetPx,
  })

  const snapGuides = [...dragSnapGuides, ...resizeSnapGuides]

  const {
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
    selectedNodeIds: selectedCorridorNodeIds,
    setSelectedNodeIds: setSelectedCorridorNodeIds,
    selectedEdgeIds: selectedCorridorEdgeIds,
    setSelectedEdgeIds: setSelectedCorridorEdgeIds,
    roomBoxes,
    setRoomBoxes,
    selectedRoomIds: selectedIds,
    setSelectedRoomIds: setSelectedIds,
    getLayoutPointerPosition,
    recordHistory,
  })

  const {
    isArranging,
    previewBoxes,
    collisionShape,
    setCollisionShape,
    start: startAutoArrange,
    cancel: cancelAutoArrange,
    accept: acceptAutoArrange,
    reshuffle: reshuffleAutoArrange,
    pinNode: pinArrangeNode,
    dragPreview: dragArrangePreview,
    releaseNode: releaseArrangeNode,
  } = useAutoArrange({ roomBoxes, setRoomBoxes, scale, recordHistory })

  // What actually renders: the live physics preview while arranging, the
  // real (undo-tracked) room boxes otherwise. Only the rendering reads this
  // - drag/resize/selection/export all keep operating on roomBoxes itself,
  // which auto-arrange never touches until accept() commits it.
  const displayBoxes = isArranging ? previewBoxes : roomBoxes
  const isCirclePreview = isArranging && collisionShape === 'circle'

  // The box a room actually renders as: its real rectangle normally, or the
  // same equal-area circle the physics is colliding against (roomBox.radius,
  // only present on previewBoxes entries) while in circle-collision preview
  // - so what you see settling is what's actually pushing other rooms
  // around, not a rectangle silently riding along a circle's motion.
  const getRenderRect = (roomBox) => {
    if (!isCirclePreview || !Number.isFinite(roomBox.radius)) {
      return { x: roomBox.x, y: roomBox.y, width: roomBox.width, height: roomBox.height }
    }
    const centerX = roomBox.x + roomBox.width / 2
    const centerY = roomBox.y + roomBox.height / 2
    const diameter = roomBox.radius * 2
    return { x: centerX - roomBox.radius, y: centerY - roomBox.radius, width: diameter, height: diameter }
  }

  // computeConnections' fromPoint/toPoint are the nearest pair of RECTANGLE
  // side-midpoints - correct for the normal room-card view, but during a
  // circle preview that anchors the line to a point that isn't on the
  // rendered circle's edge at all (the same "measuring from inside the
  // shape" mismatch the adjacency physics had). Recompute both endpoints as
  // the circle-edge point along the straight line between the two room
  // centers instead, so the drawn line actually touches what's on screen.
  const getConnectionPoints = (connection) => {
    if (!isCirclePreview) return { from: connection.fromPoint, to: connection.toPoint }
    const fromRadius = connection.from.radius
    const toRadius = connection.to.radius
    if (!Number.isFinite(fromRadius) || !Number.isFinite(toRadius)) {
      return { from: connection.fromPoint, to: connection.toPoint }
    }
    const fromCenter = { x: connection.from.x + connection.from.width / 2, y: connection.from.y + connection.from.height / 2 }
    const toCenter = { x: connection.to.x + connection.to.width / 2, y: connection.to.y + connection.to.height / 2 }
    const dx = toCenter.x - fromCenter.x
    const dy = toCenter.y - fromCenter.y
    const distance = Math.hypot(dx, dy) || 1
    const ux = dx / distance
    const uy = dy / distance
    return {
      from: { x: fromCenter.x + ux * fromRadius, y: fromCenter.y + uy * fromRadius },
      to: { x: toCenter.x - ux * toRadius, y: toCenter.y - uy * toRadius },
    }
  }

  const handleArrangeRoomPointerDown = (event, roomBox) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const pos = getLayoutPointerPosition(event)
    pinArrangeNode(roomBox.id, pos.x, pos.y)
  }

  const handleArrangeRoomPointerMove = (event, roomBox) => {
    event.stopPropagation()
    const pos = getLayoutPointerPosition(event)
    dragArrangePreview(roomBox.id, pos.x, pos.y)
  }

  const handleArrangeRoomPointerUp = (event, roomBox) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    releaseArrangeNode(roomBox.id)
  }

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
    // A new room set makes any in-progress arrange preview meaningless -
    // its simulation nodes reference the old rooms.
    cancelAutoArrange()
    setRoomMenu(null)

    const spread = describeAreaSpread(rooms, MAX_AREA_SPREAD_RATIO)
    setScaleWarning(
      spread
        ? `Room sizes span ${Math.round(spread.ratio).toLocaleString()}:1 - "${spread.smallest.roomName}" is ${spread.smallest.targetArea} m² next to "${spread.largest.roomName}" at ${spread.largest.targetArea} m². Check for a unit or typing error; the largest rooms will be very big on screen, so zoom out to see them.`
        : '',
    )

    if (rooms.length === 0) {
      setRoomBoxes([])
      setScale(1)
      setCorridorNodes([])
      setCorridorEdges([])
      setWallThicknessMm('150')
      resetView()
      return
    }
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

    // Saved pixel sizes are only meaningful at the scale they were saved
    // with, so restore that scale rather than recomputing a fresh one.
    const computedScale = (hasSavedLayout && recoverScaleFromRooms(rooms)) || computeScale(rooms)
    setScale(computedScale)
    setCorridorNodes(initialCorridorNodes ?? [])
    setCorridorEdges(initialCorridorEdges ?? [])
    // Older exports predate this field, so a missing value falls back to
    // the same default a brand-new session starts with.
    setWallThicknessMm(Number.isFinite(initialWallThicknessMm) ? String(initialWallThicknessMm) : '150')

    if (hasSavedLayout) {
      setRoomBoxes(rooms.map((room) => ({ ...room })))
    } else {
      const width = containerRef.current?.clientWidth || 800
      setRoomBoxes(packRoomBoxes(computeRoomBoxes(rooms, computedScale), width))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms])


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
    if (isArranging) return
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

  // Stores everything about each selected room except its id/x/y, plus each
  // one's position RELATIVE to the group's own top-left corner - so a
  // multi-room copy keeps its internal arrangement intact on paste instead
  // of every room landing on exactly the same point.
  const copySelectedRooms = () => {
    if (selectedIds.size === 0) return
    const selected = roomBoxes.filter((box) => selectedIds.has(box.id))
    const minX = Math.min(...selected.map((box) => box.x))
    const minY = Math.min(...selected.map((box) => box.y))
    copiedRoomsRef.current = selected.map(({ id: _id, x, y, ...rest }) => ({
      ...rest,
      relX: x - minX,
      relY: y - minY,
    }))
  }

  // Pastes at the last known pointer position rather than, say, a fixed
  // offset from the original - pointerPositionRef is only ever set while
  // the pointer is over the canvas, so there's nowhere sensible to paste
  // until the user has actually moved the mouse over it at least once.
  const pasteCopiedRooms = () => {
    const copied = copiedRoomsRef.current
    if (!copied || copied.length === 0) return
    const pointerPosition = pointerPositionRef.current
    if (!pointerPosition) return

    const { x: pasteX, y: pasteY } = getLayoutPointerPosition(pointerPosition)
    recordHistory()
    const newIds = new Set()
    const pastedRooms = copied.map(({ relX, relY, ...rest }, index) => {
      const id = `room-${Date.now()}-${index}`
      newIds.add(id)
      return { ...rest, id, x: pasteX + relX, y: pasteY + relY }
    })
    setRoomBoxes((prev) => [...prev, ...pastedRooms])
    setSelectedIds(newIds)
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
      if (isArranging) return
      const target = event.target
      const isEditingText = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isEditingText) return

      const isModifierPressed = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (isModifierPressed && key === 'c') {
        copySelectedRooms()
        return
      }
      if (isModifierPressed && key === 'v') {
        event.preventDefault()
        pasteCopiedRooms()
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
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

  const getMinWidthPx = (box) => (Number.isFinite(box.minWidth) && box.minWidth > 0 ? box.minWidth * scale : 0)

  const handleRoomDoubleClick = (event, roomBox) => {
    event.stopPropagation()
    setRoomMenu(null)
    if (editingId === roomBox.id) return
    lastEditedFieldRef.current = 'width'
    setEditingId(roomBox.id)
    setEditValue((roomBox.width / scale).toFixed(2))
    setEditHeightValue((roomBox.height / scale).toFixed(2))
  }

  // Width and height are linked through the room's fixed area: editing one
  // immediately recomputes the other so the pair always describes the same
  // area (clamped by the room's minimum dimension, like a resize drag). The
  // field the user typed in stays exactly as typed.
  const handleEditWidthChange = (value) => {
    lastEditedFieldRef.current = 'width'
    setEditValue(value)
    const box = roomBoxes.find((candidate) => candidate.id === editingId)
    const widthMeters = parseFloat(value)
    if (!box || !(widthMeters > 0)) return
    const { height } = clampWidthToArea(widthMeters * scale, box.area, getMinWidthPx(box))
    setEditHeightValue((height / scale).toFixed(2))
  }

  const handleEditHeightChange = (value) => {
    lastEditedFieldRef.current = 'height'
    setEditHeightValue(value)
    const box = roomBoxes.find((candidate) => candidate.id === editingId)
    const heightMeters = parseFloat(value)
    if (!box || !(heightMeters > 0)) return
    const { width } = clampWidthToArea(box.area / (heightMeters * scale), box.area, getMinWidthPx(box))
    setEditValue((width / scale).toFixed(2))
  }

  // Commits from whichever field was typed in last, using its raw value (not
  // the rounded text shown in the other field), so e.g. typing a height of
  // 3 gives exactly 3 rather than a height recomputed from a rounded width.
  const commitSizeEdit = (id) => {
    const fromHeight = lastEditedFieldRef.current === 'height'
    const typedMeters = parseFloat(fromHeight ? editHeightValue : editValue)
    if (Number.isFinite(typedMeters) && typedMeters > 0) {
      recordHistory()
      setRoomBoxes((prev) =>
        prev.map((box) => {
          if (box.id !== id) return box
          const desiredWidth = fromHeight ? box.area / (typedMeters * scale) : typedMeters * scale
          const { width, height } = clampWidthToArea(desiredWidth, box.area, getMinWidthPx(box))
          return { ...box, width, height }
        }),
      )
    }
    setEditingId(null)
  }

  const handleRoomContextMenu = (event, roomBox) => {
    if (isArranging) return
    event.preventDefault()
    event.stopPropagation()
    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    // Absolute positioning is relative to the padding box, so the container's
    // border (clientLeft/clientTop) has to come out of the pointer offset.
    const pointerLeft = event.clientX - containerRect.left - container.clientLeft
    const pointerTop = event.clientY - containerRect.top - container.clientTop
    setEditingId(null)
    setRoomMenu({
      id: roomBox.id,
      left: Math.max(0, Math.min(pointerLeft, container.clientWidth - ROOM_MENU_WIDTH_PX)),
      top: Math.max(0, Math.min(pointerTop, container.clientHeight - ROOM_MENU_HEIGHT_PX)),
    })
  }

  const applyRoomProperties = (id, { areaMeters, minWidthMeters }) => {
    recordHistory()
    setRoomBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== id) return box
        const area = areaMeters * scale * scale
        const minWidthPx = minWidthMeters ? minWidthMeters * scale : 0
        const { width, height } = clampWidthToArea(box.width, area, minWidthPx)
        return { ...box, targetArea: areaMeters, area, minWidth: minWidthMeters, width, height }
      }),
    )
  }

  // Memoised so pans, zooms and selection changes (which re-render this
  // component every frame but don't touch rooms) skip the connection maths.
  // The committed connections only feed the exports and the normal view, so
  // they're skipped entirely while a preview is running.
  const connections = useMemo(
    () => (isArranging ? [] : computeConnections(roomBoxes, scale)),
    [roomBoxes, scale, isArranging],
  )
  const violatedIds = useMemo(
    () => new Set(connections.filter((c) => c.violated).flatMap((c) => [c.from.id, c.to.id])),
    [connections],
  )

  // Recomputed against the live preview while arranging, purely for visual
  // feedback (so you can see adjacency violations resolve as the physics
  // settles) - exports and the DXF/SVG buttons still use the committed
  // roomBoxes/connections above, since nothing here is real until accept().
  const displayConnections = useMemo(
    () => (isArranging ? computeConnections(previewBoxes, scale) : connections),
    [isArranging, previewBoxes, scale, connections],
  )

  // computeConnections' own `violated` flag is rectDistance-based (the true
  // rectangle-to-rectangle gap) - correct for the normal view, but wrong
  // during a circle preview for the same reason the line endpoints were:
  // it's checking a boundary that isn't the one on screen. A circle's edge
  // sits further from center than the rectangle's along some directions and
  // closer along others (an equal-area circle is narrower than a square at
  // the corners, wider face-on), so rectDistance can flag two rooms as
  // still-too-far-apart (red) even once their actual rendered circles have
  // closed the gap. Recomputed here the same way the adjacency physics and
  // getConnectionPoints already do: center distance minus both radii.
  const isConnectionViolated = (connection) => {
    if (!isCirclePreview) return connection.violated
    const fromRadius = connection.from.radius
    const toRadius = connection.to.radius
    if (!Number.isFinite(fromRadius) || !Number.isFinite(toRadius)) return connection.violated
    const maxDistanceMeters = connection.from.adjacentRooms?.[connection.to.roomName] ?? connection.to.adjacentRooms?.[connection.from.roomName]
    if (!Number.isFinite(maxDistanceMeters)) return connection.violated
    const fromCenter = { x: connection.from.x + connection.from.width / 2, y: connection.from.y + connection.from.height / 2 }
    const toCenter = { x: connection.to.x + connection.to.width / 2, y: connection.to.y + connection.to.height / 2 }
    const centerDistance = Math.hypot(toCenter.x - fromCenter.x, toCenter.y - fromCenter.y)
    const edgeDistance = Math.max(0, centerDistance - fromRadius - toRadius)
    return edgeDistance > maxDistanceMeters * scale
  }

  const displayViolatedIds = useMemo(
    () =>
      isArranging
        ? new Set(displayConnections.filter((c) => isConnectionViolated(c)).flatMap((c) => [c.from.id, c.to.id]))
        : violatedIds,
    // isConnectionViolated is recreated each render but only reads
    // isCirclePreview and scale, which are listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isArranging, displayConnections, violatedIds, isCirclePreview, scale],
  )

  // All the corridor geometry (offset polygons, wall outlines, junction
  // fills) depends only on the corridor data and scale, so it's computed once
  // per change rather than on every pan/zoom frame. Junction widths are
  // gathered in one pass over the edges instead of re-filtering every edge
  // for every node.
  const corridorGeometry = useMemo(() => {
    const nodeById = new Map(corridorNodes.map((node) => [node.id, node]))
    const nodeDegrees = computeNodeDegrees(corridorEdges)
    const incidentWidthsByNode = new Map()
    const edgeShapes = []
    const wallShapes = []
    const drawWalls = wallOffsetPx > 0 && showWallOutlines

    corridorEdges.forEach((edge) => {
      const widthPx = edge.widthMeters * scale
      ;[edge.nodeAId, edge.nodeBId].forEach((nodeId) => {
        if (!incidentWidthsByNode.has(nodeId)) incidentWidthsByNode.set(nodeId, [])
        incidentWidthsByNode.get(nodeId).push(widthPx)
      })

      const nodeA = nodeById.get(edge.nodeAId)
      const nodeB = nodeById.get(edge.nodeBId)
      if (!nodeA || !nodeB) return
      const polygon = computeEdgeOffsetPolygon(nodeA, nodeB, widthPx)
      if (polygon) edgeShapes.push({ edge, points: polygon.map((p) => `${p.x},${p.y}`).join(' ') })
      if (drawWalls) {
        // The corridor's own offset polygon already represents its full
        // width, so growing that same width by a further wall thickness on
        // top puts this outline half a wall's thickness beyond each long edge.
        const outline = computeEdgeOffsetPolygon(nodeA, nodeB, widthPx + wallOffsetPx * 2)
        if (outline) wallShapes.push({ id: edge.id, points: outline.map((p) => `${p.x},${p.y}`).join(' ') })
      }
    })

    const junctions = corridorNodes.flatMap((node) => {
      if ((nodeDegrees.get(node.id) || 0) < 2) return []
      const fill = computeJunctionFill(node, incidentWidthsByNode.get(node.id) || [])
      return fill ? [{ id: node.id, fill }] : []
    })

    return { nodeById, edgeShapes, wallShapes, junctions }
  }, [corridorNodes, corridorEdges, scale, wallOffsetPx, showWallOutlines])
  const nodeById = corridorGeometry.nodeById
  const nodeHitRadius = NODE_HIT_RADIUS_SCREEN_PX / view.zoom

  // Every room card/label handler goes through one stable wrapper that calls
  // the latest closure, so the memoised RoomCard/RoomLabel components never
  // see a changed callback prop (and so only re-render when their own room's
  // data changes). Each looks the room up by id at event time.
  const getDisplayBox = (id) => displayBoxes.find((box) => box.id === id)
  const roomHandlersRef = useRef({})
  roomHandlersRef.current = {
    pointerDown: (event, id) => {
      // Only the primary button drags/selects; right-click opens the
      // properties menu and middle-click is left to pan the canvas.
      if (!isArranging && event.button !== 0) return
      const box = getDisplayBox(id)
      if (!box) return
      if (isArranging) handleArrangeRoomPointerDown(event, box)
      else handlePointerDown(event, box)
    },
    pointerMove: (event, id) => {
      const box = getDisplayBox(id)
      if (!box) return
      if (isArranging) handleArrangeRoomPointerMove(event, box)
      else handlePointerMove(event)
    },
    pointerUp: (event, id) => {
      const box = getDisplayBox(id)
      if (!box) return
      if (isArranging) handleArrangeRoomPointerUp(event, box)
      else handlePointerUp(event)
    },
    doubleClick: (event, id) => {
      const box = getDisplayBox(id)
      if (box && !isArranging) handleRoomDoubleClick(event, box)
    },
    resizePointerDown: (event, id) => {
      const box = getDisplayBox(id)
      if (box) handleResizePointerDown(event, box)
    },
    resizePointerMove: (event, id) => handleResizePointerMove(event, id),
    resizePointerUp: (event, id) => handleResizePointerUp(event, id),
    contextMenu: (event, id) => {
      const box = getDisplayBox(id)
      if (box) handleRoomContextMenu(event, box)
    },
    editHeightChange: handleEditHeightChange,
    editWidthChange: handleEditWidthChange,
    commitEdit: commitSizeEdit,
    cancelEdit: () => setEditingId(null),
  }
  const roomHandlers = useMemo(
    () =>
      Object.fromEntries(
        [
          'pointerDown',
          'pointerMove',
          'pointerUp',
          'doubleClick',
          'resizePointerDown',
          'resizePointerMove',
          'resizePointerUp',
          'contextMenu',
          'editHeightChange',
          'editWidthChange',
          'commitEdit',
          'cancelEdit',
        ].map((name) => [name, (...args) => roomHandlersRef.current[name](...args)]),
      ),
    [],
  )

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

  const handleExportSvg = () => {
    const svg = buildSvg({
      roomBoxes,
      corridorNodes,
      corridorEdges,
      connections,
      violatedIds,
      scale,
      // Wall outlines are hidden via the canvas's own "Show" toggle, not by
      // zeroing wallThicknessMm - so mirror that toggle here rather than
      // relying on wallOffsetPx alone, or a hidden outline would still
      // sneak into the export.
      wallOffsetPx: showWallOutlines ? wallOffsetPx : 0,
    })
    downloadFile(svg, 'room-layout.svg', 'image/svg+xml')
  }

  const handleExportJson = () => {
    downloadFile(
      JSON.stringify(
        {
          version: 2,
          rooms: roomBoxes,
          corridorNodes,
          corridorEdges,
          wallThicknessMm: Number.isFinite(wallThicknessValue) ? wallThicknessValue : 150,
        },
        null,
        2,
      ),
      'room-layout.json',
      'application/json',
    )
  }





  

  return (
    <>
      {roomBoxes.length > 0 && !isArranging && (
        <div className="export-actions">
          <button type="button" className="export-button" onClick={handleExportDxf}>
            Export as CAD (.dxf)
          </button>
          <button type="button" className="export-button" onClick={handleExportSvg}>
            Export as SVG (.svg)
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



              {!isArranging && (
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
              )}
              {roomBoxes.length > 1 && !isArranging && (
                  <button
                      className="auto_arrange_button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                          e.stopPropagation()
                          startAutoArrange()
                      }}
                      style={{ position: 'absolute', top: 54, right: 12, zIndex: 10 }}
                  >
                      Auto-arrange
                  </button>
              )}
              {isArranging && (
                  <div
                      className="auto_arrange_controls"
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', top: 12, left: 12, zIndex: 20 }}
                  >
                      <span>Drag any room to nudge it, then Accept or Cancel.</span>
                      <div className="collision_shape_toggle">
                          <button
                              type="button"
                              className={collisionShape === 'circle' ? 'collision_shape_toggle--active' : ''}
                              onClick={() => setCollisionShape('circle')}
                              title="Rooms can slide past each other while settling"
                          >
                              Circles
                          </button>
                          <button
                              type="button"
                              className={collisionShape === 'rectangle' ? 'collision_shape_toggle--active' : ''}
                              onClick={() => setCollisionShape('rectangle')}
                              title="Rooms collide as their real shape the whole time"
                          >
                              Rectangles
                          </button>
                      </div>
                      <button type="button" onClick={reshuffleAutoArrange}>
                          Reshuffle
                      </button>
                      <button type="button" onClick={acceptAutoArrange}>
                          Accept
                      </button>
                      <button type="button" onClick={cancelAutoArrange}>
                          Cancel
                      </button>
                  </div>
              )}
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
                  <p className="underlay_error" style={{ position: 'absolute', bottom: 54, right: 12, zIndex: 10 }}>
                      {underlayError}
                  </p>
              )}
              {scaleWarning && (
                  <p
                      className="scale_warning"
                      role="status"
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', bottom: 54, left: 12, zIndex: 10 }}
                  >
                      <span>{scaleWarning}</span>
                      <button type="button" aria-label="Dismiss warning" onClick={() => setScaleWarning('')}>
                          ×
                      </button>
                  </p>
              )}
              {roomBoxes.length > 0 && (
                  <label
                      className="label_mode_toggle"
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10 }}
                      title="Switch room labels between dimensions and area"
                  >
                      <span className={labelMode === 'dimensions' ? 'label_mode_toggle__option--active' : ''}>
                          Dimensions
                      </span>
                      <input
                          type="checkbox"
                          role="switch"
                          checked={labelMode === 'area'}
                          onChange={(e) => setLabelMode(e.target.checked ? 'area' : 'dimensions')}
                      />
                      <span className="label_mode_toggle__track" aria-hidden="true" />
                      <span className={labelMode === 'area' ? 'label_mode_toggle__option--active' : ''}>Area</span>
                  </label>
              )}
              <div
                  className="wall_thickness_control"
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}
              >
                  <label>
                      Wall thickness (mm):
                      <input
                          type="number"
                          value={wallThicknessMm}
                          step="any"
                          min="0"
                          onChange={(event) => setWallThicknessMm(event.target.value)}
                      />
                  </label>
                  <label>
                      <input
                          type="checkbox"
                          checked={showWallOutlines}
                          onChange={(event) => setShowWallOutlines(event.target.checked)}
                      />
                      Show
                  </label>
              </div>
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
              {roomBoxes.length > 0 && !isArranging && (
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
              {selectedIds.size > 0 && !isArranging && (
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

        {roomMenu &&
          (() => {
            const menuBox = roomBoxes.find((box) => box.id === roomMenu.id)
            if (!menuBox) return null
            return (
              <RoomPropertiesMenu
                key={roomMenu.id}
                left={roomMenu.left}
                top={roomMenu.top}
                roomName={menuBox.roomName}
                initialArea={(menuBox.area / (scale * scale)).toFixed(2)}
                initialMinWidth={Number.isFinite(menuBox.minWidth) && menuBox.minWidth > 0 ? String(menuBox.minWidth) : ''}
                onApply={(values) => applyRoomProperties(roomMenu.id, values)}
                onClose={() => setRoomMenu(null)}
              />
            )
          })()}

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
          {/* Hidden while arranging: positions aren't final yet, and in
             circle mode there's no sensible square wall outline to draw
             around a room rendered as a circle. */}
          {wallOffsetPx > 0 && showWallOutlines && !isArranging && (
            <svg className="canvas-wall-outlines">
              {displayBoxes.map((roomBox) => (
                <rect
                  key={`wall-${roomBox.id}`}
                  x={roomBox.x - wallOffsetPx}
                  y={roomBox.y - wallOffsetPx}
                  width={roomBox.width + wallOffsetPx * 2}
                  height={roomBox.height + wallOffsetPx * 2}
                  className="wall-outline"
                />
              ))}
              {corridorGeometry.wallShapes.map(({ id, points }) => (
                <polygon key={`wall-${id}`} points={points} className="wall-outline" />
              ))}
            </svg>
          )}
          <svg className="canvas-lines">
            {displayConnections.map((connection) => {
              const points = getConnectionPoints(connection)
              return (
                <line
                  key={connection.id}
                  x1={points.from.x}
                  y1={points.from.y}
                  x2={points.to.x}
                  y2={points.to.y}
                  className={`connection${isConnectionViolated(connection) ? ' connection--violated' : ' connection--ok'}`}
                />
              )
            })}
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
            {corridorGeometry.edgeShapes.map(({ edge, points }) => {
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
                    // commit time) rather than grab-selecting the edge - so
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
            {/* Purely decorative (pointer-events: none in CSS) - the
               dedicated hit-target circle rendered with every node below
               handles selection/drag uniformly regardless of degree. */}
            {corridorGeometry.junctions.map(({ id, fill }) => (
              <circle key={`junction-${id}`} cx={fill.cx} cy={fill.cy} r={fill.r} className="corridor-junction-fill" />
            ))}
            {corridorNodes.map((node) => (
              // A larger invisible hit-target circle, rendered on top of
              // every edge/junction fill, so a click anywhere near a node
              // always grabs the node rather than whatever edge happens to
              // sit underneath it - the visible dot itself stays small and
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
          {displayBoxes.map((roomBox) => {
            const renderRect = getRenderRect(roomBox)
            return (
              <RoomCard
                key={roomBox.id}
                id={roomBox.id}
                x={renderRect.x}
                y={renderRect.y}
                width={renderRect.width}
                height={renderRect.height}
                color={roomBox.color}
                isViolated={displayViolatedIds.has(roomBox.id)}
                isSelected={selectedIds.has(roomBox.id)}
                isArranging={isArranging}
                isCircle={isCirclePreview}
                onPointerDown={roomHandlers.pointerDown}
                onPointerMove={roomHandlers.pointerMove}
                onPointerUp={roomHandlers.pointerUp}
                onDoubleClick={roomHandlers.doubleClick}
                onContextMenu={roomHandlers.contextMenu}
                onResizePointerDown={roomHandlers.resizePointerDown}
                onResizePointerMove={roomHandlers.resizePointerMove}
                onResizePointerUp={roomHandlers.resizePointerUp}
              />
            )
          })}
          {/* Rendered as a second pass, after every room card, so labels
             always stack above all cards regardless of overlap order. */}
          {displayBoxes.map((roomBox) => {
            const renderRect = getRenderRect(roomBox)
            const isEditing = editingId === roomBox.id
            return (
              <RoomLabel
                key={`${roomBox.id}-label`}
                id={roomBox.id}
                roomName={roomBox.roomName}
                x={renderRect.x}
                y={renderRect.y}
                width={renderRect.width}
                height={renderRect.height}
                color={roomBox.color}
                isViolated={displayViolatedIds.has(roomBox.id)}
                labelMode={labelMode}
                scale={scale}
                dimWidth={roomBox.width}
                dimHeight={roomBox.height}
                area={roomBox.area}
                isEditing={isEditing}
                editHeightValue={isEditing ? editHeightValue : undefined}
                editValue={isEditing ? editValue : undefined}
                onEditHeightChange={roomHandlers.editHeightChange}
                onEditWidthChange={roomHandlers.editWidthChange}
                onCommitEdit={roomHandlers.commitEdit}
                onCancelEdit={roomHandlers.cancelEdit}
              />
            )
          })}
        </div>
      </div>
    </>
  )
}

export default RoomCanvas
