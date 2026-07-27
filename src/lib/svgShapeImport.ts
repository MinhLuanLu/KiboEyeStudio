import { normalizePoints } from '@/renderer/pupilShapes'

const SAMPLE_COUNT = 48

/** Thrown for any SVG that can't be turned into a pupil shape — caught at the call site and
 * shown to the user as a plain-language error rather than crashing the import flow. */
export class SvgShapeImportError extends Error {}

/**
 * Parses an SVG file's first `<path>` element into a normalized [-1,1] polygon usable as a
 * custom pupil shape — the same representation every built-in shape in pupilShapes.ts uses.
 *
 * Only the first `<path>` is read (single-outline-shape constraint, stated in the import UI)
 * — walked via the browser's own SVGGeometryElement.getPointAtLength(), so arcs/beziers/etc.
 * in the path data are sampled correctly without needing a hand-written path parser.
 */
export function parseSvgToPolygon(svgText: string): [number, number][] {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {
    throw new SvgShapeImportError('That file is not a valid SVG.')
  }
  const path = doc.querySelector('path')
  if (!path || !(path instanceof SVGGeometryElement)) {
    throw new SvgShapeImportError('No <path> element found — custom pupil shapes need a single SVG <path>.')
  }
  const totalLength = path.getTotalLength()
  if (!(totalLength > 0)) {
    throw new SvgShapeImportError("That SVG path has no length — it can't be traced into a shape.")
  }
  const raw: [number, number][] = []
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const point = path.getPointAtLength((i / SAMPLE_COUNT) * totalLength)
    raw.push([point.x, point.y])
  }
  return normalizePoints(raw)
}
