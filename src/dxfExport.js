const ACI_RED = 1
const ACI_GREEN = 3

function toMeters(square, scale) {
  const realWidth = square.width / scale
  const realHeight = square.height / scale
  const centerX = (square.x + square.width / 2) / scale
  const centerY = -(square.y + square.height / 2) / scale
  return { centerX, centerY, realWidth, realHeight }
}

function pointToMeters(point, scale) {
  return { x: point.x / scale, y: -point.y / scale }
}

function lineEntity(x1, y1, x2, y2, layer, color) {
  const lines = ['0', 'LINE', '8', layer]
  if (color) lines.push('62', String(color))
  lines.push('10', x1.toFixed(4), '20', y1.toFixed(4), '30', '0.0', '11', x2.toFixed(4), '21', y2.toFixed(4), '31', '0.0')
  return lines.join('\n')
}

function textEntity(x, y, height, text, layer, color) {
  const lines = ['0', 'TEXT', '8', layer]
  if (color) lines.push('62', String(color))
  lines.push('10', x.toFixed(4), '20', y.toFixed(4), '30', '0.0', '40', height.toFixed(3), '1', text)
  return lines.join('\n')
}

function squareEntities(square, scale, color) {
  const { centerX, centerY, realWidth, realHeight } = toMeters(square, scale)
  const halfWidth = realWidth / 2
  const halfHeight = realHeight / 2
  const corners = [
    [centerX - halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY + halfHeight],
    [centerX - halfWidth, centerY + halfHeight],
  ]
  const sides = corners.map((corner, index) => {
    const next = corners[(index + 1) % corners.length]
    return lineEntity(corner[0], corner[1], next[0], next[1], 'ROOMS', color)
  })

  const areaLabel = Number.isNaN(square.targetArea) ? '?' : square.targetArea
  const label = textEntity(
    centerX - halfWidth,
    centerY,
    Math.max(0.15, Math.min(Math.min(realWidth, realHeight) / 4, 0.5)),
    `${square.roomName} (${areaLabel} m2)`,
    'ROOMS',
    color,
  )

  return [...sides, label]
}

function connectionEntity(connection, scale) {
  const from = pointToMeters(connection.fromPoint, scale)
  const to = pointToMeters(connection.toPoint, scale)
  const color = connection.violated ? ACI_RED : ACI_GREEN
  return lineEntity(from.x, from.y, to.x, to.y, 'CONNECTIONS', color)
}

export function buildDxf({ squares, connections, violatedIds, scale }) {
  const entities = []

  squares.forEach((square) => {
    const color = violatedIds.has(square.id) ? ACI_RED : null
    entities.push(...squareEntities(square, scale, color))
  })

    //don't plot distance lines (add a toggle for this option later)

  /*connections.forEach((connection) => {
    entities.push(connectionEntity(connection, scale))
  })*/

  return ['0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\n')
}

export function downloadDxf(content, filename) {
  const blob = new Blob([content], { type: 'application/dxf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
