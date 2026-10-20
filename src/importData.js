export const MAX_COUNT_PER_ROW = 200
export const MAX_ROOMS = 2000

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

const isPositive = (value) => Number.isFinite(value) && value > 0

export function sanitizeColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : undefined
}

// Keeps only entries with a finite, non-negative distance - a NaN or negative
// max distance would otherwise flow into the connection/violation maths.
export function sanitizeAdjacentRooms(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result = {}
  Object.entries(value).forEach(([name, distance]) => {
    if (name && Number.isFinite(distance) && distance >= 0) result[name] = distance
  })
  return result
}

// Saved geometry is all-or-nothing: x/y/width/height/area are only meaningful
// together (and at one shared scale), so a room missing any of them is
// treated as unplaced and gets repacked rather than half-restored.
function sanitizeGeometry(room) {
  const { x, y, width, height, area } = room
  const hasPlacement = Number.isFinite(x) && Number.isFinite(y) && isPositive(width) && isPositive(height) && isPositive(area)
  return hasPlacement ? { x, y, width, height, area } : {}
}

// Returns a clean room object, or null if the entry can't be a real room.
function normalizeRoom(room) {
  if (!room || typeof room !== 'object') return null
  const roomName = typeof room.roomName === 'string' ? room.roomName.trim() : ''
  if (!roomName || !isPositive(room.targetArea)) return null

  return {
    roomName,
    targetArea: room.targetArea,
    adjacentRooms: sanitizeAdjacentRooms(room.adjacentRooms),
    minWidth: isPositive(room.minWidth) ? room.minWidth : undefined,
    color: sanitizeColor(room.color),
    ...sanitizeGeometry(room),
  }
}

// Turns an array of untrusted room entries into the { id: room } map the app
// stores, dropping invalid entries and de-duplicating ids. Throws if nothing
// usable remains or the file is implausibly large.
export function normalizeRoomsArray(roomsArray) {
  if (roomsArray.length > MAX_ROOMS) {
    throw new Error(`That layout has ${roomsArray.length} rooms - the maximum supported is ${MAX_ROOMS}.`)
  }

  const rooms = {}
  roomsArray.forEach((entry, index) => {
    const room = normalizeRoom(entry)
    if (!room) return
    const baseId = typeof entry.id === 'string' && entry.id ? entry.id : `room-${index}`
    let id = baseId
    for (let suffix = 1; id in rooms; suffix += 1) id = `${baseId}-${suffix}`
    rooms[id] = room
  })

  if (Object.keys(rooms).length === 0) {
    throw new Error('The layout file does not contain any valid rooms (each needs a name and a positive target area).')
  }
  return rooms
}

// Drops corridor nodes/edges that would crash or poison the geometry code:
// non-finite coordinates, missing ids, edges pointing at missing nodes, or
// non-positive widths.
export function normalizeCorridors(nodes, edges) {
  const seenNodeIds = new Set()
  const cleanNodes = (Array.isArray(nodes) ? nodes : []).flatMap((node) => {
    if (!node || typeof node.id !== 'string' || !node.id || seenNodeIds.has(node.id)) return []
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return []
    seenNodeIds.add(node.id)
    return [{ id: node.id, x: node.x, y: node.y }]
  })

  const seenEdgeIds = new Set()
  const cleanEdges = (Array.isArray(edges) ? edges : []).flatMap((edge) => {
    if (!edge || typeof edge.id !== 'string' || !edge.id || seenEdgeIds.has(edge.id)) return []
    if (!seenNodeIds.has(edge.nodeAId) || !seenNodeIds.has(edge.nodeBId) || edge.nodeAId === edge.nodeBId) return []
    if (!isPositive(edge.widthMeters)) return []
    seenEdgeIds.add(edge.id)
    return [{ id: edge.id, nodeAId: edge.nodeAId, nodeBId: edge.nodeBId, widthMeters: edge.widthMeters, color: sanitizeColor(edge.color) }]
  })

  return { corridorNodes: cleanNodes, corridorEdges: cleanEdges }
}
