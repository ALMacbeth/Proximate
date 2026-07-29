const MIN_SIZE = 48
const MAX_SIZE = 200
// Kept small: zoom lets the user compensate for a visually tiny room, so this
// only needs to guard against clampWidthToArea's area/width blowing up near
// zero — not guarantee comfortable clicking at the default zoom level. A
// smaller floor also shrinks MIN_DIMENSION^2, making it far less likely a
// small room's true area falls below it when sharing a file with a much
// larger room (which would otherwise freeze its resize range at one point).
const MIN_DIMENSION = 6
const GAP = 12

export function computeScale(rooms) {
  const areas = rooms.map((room) => (Number.isFinite(room.targetArea) && room.targetArea > 0 ? room.targetArea : 0))
  const maxArea = Math.max(...areas, 1)
  return MAX_SIZE / Math.sqrt(maxArea)
}

// Builds the on-canvas box for each room: initial width/height are equal
// (a square) sized so area on screen is proportional to targetArea. `area`
// is recorded as the room's true physical area (targetArea * scale^2), not
// size^2 — size can be inflated above that by MIN_SIZE/MIN_DIMENSION/minWidth
// floors, and preserving THAT inflated value through resize (instead of the
// real target area) previously caused resize bounds to collapse to a single,
// frozen point for small rooms sharing a file with a much larger one.
export function computeRoomBoxes(rooms, scale) {
  return rooms.map((room) => {
    const areaSize = Math.sqrt(Math.max(room.targetArea, 0)) * scale
    const hasMinWidth = Number.isFinite(room.minWidth) && room.minWidth > 0
    const minWidthPx = hasMinWidth ? room.minWidth * scale : 0

    // MIN_SIZE is a purely cosmetic pixel floor for rooms with no explicit
    // minWidth, so tiny/unconstrained rooms stay clickable regardless of
    // scale. It must NOT apply once a real minWidth is set — otherwise, in a
    // file mixing a very large room (which shrinks `scale`) with a small
    // one, MIN_SIZE can silently outrank the user's actual minWidth in the
    // Math.max below, rendering (and displaying) a value that has nothing
    // to do with either the room's area or its configured minimum.
    const size = hasMinWidth
      ? Math.max(MIN_DIMENSION, minWidthPx, areaSize)
      : Math.max(MIN_SIZE, areaSize)

    return {
      id: room.id,
      roomName: room.roomName,
      targetArea: room.targetArea,
      adjacentRooms: room.adjacentRooms || {},
      minWidth: room.minWidth,
      color: room.color,
      width: size,
      height: size,
      area: Math.max(room.targetArea, 0) * scale * scale,
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

  // Note: for a room whose true area is smaller than lowerBound^2, this
  // collapses upperBound to lowerBound — the room can't be resized at all
  // without exceeding its target area, so it stays fixed at its minimum
  // size rather than growing past it.
  const width = Math.min(upperBound, Math.max(lowerBound, desiredWidth))
  const height = Math.max(MIN_DIMENSION, minWidthPx, area / width)
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

const SNAP_TARGET_KINDS = ['start', 'center', 'end']

function edgePoints(min, size) {
  return { start: min, center: min + size / 2, end: min + size }
}

// Shared snap search along one axis. `others` is an array of
// { min, size, crossMin, crossSize } — position/size on the snap axis, plus
// position/size on the perpendicular axis (needed to draw a guide line that
// spans both the moving and matched boxes). `anchorOnly` restricts the
// moving box to only its far edge as a snap candidate (resizing, where the
// near edge is fixed); otherwise start/center/end are all candidates
// (dragging, where the whole box moves). Returns the delta to apply plus a
// `guide` — the matched coordinate and the perpendicular span to draw a line
// across — or `guide: null` if nothing was within `threshold`.
function findAxisSnap(min, size, crossMin, crossSize, others, threshold, anchorOnly) {
  const moving = edgePoints(min, size)
  const movingKinds = anchorOnly ? ['end'] : SNAP_TARGET_KINDS

  let bestDelta = 0
  let bestDistance = threshold
  let bestGuide = null

  others.forEach((other) => {
    const otherPoints = edgePoints(other.min, other.size)
    movingKinds.forEach((movingKind) => {
      SNAP_TARGET_KINDS.forEach((otherKind) => {
        const distance = Math.abs(otherPoints[otherKind] - moving[movingKind])
        if (distance < bestDistance) {
          bestDistance = distance
          bestDelta = otherPoints[otherKind] - moving[movingKind]
          bestGuide = {
            position: otherPoints[otherKind],
            from: Math.min(crossMin, other.crossMin),
            to: Math.max(crossMin + crossSize, other.crossMin + other.crossSize),
          }
        }
      })
    })
  })

  return { delta: bestDelta, guide: bestGuide }
}

// Dragging: the moving box's start, center, and end are all snap candidates.
export function computeDragSnap(min, size, crossMin, crossSize, others, threshold) {
  return findAxisSnap(min, size, crossMin, crossSize, others, threshold, false)
}

// Resizing: only the far edge (min + size) actually moves — the near edge is
// anchored — so only that edge is a snap candidate.
export function computeResizeSnap(min, size, crossMin, crossSize, others, threshold) {
  return findAxisSnap(min, size, crossMin, crossSize, others, threshold, true)
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
