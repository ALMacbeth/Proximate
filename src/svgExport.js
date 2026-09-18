import { computeEdgeOffsetPolygon, computeJunctionFill, computeNodeDegrees } from './corridorGeometry.js'
import { formatDimensions, getContrastTextColor } from './geometry.js'
import { wrapText } from './textWrap.js'

// Colors are baked in as literal values (the app's --accent-bg/--corridor-fill
// etc. are CSS custom properties that won't resolve once this file is opened
// outside the app) — taken from the light theme in index.css, since a
// standalone export shouldn't depend on the viewer's OS/browser theme.
// Translucent colors are split into a plain hex color plus a separate
// fill-opacity/stroke-opacity attribute rather than an rgba() paint value —
// browsers render rgba() fine, but several vector/CAD import tools this file
// is meant for don't reliably parse it, which can make a border (like the
// room box's) silently disappear even though it looks correct on canvas.
const COLORS = {
  wallOutline: '#6b6375',
  corridorFill: '#e9ebee',
  corridorStrokeColor: '#000000',
  corridorStrokeOpacity: 0.25,
  roomFillColor: '#aa3bff',
  roomFillOpacity: 0.1,
  roomStrokeColor: '#000000',
  roomStrokeOpacity: 0.5,
  roomViolatedFillColor: '#e5484d',
  roomViolatedFillOpacity: 0.15,
  roomViolatedStroke: '#e5484d',
  textDark: '#08060d',
  connectionOk: '#2f9e44',
  connectionViolated: '#e5484d',
}

const MARGIN_PX = 40

function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
  )
}

function expandBounds(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.maxY = Math.max(bounds.maxY, y)
}

// Wraps one category of shapes in a named group. Recognized as an actual
// toggleable layer by Inkscape (inkscape:groupmode/label) and by
// Illustrator's "Convert Layers to: Layers" SVG import option (id/<title>);
// tools that understand neither just see a plain, harmlessly-named <g>.
// Skipped entirely when there's nothing in it, rather than emitting an empty
// layer.
function layerGroup(id, label, elements) {
  if (elements.length === 0) return ''
  return `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(label)}"><title>${escapeXml(label)}</title>\n${elements.join('\n')}\n</g>`
}

