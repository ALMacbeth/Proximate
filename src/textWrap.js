// Rough average character width as a fraction of text height — good enough
// to keep long room names from overflowing their box in exported files
// (DXF/SVG have no native word-wrap, unlike the on-canvas CSS label, which
// gets it for free from overflow-wrap: break-word), without needing real
// glyph metrics or a DOM/canvas to measure against.
const AVERAGE_CHAR_WIDTH_RATIO = 0.55

// Greedy word-wrap: packs words onto a line until the next one would exceed
// maxWidth, then starts a new line. A single word longer than maxWidth is
// left on its own line rather than split mid-word.
export function wrapText(text, maxWidth, fontSize) {
  const words = String(text).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * AVERAGE_CHAR_WIDTH_RATIO)))
  const lines = []
  let currentLine = ''

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (candidate.length <= maxChars || !currentLine) {
      currentLine = candidate
    } else {
      lines.push(currentLine)
      currentLine = word
    }
  })
  if (currentLine) lines.push(currentLine)

  return lines
}
