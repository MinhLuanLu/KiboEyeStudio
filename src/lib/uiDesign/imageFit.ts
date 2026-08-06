/** Pure, framework-free math for the two Image Fit modes CSS `object-fit` has no keyword for —
 * 'fitWidth'/'fitHeight' (scale so exactly one axis matches the widget box, aspect ratio
 * preserved, the other axis may overflow and gets cropped). fill/contain/cover/none all map
 * directly onto real CSS `object-fit` keywords (live preview) and real LVGL v9
 * `LV_IMAGE_ALIGN_*` inner-align enum values (export) — neither consumer needs this module for
 * those four. This is the ONE shared implementation both the live preview (WidgetRenderer.tsx)
 * and the LVGL exporter (lvglExport.ts, for computing an `lv_image_set_scale` zoom factor) call
 * for fitWidth/fitHeight, so the two can never visually disagree — same "one shared module, can't
 * drift" precedent used throughout this codebase (pupilShapes.ts, snapEngine.ts, etc). */

export interface ImageFitRect {
  /** Rendered image width/height in the same units as the inputs (px). */
  renderWidth: number
  renderHeight: number
  /** Offset of the rendered image's top-left corner from the widget box's own top-left corner —
   * negative when the image overflows that axis (i.e. it must be cropped), matching how a
   * centered `background-position`/`object-position` would sit. */
  offsetX: number
  offsetY: number
}

/** `naturalW`/`naturalH` = the source image's own pixel dimensions (UiAsset.naturalWidth/Height);
 * `boxW`/`boxH` = the widget's own resolved pixel box. Returns a rect scaled uniformly so exactly
 * one axis matches the box exactly (width for 'fitWidth', height for 'fitHeight') while the other
 * axis scales proportionally and is centered — cropped if it overflows the box, letterboxed if it
 * doesn't fill it. Degenerates safely to the box itself if the natural size is unknown/zero. */
export function computeFitWidthOrHeightRect(naturalW: number, naturalH: number, boxW: number, boxH: number, fit: 'fitWidth' | 'fitHeight'): ImageFitRect {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) {
    return { renderWidth: boxW, renderHeight: boxH, offsetX: 0, offsetY: 0 }
  }
  const scale = fit === 'fitWidth' ? boxW / naturalW : boxH / naturalH
  const renderWidth = naturalW * scale
  const renderHeight = naturalH * scale
  return {
    renderWidth,
    renderHeight,
    offsetX: (boxW - renderWidth) / 2,
    offsetY: (boxH - renderHeight) / 2
  }
}

/** Same uniform-scale-then-center math, generalized to a single "which axis must match exactly"
 * flag — `computeFitWidthOrHeightRect` is the public entry point; this is what it delegates to.
 * Exported separately since the LVGL exporter only needs the scale factor (not the pixel rect —
 * `lv_image_set_inner_align(..., LV_IMAGE_ALIGN_CENTER)` handles centering/cropping natively once
 * the scale is set), so re-deriving it from the rect would be redundant. */
export function computeFitWidthOrHeightScale(naturalW: number, naturalH: number, boxW: number, boxH: number, fit: 'fitWidth' | 'fitHeight'): number {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) return 1
  return fit === 'fitWidth' ? boxW / naturalW : boxH / naturalH
}
