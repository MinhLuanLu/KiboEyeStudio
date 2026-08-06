// Shared, framework-free zoom/pan math for the UI Design Mode canvas — imported by Canvas.tsx
// (rendering the stage transform, wheel-zoom-around-cursor, Fit/Center toolbar actions in
// UiDesignTopBar.tsx) so there is exactly one formula for "where does the display box sit on
// screen at this zoom/pan" everywhere it's needed. This is what guarantees wheel-zoom, the Fit
// buttons, and the actual rendered transform can never disagree.
//
// Design: `panX`/`panY` are the user's manual offset FROM an auto-computed centered position —
// (0, 0) always means "the display box is centered in the viewport", regardless of viewport or
// display size, so "Center in workspace" is just resetting them to zero (see
// UiWorkspaceViewSettings' own doc comment for why this whole settings group lives outside
// `project.uiDesign`). Widget x/y/width/height (the values exported to LVGL) are never touched
// by anything in this module — it only ever computes a CSS transform applied *above* the
// otherwise-unchanged 1:1-px display box (see WidgetRenderer.tsx's styleToCss, unmodified).

export const UI_ZOOM_MIN = 0.1
export const UI_ZOOM_MAX = 8
/** Multiplier used by the +/- toolbar buttons and (M4) the Ctrl+/Ctrl- keyboard shortcuts. */
export const UI_ZOOM_STEP_FACTOR = 1.25
/** The spec's literal preset list, as zoom multipliers (1 = 100%). */
export const UI_ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export function clampUiZoom(zoom: number): number {
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, zoom))
}

export interface UiCanvasSize {
  width: number
  height: number
}

export interface UiCanvasStageTransform {
  tx: number
  ty: number
  zoom: number
}

/** The stage's CSS `translate(tx,ty) scale(zoom)` — see this module's own top comment for the
 * "(0,0) pan means centered" convention tx/ty encode. */
export function computeStageTransform(viewport: UiCanvasSize, display: UiCanvasSize, view: { zoom: number; panX: number; panY: number }): UiCanvasStageTransform {
  return {
    tx: viewport.width / 2 - (display.width / 2) * view.zoom + view.panX,
    ty: viewport.height / 2 - (display.height / 2) * view.zoom + view.panY,
    zoom: view.zoom
  }
}

/** Screen (client) px -> logical (unscaled, display-local) px, given the viewport div's own
 * `getBoundingClientRect()` as the origin. Not needed by WidgetRenderer's drag/resize (a pure
 * delta only needs dividing by `zoom`, translation cancels out — see that file's own comment)
 * nor Canvas.tsx's drop handler (its origin rect already comes from a transformed DOM element's
 * real `getBoundingClientRect()`, which is already screen-accurate) — kept here as the one
 * place a genuinely absolute screen->logical conversion is needed (wheel-zoom-around-cursor). */
export function screenToLogical(clientX: number, clientY: number, viewportRect: DOMRect, transform: UiCanvasStageTransform): { x: number; y: number } {
  return {
    x: (clientX - viewportRect.left - transform.tx) / transform.zoom,
    y: (clientY - viewportRect.top - transform.ty) / transform.zoom
  }
}

/** Standard "zoom around a fixed screen point" algebra: solve for the pan that keeps the same
 * logical point under the cursor after the zoom changes. */
export function zoomAroundPoint(
  clientX: number,
  clientY: number,
  viewportRect: DOMRect,
  viewport: UiCanvasSize,
  display: UiCanvasSize,
  view: { zoom: number; panX: number; panY: number },
  zoomNew: number
): { zoom: number; panX: number; panY: number } {
  const oldTransform = computeStageTransform(viewport, display, view)
  const logical = screenToLogical(clientX, clientY, viewportRect, oldTransform)
  const zoom = clampUiZoom(zoomNew)
  const txNew = clientX - viewportRect.left - logical.x * zoom
  const tyNew = clientY - viewportRect.top - logical.y * zoom
  return {
    zoom,
    panX: txNew - viewport.width / 2 + (display.width / 2) * zoom,
    panY: tyNew - viewport.height / 2 + (display.height / 2) * zoom
  }
}

/** Pan (at a given zoom) that centers a display-local rect — e.g. the selected widget's absolute
 * bounding box — within the viewport, using the same "(0,0) = the whole display box is centered"
 * pan convention `computeStageTransform` establishes, just solved for an arbitrary target rect
 * instead of the whole display box. Takes no viewport size: the centered-pan offset from
 * `computeStageTransform`'s own `viewport.width/2 - ...` term cancels out algebraically, so the
 * result is viewport-size-independent — same reasoning as "(0,0) always means centered" already
 * documented at this module's top. Used by PropertiesPanel.tsx's Center-in-workspace/
 * Zoom-to-selection Navigator actions. */
export function centerPanForRect(display: UiCanvasSize, zoom: number, rect: UiCanvasSize & { x: number; y: number }): { panX: number; panY: number } {
  const rectCenterX = rect.x + rect.width / 2
  const rectCenterY = rect.y + rect.height / 2
  return {
    panX: (display.width / 2 - rectCenterX) * zoom,
    panY: (display.height / 2 - rectCenterY) * zoom
  }
}

/** Zoom that fits the whole display inside the viewport ('contain') or matches the viewport's
 * width only ('width'), with a little breathing room (`padding`, e.g. 0.92 = 8% margin). Always
 * paired with resetting panX/panY to 0 by the caller so the fit result is also centered. */
export function fitZoomToDisplay(viewport: UiCanvasSize, display: UiCanvasSize, mode: 'contain' | 'width', padding = 0.92): number {
  if (viewport.width <= 0 || viewport.height <= 0 || display.width <= 0 || display.height <= 0) return 1
  const zoomW = (viewport.width * padding) / display.width
  if (mode === 'width') return clampUiZoom(zoomW)
  const zoomH = (viewport.height * padding) / display.height
  return clampUiZoom(Math.min(zoomW, zoomH))
}
