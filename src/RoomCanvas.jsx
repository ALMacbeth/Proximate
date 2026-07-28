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
    const size = Math.max(MIN_SIZE, Math.round(Math.sqrt(Math.max(room.targetArea, 0)) * scale))
    return {
      id: room.id,
      roomName: room.roomName,
      targetArea: room.targetArea,
      adjacentRooms: room.adjacentRooms || {},
      width: size,
      height: size,
      area: size * size,
    }
  })
}

function centerDistance(a, b) {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

function squareCorners(square) {
  return [
    { x: square.x, y: square.y },
    { x: square.x + square.width, y: square.y },
    { x: square.x, y: square.y + square.height },
    { x: square.x + square.width, y: square.y + square.height },
  ]
}

function nearestCornerPoints(a, b) {
  const cornersA = squareCorners(a)
  const cornersB = squareCorners(b)
  let distance = Infinity
  let from = cornersA[0]
  let to = cornersB[0]
  cornersA.forEach((cornerA) => {
    cornersB.forEach((cornerB) => {
      const cornerDistance = Math.hypot(cornerA.x - cornerB.x, cornerA.y - cornerB.y)
      if (cornerDistance < distance) {
        distance = cornerDistance
        from = cornerA
        to = cornerB
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

      const { distance, from: fromPoint, to: toPoint } = nearestCornerPoints(square, nearest)

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
  const offsets = useRef({})
  const resizeState = useRef({})
  const panState = useRef(null)
  const [squares, setSquares] = useState([])
  const [scale, setScale] = useState(1)
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [isPanning, setIsPanning] = useState(false)

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

  const handlePanPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
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

  const handlePointerDown = (event, id) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    offsets.current[id] = {
      offsetX: (event.clientX - rect.left) / view.zoom,
      offsetY: (event.clientY - rect.top) / view.zoom,
    }
  }

  const handlePointerMove = (event, id) => {
    event.stopPropagation()
    const offset = offsets.current[id]
    if (!offset || !containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()

    setSquares((prev) =>
      prev.map((square) => {
        if (square.id !== id) return square
        const layoutX = (event.clientX - containerRect.left - view.pan.x) / view.zoom
        const layoutY = (event.clientY - containerRect.top - view.pan.y) / view.zoom
        return { ...square, x: layoutX - offset.offsetX, y: layoutY - offset.offsetY }
      }),
    )
  }

  const handlePointerUp = (event, id) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    delete offsets.current[id]
  }

  const handleResizePointerDown = (event, id) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const square = squares.find((sq) => sq.id === id)
    if (!square) return
    resizeState.current[id] = { startX: event.clientX, startWidth: square.width, area: square.area }
  }

  const handleResizePointerMove = (event, id) => {
    event.stopPropagation()
    const state = resizeState.current[id]
    if (!state) return

    const maxWidth = state.area / MIN_DIMENSION
    const width = Math.min(
      maxWidth,
      Math.max(MIN_DIMENSION, state.startWidth + (event.clientX - state.startX) / view.zoom),
    )
    const height = state.area / width

    setSquares((prev) =>
      prev.map((square) =>
        square.id === id ? { ...square, width: Math.round(width), height: Math.round(height) } : square,
      ),
    )
  }

  const handleResizePointerUp = (event, id) => {
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    delete resizeState.current[id]
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
              className={`room-square${violatedIds.has(square.id) ? ' room-square--violated' : ''}`}
              style={{
                width: square.width,
                height: square.height,
                fontSize: Math.max(11, Math.min(square.width, square.height) / 8),
                transform: `translate(${square.x}px, ${square.y}px)`,
              }}
              onPointerDown={(event) => handlePointerDown(event, square.id)}
              onPointerMove={(event) => handlePointerMove(event, square.id)}
              onPointerUp={(event) => handlePointerUp(event, square.id)}
            >
              <span className="room-square__name">{square.roomName}</span>
              <span className="room-square__area">{Number.isNaN(square.targetArea) ? '—' : square.targetArea}</span>
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
        </div>
      </div>
    </>
  )
}

export default RoomCanvas