// Builds a self-contained SVG string of everything visible on the canvas
// (rooms, wall outlines, corridors, junctions, connections) directly from
// the same state/geometry helpers RoomCanvas.jsx renders from — not a
// snapshot of the live DOM, which carries pan/zoom transforms, UI-only
// elements (handles, hit-targets, selection/snap guides) and CSS variables
// that wouldn't resolve outside the app.
export function buildSvg({ roomBoxes, corridorNodes, corridorEdges, connections, violatedIds, scale, wallOffsetPx = 0 }) {
  const nodeById = new Map(corridorNodes.map((node) => [node.id, node]))
  const nodeDegrees = computeNodeDegrees(corridorEdges)
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  roomBoxes.forEach((box) => {
    expandBounds(bounds, box.x - wallOffsetPx, box.y - wallOffsetPx)
    expandBounds(bounds, box.x + box.width + wallOffsetPx, box.y + box.height + wallOffsetPx)
  })

  const corridorShapes = corridorEdges
    .map((edge) => {
      const nodeA = nodeById.get(edge.nodeAId)
      const nodeB = nodeById.get(edge.nodeBId)
      if (!nodeA || !nodeB) return null
      const widthPx = edge.widthMeters * scale
      const polygon = computeEdgeOffsetPolygon(nodeA, nodeB, widthPx)
      if (!polygon) return null
      polygon.forEach((p) => expandBounds(bounds, p.x, p.y))

      const outline = wallOffsetPx > 0 ? computeEdgeOffsetPolygon(nodeA, nodeB, widthPx + wallOffsetPx * 2) : null
      if (outline) outline.forEach((p) => expandBounds(bounds, p.x, p.y))

      return { edge, polygon, outline }
    })
    .filter(Boolean)

  if (!Number.isFinite(bounds.minX)) {
    bounds.minX = 0
    bounds.minY = 0
    bounds.maxX = 0
    bounds.maxY = 0
  }

  const minX = bounds.minX - MARGIN_PX
  const minY = bounds.minY - MARGIN_PX
  const width = bounds.maxX - bounds.minX + MARGIN_PX * 2
  const height = bounds.maxY - bounds.minY + MARGIN_PX * 2

  // Built as separate arrays (one per exported layer) rather than one flat
  // list, so each category can be wrapped in its own named/toggleable group
  // — kept in the same order as the on-canvas render, so stacking looks
  // identical regardless of layer visibility in the viewing tool.
  const wallOutlineShapes = []
  const connectionShapes = []
  const corridorLayerShapes = []
  const roomShapes = []
  const roomLabelShapes = []

  if (wallOffsetPx > 0) {
    roomBoxes.forEach((box) => {
      wallOutlineShapes.push(
        `<rect x="${box.x - wallOffsetPx}" y="${box.y - wallOffsetPx}" width="${box.width + wallOffsetPx * 2}" height="${box.height + wallOffsetPx * 2}" fill="none" stroke="${COLORS.wallOutline}" stroke-width="1" />`,
      )
    })
    corridorShapes.forEach(({ outline }) => {
      if (!outline) return
      const points = outline.map((p) => `${p.x},${p.y}`).join(' ')
      wallOutlineShapes.push(`<polygon points="${points}" fill="none" stroke="${COLORS.wallOutline}" stroke-width="1" />`)
    })
  }

  connections.forEach((connection) => {
    const stroke = connection.violated ? COLORS.connectionViolated : COLORS.connectionOk
    const dash = connection.violated ? '' : ' stroke-dasharray="6 6"'
    connectionShapes.push(
      `<line x1="${connection.fromPoint.x}" y1="${connection.fromPoint.y}" x2="${connection.toPoint.x}" y2="${connection.toPoint.y}" stroke="${stroke}" stroke-width="2"${dash} />`,
    )
  })

  // Corridor edges, then junction fills on top of them.
  corridorShapes.forEach(({ edge, polygon }) => {
    const points = polygon.map((p) => `${p.x},${p.y}`).join(' ')
    const fill = edge.color || COLORS.corridorFill
    corridorLayerShapes.push(
      `<polygon points="${points}" fill="${fill}" stroke="${COLORS.corridorStrokeColor}" stroke-opacity="${COLORS.corridorStrokeOpacity}" stroke-width="1" />`,
    )
  })
  corridorNodes
    .filter((node) => (nodeDegrees.get(node.id) || 0) >= 2)
    .forEach((node) => {
      const incidentWidthsPx = corridorEdges
        .filter((edge) => edge.nodeAId === node.id || edge.nodeBId === node.id)
        .map((edge) => edge.widthMeters * scale)
      const fill = computeJunctionFill(node, incidentWidthsPx)
      if (!fill) return
      corridorLayerShapes.push(`<circle cx="${fill.cx}" cy="${fill.cy}" r="${fill.r}" fill="${COLORS.corridorFill}" />`)
    })

  roomBoxes.forEach((box) => {
    const violated = violatedIds.has(box.id)
    const fillAttrs = violated
      ? `fill="${COLORS.roomViolatedFillColor}" fill-opacity="${COLORS.roomViolatedFillOpacity}"`
      : box.color
        ? `fill="${box.color}"`
        : `fill="${COLORS.roomFillColor}" fill-opacity="${COLORS.roomFillOpacity}"`
    const strokeAttrs = violated
      ? `stroke="${COLORS.roomViolatedStroke}"`
      : `stroke="${COLORS.roomStrokeColor}" stroke-opacity="${COLORS.roomStrokeOpacity}"`
    roomShapes.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" ${fillAttrs} ${strokeAttrs} stroke-width="2" />`,
    )
  })
  roomBoxes.forEach((box) => {
    const violated = violatedIds.has(box.id)
    const textColor = box.color && !violated ? getContrastTextColor(box.color) : COLORS.textDark
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    const fontSize = Math.max(11, Math.min(box.width, box.height) / 8)
    const dimensionFontSize = fontSize * 0.85

    // Wrap the name to the room's own width, same as the on-canvas label's
    // overflow-wrap: break-word — otherwise a long name just runs past the
    // room's edges in the exported file instead of wrapping like it does
    // on screen. Margin approximates .room-card-label's 0.4em side padding.
    const maxNameWidth = Math.max(1, box.width - fontSize * 0.8)
    const nameLines = wrapText(box.roomName, maxNameWidth, fontSize)
    const lineHeight = fontSize * 1.15
    const totalHeight = nameLines.length * lineHeight + dimensionFontSize * 1.3

    let y = centerY - totalHeight / 2 + lineHeight * 0.8
    nameLines.forEach((line) => {
      roomLabelShapes.push(
        `<text x="${centerX}" y="${y}" text-anchor="middle" font-size="${fontSize}" font-weight="500" fill="${textColor}">${escapeXml(line)}</text>`,
      )
      y += lineHeight
    })
    y += dimensionFontSize * 0.5
    roomLabelShapes.push(
      `<text x="${centerX}" y="${y}" text-anchor="middle" font-size="${dimensionFontSize}" fill="${textColor}" opacity="0.75">${escapeXml(formatDimensions(box, scale))}</text>`,
    )
  })

  // Layer order matches the shape arrays above: outlines and connections
  // sit behind corridors, which sit behind rooms, which sit behind labels.
  const layers = [
    layerGroup('wall-outlines', 'Wall Outlines', wallOutlineShapes),
    layerGroup('connections', 'Connections', connectionShapes),
    layerGroup('corridors', 'Corridors', corridorLayerShapes),
    layerGroup('rooms', 'Rooms', roomShapes),
    layerGroup('room-labels', 'Room Labels', roomLabelShapes),
  ].filter(Boolean)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif">
${layers.join('\n')}
</svg>
`
}
