// The "modern" build (plain 'pdfjs-dist') assumes JS engine features not
// yet broadly shipped in real browsers — e.g. it throws
// "this[#methodPromises].getOrInsertComputed is not a function" during
// render, a brand-new, not-yet-standard Map method. legacy/build trades
// that assumption for broader compatibility, which is what a real user's
// browser needs.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// The worker script is copied into public/ (kept in sync with the installed
// pdfjs-dist version, from the same legacy build as the import above) rather
// than imported from node_modules directly — Vite's dev server rewrites
// every .mjs it serves to inject its own HMR client, even from
// node_modules, which corrupts this file enough that the worker never
// responds and getDocument() hangs forever with no error. Files under
// public/ are served verbatim, sidestepping that rewrite.
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`

// Same reasoning as the worker above — copied into public/ rather than
// referenced inside node_modules — plus required for a different reason:
// any page using a standard (non-embedded) font, e.g. plain Helvetica text,
// makes page.render() hang indefinitely with no error at all if pdf.js has
// nowhere to fetch that font's substitute glyph data from.
const STANDARD_FONT_DATA_URL = `${import.meta.env.BASE_URL}pdfjs-standard-fonts/`
const CMAP_URL = `${import.meta.env.BASE_URL}pdfjs-cmaps/`

// Also required for any page containing a raster image compressed as JPX
// or JBIG2 (common in scanned/rasterized floor plans) — pdf.js decodes
// those via a WASM module and otherwise looks for it at a bare "wasm"
// path that doesn't resolve to anything real here.
const WASM_URL = `${import.meta.env.BASE_URL}pdfjs-wasm/`

// Oversampling the PDF page render (rather than rendering at native scale=1)
// keeps the underlay from looking blurry once the user zooms in on the
// canvas, since the room canvas has its own independent zoom on top of this.
const RENDER_SCALE = 2

// A PDF's own "user space" units are points (1/72 inch) — this is what a
// page's un-oversampled dimensions are measured in, independent of however
// many pixels we choose to render it at.
const POINTS_PER_INCH = 72
const METERS_PER_INCH = 0.0254

export function pointsToMeters(points) {
  return (points / POINTS_PER_INCH) * METERS_PER_INCH
}

// Renders a PDF file's first page to a PNG data URL, for use as a static
// canvas underlay. Returns the image alongside both its rendered pixel
// dimensions and its actual printed page size (in points) — callers need
// the latter to turn a drawing scale ("1:500") into a real-world size,
// since that's a multiple of the page's own printed dimensions, not of
// however many pixels it happens to have been rendered at.
export async function renderPdfFirstPageToImage(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    wasmUrl: WASM_URL,
  }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: RENDER_SCALE })
  const pagePointsViewport = page.getViewport({ scale: 1 })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  // Default render intent schedules its internal steps via
  // requestAnimationFrame, which browsers suspend for backgrounded/hidden
  // tabs — a PDF dropped just before switching tabs would then hang forever
  // with no error. 'print' intent uses a plain microtask loop instead, with
  // no dependency on the tab being visible/foregrounded to make progress.
  await page.render({ canvasContext: context, viewport, intent: 'print' }).promise

  return {
    dataUrl: canvas.toDataURL('image/png'),
    pixelWidth: viewport.width,
    pixelHeight: viewport.height,
    pageWidthPoints: pagePointsViewport.width,
    pageHeightPoints: pagePointsViewport.height,
  }
}
