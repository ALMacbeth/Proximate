import { useLayoutEffect, useRef, useState } from 'react'
import { buildDxf, downloadDxf } from './dxfExport.js'

const MIN_SIZE = 48
const MAX_SIZE = 200
const GAP = 12

function computeScale(rooms) {
  const areas = rooms.map((room) => (Number.isFinite(room.targetArea) && room.targetArea > 0 ? room.targetArea : 0))
  const maxArea = Math.max(...areas, 1)
  return MAX_SIZE / Math.sqrt(maxArea)
}

function computeSizes(rooms) {
  const scale = computeScale(rooms)
  return rooms.map((room) => ({
    id: room.id,
    roomName: room.roomName,
    targetArea: room.targetArea,
    adjacentRooms: room.adjacentRooms || {},
    size: Math.max(MIN_SIZE, Math.round(Math.sqrt(Math.max(room.targetArea, 0)) * scale)),
  }))
}

function centerDistance(a, b) {
  const ax = a.x + a.size / 2
  const ay = a.y + a.size / 2
  const bx = b.x + b.size / 2
  const by = b.y + b.size / 2
  return Math.hypot(ax - bx, ay - by)
}

function squareCorners(square) {
  return [
    { x: square.x, y: square.y },
    { x: square.x + square.size, y: square.y },
    { x: square.x, y: square.y + square.size },
    { x: square.x + square.size, y: square.y + square.size },
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

function computeConnections(squares) {
  const scale = computeScale(squares)
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
    if (x + square.size + GAP > containerWidth && x > GAP) {
      x = GAP
      y += rowHeight + GAP
      rowHeight = 0
    }
    const placed = { ...square, x, y }
    x += square.size + GAP
    rowHeight = Math.max(rowHeight, square.size)
    return placed
  })
}

function RoomCanvas({ rooms }) {
  const containerRef = useRef(null)
  const offsets = useRef({})
  const [squares, setSquares] = useState([])

  useLayoutEffect(() => {
    if (rooms.length === 0) {
      setSquares([])
      return
    }
    const width = containerRef.current?.clientWidth || 800
    setSquares(packSquares(computeSizes(rooms), width))
  }, [rooms])

  const handlePointerDown = (event, id) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    offsets.current[id] = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }
  }

  const handlePointerMove = (event, id) => {
    const offset = offsets.current[id]
    if (!offset || !containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()

    setSquares((prev) =>
      prev.map((square) => {
        if (square.id !== id) return square
        const maxX = Math.max(0, containerRect.width - square.size)
        const maxY = Math.max(0, containerRect.height - square.size)
        const x = Math.min(maxX, Math.max(0, event.clientX - containerRect.left - offset.offsetX))
        const y = Math.min(maxY, Math.max(0, event.clientY - containerRect.top - offset.offsetY))
        return { ...square, x, y }
      }),
    )
  }

  const handlePointerUp = (event, id) => {
    event.currentTarget.releasePointerCapture(event.pointerId)
    delete offsets.current[id]
  }

  const connections = computeConnections(squares)
  const violatedIds = new Set(connections.filter((c) => c.violated).flatMap((c) => [c.from.id, c.to.id]))

  const handleExport = () => {
    const scale = computeScale(squares)
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
      <div className="canvas" ref={containerRef}>
        {squares.length === 0 && <p className="canvas-empty">Load a file to see room squares.</p>}
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
              width: square.size,
              height: square.size,
              fontSize: Math.max(11, square.size / 8),
              transform: `translate(${square.x}px, ${square.y}px)`,
            }}
            onPointerDown={(event) => handlePointerDown(event, square.id)}
            onPointerMove={(event) => handlePointerMove(event, square.id)}
            onPointerUp={(event) => handlePointerUp(event, square.id)}
          >
            <span className="room-square__name">{square.roomName}</span>
            <span className="room-square__area">{Number.isNaN(square.targetArea) ? '—' : square.targetArea}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export default RoomCanvas
