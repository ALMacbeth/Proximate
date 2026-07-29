const MIN_SIZE = 48
const MAX_SIZE = 200
const MIN_DIMENSION = 24
const GAP = 12

export function computeScale(rooms) {
  const areas = rooms.map((room) => (Number.isFinite(room.targetArea) && room.targetArea > 0 ? room.targetArea : 0))
  const maxArea = Math.max(...areas, 1)
  return MAX_SIZE / Math.sqrt(maxArea)
}

// Builds the on-canvas box for each room: initial width/height are equal
// (a square) sized so area on screen is proportional to targetArea, with
// MIN_SIZE and the optional per-room minWidth as floors. `area` is recorded
// here (not recomputed later) so resizing can preserve it exactly even after
// the box becomes a non-square rectangle.
export function computeRoomBoxes(rooms, scale) {
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

// Resize is one-dimensional (width is dragged/typed directly), so height is
// derived as area / width to keep the room's target area constant while its
// aspect ratio changes. Bounds ensure neither dimension can cross the
// room's minWidth floor or the global MIN_DIMENSION floor.
export function clampWidthToArea(desiredWidth, area, minWidthPx) {
  const lowerBound = Math.max(MIN_DIMENSION, minWidthPx)
  const upperBound = Math.max(lowerBound, Math.min(area / MIN_DIMENSION, minWidthPx > 0 ? area / minWidthPx : Infinity))
  const width = Math.min(upperBound, Math.max(lowerBound, desiredWidth))
  const height = Math.max(minWidthPx, area / width)
  return { width, height }
}

export function formatDimensions(roomBox, scale) {
  const widthMeters = roomBox.width / scale
  const heightMeters = roomBox.height / scale
  return `${widthMeters.toFixed(2)} x ${heightMeters.toFixed(2)}`
}

export function getContrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#000000' : '#ffffff'
}

export function centerDistance(a, b) {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

function sideMidpoints(roomBox) {
  return [
    { x: roomBox.x + roomBox.width / 2, y: roomBox.y }, // top
    { x: roomBox.x + roomBox.width, y: roomBox.y + roomBox.height / 2 }, // right
    { x: roomBox.x + roomBox.width / 2, y: roomBox.y + roomBox.height }, // bottom
    { x: roomBox.x, y: roomBox.y + roomBox.height / 2 }, // left
  ]
}

export function nearestSidePoints(a, b) {
  const sidesA = sideMidpoints(a)
  const sidesB = sideMidpoints(b)
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

// For each room's adjacency entries, finds the nearest other room with that
// name (by center distance) and records the closest side-to-side points and
// whether that gap exceeds the entry's max distance.
export function computeConnections(roomBoxes, scale) {
  const byName = new Map()
  roomBoxes.forEach((roomBox) => {
    if (!byName.has(roomBox.roomName)) byName.set(roomBox.roomName, [])
    byName.get(roomBox.roomName).push(roomBox)
  })

  const connections = []
  roomBoxes.forEach((roomBox) => {
    Object.entries(roomBox.adjacentRooms).forEach(([name, maxDistance]) => {
      if (Number.isNaN(maxDistance)) return

      const candidates = (byName.get(name) || []).filter((candidate) => candidate.id !== roomBox.id)
      if (candidates.length === 0) return

      const nearest = candidates.reduce((closest, candidate) =>
        centerDistance(roomBox, candidate) < centerDistance(roomBox, closest) ? candidate : closest,
      )

      const { distance, from: fromPoint, to: toPoint } = nearestSidePoints(roomBox, nearest)

      connections.push({
        id: `${roomBox.id}->${nearest.id}-${name}`,
        from: roomBox,
        to: nearest,
        fromPoint,
        toPoint,
        violated: distance > maxDistance * scale,
      })
    })
  })

  return connections
}

// Simple shelf-packing for the initial layout: fills a row left-to-right,
// wrapping to a new row once a box would overflow containerWidth.
export function packRoomBoxes(roomBoxes, containerWidth) {
  let x = GAP
  let y = GAP
  let rowHeight = 0
  return roomBoxes.map((roomBox) => {
    if (x + roomBox.width + GAP > containerWidth && x > GAP) {
      x = GAP
      y += rowHeight + GAP
      rowHeight = 0
    }
    const placed = { ...roomBox, x, y }
    x += roomBox.width + GAP
    rowHeight = Math.max(rowHeight, roomBox.height)
    return placed
  })
}
