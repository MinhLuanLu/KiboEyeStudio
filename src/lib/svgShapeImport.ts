import { normalizePoints } from '@/renderer/pupilShapes'

const SAMPLE_COUNT = 48

/** Thrown for any SVG that can't be turned into a pupil shape — caught at the call site and
 * shown to the user as a plain-language error rather than crashing the import flow. */
export class SvgShapeImportError extends Error {}

// A `<path>`'s `d` attribute can pack multiple disconnected subpaths into one element (very
// common for real icons — anything with a hole/counter, like a ring or a letter, or a
// compound shape built from more than one closed outline). getTotalLength()/
// getPointAtLength() operate across the WHOLE d string regardless, so sampling evenly by
// arc-length and connecting the dots in order would jump between unrelated subpaths,
// producing a scrambled, self-intersecting trace that fills as an undifferentiated blob
// instead of the actual icon silhouette. Splitting on the first Z/z (path-close command) and
// keeping only what's before it isolates just the first closed subpath — a plain string
// operation, not real path parsing, but sufficient since we only need a delimiter, not to
// understand the curve/arc commands themselves (getPointAtLength still does that part).
function firstSubpathD(d: string): string {
  const match = d.match(/^([^Zz]*[Zz])/)
  return match ? match[1] : d
}

/**
 * Parses an SVG file's first `<path>` element into a normalized [-1,1] polygon usable as a
 * custom pupil shape — the same representation every built-in shape in pupilShapes.ts uses.
 *
 * Only the first `<path>`, and only its first closed subpath (see firstSubpathD() above), is
 * read — walked via the browser's own SVGGeometryElement.getPointAtLength(), so arcs/beziers/
 * etc. in the path data are sampled correctly without needing a hand-written path parser.
 */
export function parseSvgToPolygon(svgText: string): [number, number][] {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {
    throw new SvgShapeImportError('That file is not a valid SVG.')
  }
  const sourcePath = doc.querySelector('path')
  const d = sourcePath?.getAttribute('d')
  if (!sourcePath || !d) {
    throw new SvgShapeImportError('No <path> element found — custom pupil shapes need a single SVG <path>.')
  }

  // Sample from a fresh element holding just the first subpath, rather than sourcePath
  // itself — keeps this working the same whether sourcePath was attached to the parsed doc
  // or not, and guarantees getTotalLength()/getPointAtLength() only ever see one outline.
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', firstSubpathD(d))
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
