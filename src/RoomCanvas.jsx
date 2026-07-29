import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildDxf, downloadDxf } from './dxfExport.js'

const MIN_SIZE = 48
const MAX_SIZE = 200
const MIN_DIMENSION = 24
const GAP = 12
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_SPEED = 0.001

function computeScale(rooms) {
  const areas = rooms.map((room) => (Number.isFinite(room.targetArea) && room.targetArea > 0 ? room.targetArea : 0))
  const maxArea = Math.max(...areas, 1)
  return MAX_SIZE / Math.sqrt(maxArea)
}

function computeSizes(rooms, scale) {
  return rooms.map((room) => {
    const minWidthPx = Number.isFinite(room.minWidth) && room.minWidth > 0 ? room.minWidth * scale : 0
    const size = Math.max(MIN_SIZE, minWidthPx, Math.sqrt(Math.max(room.targetArea, 0)) * scale)
    return {
      id: room.id,
      roomName: room.roomName,
      targetArea: room.targetArea,
      adjacentRooms: room.adjacentRooms || {},
      minWidth: room.minWidth,
      color: room.color,
      width: size,
      height: size,
      area: size * size,
    }
  })
}

function getContrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#000000' : '#ffffff'
}

function clampWidthToArea(desiredWidth, area, minWidthPx) {
  const lowerBound = Math.max(MIN_DIMENSION, minWidthPx)
  const upperBound = Math.max(lowerBound, Math.min(area / MIN_DIMENSION, minWidthPx > 0 ? area / minWidthPx : Infinity))
  const width = Math.min(upperBound, Math.max(lowerBound, desiredWidth))
  const height = Math.max(minWidthPx, area / width)
  return { width, height }
}

function formatDimensions(square, scale) {
  const widthMeters = square.width / scale
  const heightMeters = square.height / scale
  return `${widthMeters.toFixed(2)} x ${heightMeters.toFixed(2)}`
}

function centerDistance(a, b) {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

function squareSideMidpoints(square) {
  return [
    { x: square.x + square.width / 2, y: square.y }, // top
    { x: square.x + square.width, y: square.y + square.height / 2 }, // right
    { x: square.x + square.width / 2, y: square.y + square.height }, // bottom
    { x: square.x, y: square.y + square.height / 2 }, // left
  ]
}

function nearestSidePoints(a, b) {
  const sidesA = squareSideMidpoints(a)
  const sidesB = squareSideMidpoints(b)
  let distance = Infinity
  let from = sidesA[0]
  let to = sidesB[0]
  sidesA.forEach((sideA) => {
    sidesB.forEach((sideB) => {
      const sideDistance = Math.hypot(sideA.x - sideB.x, sideA.y - sideB.y)
      if (sideDistance < distance) {
        distance = sideDistance
        from = sideA
        to = sideB
      }
    })
  })
  return { distance, from, to }
}

function computeConnections(squares, scale) {
  const byName = new Map()
  squares.forEach((square) => {
    if (!byName.has(square.roomName)) byName.set(square.roomName, [])
    byName.get(square.roomName).push(square)
  })

  const connections = []
  squares.forEach((square) => {
    Object.entries(square.adjacentRooms).forEach(([name, maxDistance]) => {
      if (Number.isNaN(maxDistance)) return

      const candidates = (byName.get(name) || []).filter((candidate) => candidate.id !== square.id)
      if (candidates.length === 0) return

      const nearest = candidates.reduce((closest, candidate) =>
        centerDistance(square, candidate) < centerDistance(square, closest) ? candidate : closest,
      )

      const { distance, from: fromPoint, to: toPoint } = nearestSidePoints(square, nearest)

      connections.push({
        id: `${square.id}->${nearest.id}-${name}`,
        from: square,
        to: nearest,
        fromPoint,
        toPoint,
        violated: distance > maxDistance * scale,
      })
    })
  })

  return connections
}

function packSquares(squares, containerWidth) {
  let x = GAP
  let y = GAP
  let rowHeight = 0
  return squares.map((square) => {
    if (x + square.width + GAP > containerWidth && x > GAP) {
      x = GAP
      y += rowHeight + GAP
      rowHeight = 0
    }
    const placed = { ...square, x, y }
    x += square.width + GAP
    rowHeight = Math.max(rowHeight, square.height)
    return placed
  })
}

function RoomCanvas({ rooms }) {
  const containerRef = useRef(null)
  const dragState = useRef(null)
  const resizeState = useRef({})
  const panState = useRef(null)
  const [squares, setSquares] = useState([])
  const [scale, setScale] = useState(1)
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [isPanning, setIsPanning] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  useLayoutEffect(() => {
    if (rooms.length === 0) {
      setSquares([])
      setScale(1)
      setView({ zoom: 1, pan: { x: 0, y: 0 } })
      return
    }
    const computedScale = computeScale(rooms)
    const width = containerRef.current?.clientWidth || 800
    setScale(computedScale)
    setSquares(packSquares(computeSizes(rooms, computedScale), width))
  }, [rooms])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (event) => {
      event.preventDefault()
      const containerRect = container.getBoundingClientRect()
      const pointerX = event.clientX - containerRect.left
      const pointerY = event.clientY - containerRect.top

      setView((prev) => {
        const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.zoom - event.deltaY * ZOOM_SPEED))
        const ratio = nextZoom / prev.zoom
        return {
          zoom: nextZoom,
          pan: {
            x: pointerX - ratio * (pointerX - prev.pan.x),
            y: pointerY - ratio * (pointerY - prev.pan.y),
          },
        }
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  const getLayoutPointerPosition = (event) => {
    const containerRect = containerRef.current.getBoundingClientRect()
    return {
      x: (event.clientX - containerRect.left - view.pan.x) / view.zoom,
      y: (event.clientY - containerRect.top - view.pan.y) / view.zoom,
    }
  }

  const handlePanPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (!event.shiftKey) setSelectedIds(new Set())
    panState.current = { startX: event.clientX, startY: event.clientY, startPan: view.pan }
    setIsPanning(true)
  }

  const handlePanPointerMove = (event) => {
    if (!panState.current) return
    const { startX, startY, startPan } = panState.current
    setView((prev) => ({
      ...prev,
      pan: {
        x: startPan.x + (event.clientX - startX),
        y: startPan.y + (event.clientY - startY),
      },
    }))
  }

  const handlePanPointerUp = (event) => {
    if (!panState.current) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    panState.current = null
    setIsPanning(false)
  }

  const handlePointerDown = (event, square) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    if (event.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(square.id)) next.delete(square.id)
        else next.add(square.id)
        return next
      })
      return
    }

    const isGroupMember = selectedIds.has(square.id) && selectedIds.size > 1
    const activeSelection = isGroupMember ? selectedIds : new Set([square.id])
    if (!isGroupMember) setSelectedIds(activeSelection)

    const pointerStart = getLayoutPointerPosition(event)
    const startPositions = new Map()
    squares.forEach((sq) => {
      if (activeSelection.has(sq.id)) startPositions.set(sq.id, { x: sq.x, y: sq.y })
    })

    dragState.current = {
      startPointerX: pointerStart.x,
      startPointerY: pointerStart.y,
      startPositions,
    }
  }

  const handlePointerMove = (event) => {
    event.stopPropagation()
    const state = dragState.current
    if (!state || !containerRef.current) return

    const pointerNow = getLayoutPointerPosition(event)
    const deltaX = pointerNow.x - state.startPointerX
    const deltaY = pointerNow.y - state.startPointerY

    setSquares((prev) =>
      prev.map((square) => {
        const start = state.startPositions.get(square.id)
        if (!start) return square
        return { ...square, x: start.x + deltaX, y: start.y + deltaY }
      }),
    )
  }

  const handlePointerUp = (event) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragState.current = null
  }

  const handleResizePointerDown = (event, id) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const square = squares.find((sq) => sq.id === id)
    if (!square) return
    resizeState.current[id] = { startX: event.clientX, startWidth: square.width, area: square.area, minWidth: square.minWidth }
  }

  const handleResizePointerMove = (event, id) => {
    event.stopPropagation()
    const state = resizeState.current[id]
    if (!state) return

    const minWidthPx = Number.isFinite(state.minWidth) && state.minWidth > 0 ? state.minWidth * scale : 0
    const desiredWidth = state.startWidth + (event.clientX - state.startX) / view.zoom
    const { width, height } = clampWidthToArea(desiredWidth, state.area, minWidthPx)

    setSquares((prev) =>
      prev.map((square) => (square.id === id ? { ...square, width, height } : square)),
    )
  }

  const handleResizePointerUp = (event, id) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    delete resizeState.current[id]
  }

  const handleSquareDoubleClick = (event, square) => {
    event.stopPropagation()
    if (editingId === square.id) return
    setEditingId(square.id)
    setEditValue((square.width / scale).toFixed(2))
  }

  const commitWidthEdit = (id) => {
    setSquares((prev) =>
      prev.map((square) => {
        if (square.id !== id) return square
        const widthMeters = parseFloat(editValue)
        if (!Number.isFinite(widthMeters) || widthMeters <= 0) return square
        const minWidthPx = Number.isFinite(square.minWidth) && square.minWidth > 0 ? square.minWidth * scale : 0
        const { width, height } = clampWidthToArea(widthMeters * scale, square.area, minWidthPx)
        return { ...square, width, height }
      }),
    )
    setEditingId(null)
  }

  const connections = computeConnections(squares, scale)
  const violatedIds = new Set(connections.filter((c) => c.violated).flatMap((c) => [c.from.id, c.to.id]))

  const handleExport = () => {
    const dxf = buildDxf({ squares, connections, violatedIds, scale })
    downloadDxf(dxf, 'room-layout.dxf')
  }

  return (
    <>
      {squares.length > 0 && (
        <button type="button" className="export-button" onClick={handleExport}>
          Export as DXF
        </button>
      )}
      <div
        className={`canvas${isPanning ? ' canvas--panning' : ''}`}
        ref={containerRef}
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerUp}
      >
        {squares.length === 0 && <p className="canvas-empty">Load a file to see room squares.</p>}
        <div className="canvas-content" style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})` }}>
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
          </svg>
          {squares.map((square) => (
            <div
              key={square.id}
              className={`room-square${violatedIds.has(square.id) ? ' room-square--violated' : ''}${selectedIds.has(square.id) ? ' room-square--selected' : ''}`}
              style={{
                width: square.width,
                height: square.height,
                transform: `translate(${square.x}px, ${square.y}px)`,
                ...(square.color && !violatedIds.has(square.id) ? { backgroundColor: square.color } : {}),
              }}
              onPointerDown={(event) => handlePointerDown(event, square)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={(event) => handleSquareDoubleClick(event, square)}
            >
              <div
                className="room-square__resize-handle"
                onPointerDown={(event) => handleResizePointerDown(event, square.id)}
                onPointerMove={(event) => handleResizePointerMove(event, square.id)}
                onPointerUp={(event) => handleResizePointerUp(event, square.id)}
              >
                <svg
                  className="room-square__resize-icon"
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
          {squares.map((square) => (
            <div
              key={`${square.id}-label`}
              className="room-square-label"
              style={{
                width: square.width,
                height: square.height,
                fontSize: Math.max(11, Math.min(square.width, square.height) / 8),
                transform: `translate(${square.x}px, ${square.y}px)`,
                ...(square.color && !violatedIds.has(square.id)
                  ? { color: getContrastTextColor(square.color) }
                  : {}),
              }}
            >
              <span className="room-square__name">{square.roomName}</span>
              {editingId === square.id ? (
                <label className="room-square__dimension-label">
                  Set width:
                  <input
                    type="number"
                    className="room-square__dimension-input"
                    value={editValue}
                    step="0.01"
                    min="0"
                    autoFocus
                    onChange={(event) => setEditValue(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => commitWidthEdit(square.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitWidthEdit(square.id)
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                </label>
              ) : (
                <span className="room-square__area">{formatDimensions(square, scale)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default RoomCanvas
