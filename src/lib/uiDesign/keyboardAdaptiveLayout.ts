// Keyboard row GEOMETRY — how a keyboard's rows indent/wrap to follow the project's display
// shape. Deliberately a sibling of keyboardLayouts.ts (key CONTENT), not a part of it: this
// module knows nothing about what a key types, only how wide it renders and whether it needs a
// spacer next to it. Imported identically by the live-preview renderer (WidgetRenderer.tsx) and
// every LVGL codegen path (lvglExport.ts) — the same "one shared function, preview and export
// structurally can't disagree" principle keyboardLayouts.ts's resolveKeyboardMap() already
// established for key content.
//
// One caveat that principle does NOT extend to here: preview renders spacers as a continuous CSS
// flex fraction, but real LVGL button widths are an integer 1-15 relative-weight unit
// (lv_buttonmatrix_ctrl_t, see lvglExport.ts's codegen comment). This module guarantees
// STRUCTURAL agreement (same rows get spacers, same relative proportions, same overflow-wrap
// points) — not bit-for-bit pixel/unit agreement, which integer quantization on the LVGL side
// makes impossible. Mirrors the pre-existing, already-documented space-bar/control-key width
// approximation KeyboardKeyGrid's own comment calls out for the exact same reason.

import type { UiDisplaySettings, UiKeyboardEdgePadding, UiKeyboardShape } from '@/types'
import type { UiResolvedKeyboardKey } from './keyboardLayouts'
import { KB_CONTROL } from './keyboardLayouts'
import { rectFitsDisplayShape, uiDisplayShapeToDisplayShape } from '@/renderer/displayMask'

export interface UiKeyboardRowLayout {
  keys: UiResolvedKeyboardKey[]
  /** Fraction (0..0.45) of the keyboard widget's own width to leave blank before/after this
   * row's real keys — rendered as an invisible flex spacer in preview, an
   * LV_BUTTONMATRIX_CTRL_HIDDEN|DISABLED spacer button in the real export. 0 = today's plain
   * full-width row. */
  leadingSpacerFraction: number
  trailingSpacerFraction: number
}

const MAX_WRAP_PASSES = 4
const MAX_SPACER_FRACTION = 0.45
const MIN_SPACER_FRACTION_TO_EMIT = 0.02
// Flat px constant, not display-DPI-scaled — this app has no DPI concept, every display it
// targets is a small round/square embedded panel described purely in raw px, matching every
// other flat-constant size threshold already used elsewhere in this codebase.
const MIN_KEY_PX = 14

interface KeyboardWidgetRect {
  x: number
  y: number
  width: number
  height: number
}

function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return 0
  return Math.max(0, Math.min(MAX_SPACER_FRACTION, f))
}

/** Half the horizontal chord of the display's own ellipse at vertical position `y` (display-local
 * px), eroded inward by `margin` on both axes. 0 outside the ellipse's vertical extent. */
export function ellipseChordHalfWidth(display: Pick<UiDisplaySettings, 'width' | 'height'>, y: number, margin: number): number {
  const rx = display.width / 2 - margin
  const ry = display.height / 2 - margin
  if (rx <= 0 || ry <= 0) return Math.max(0, rx)
  const cy = display.height / 2
  const t = (y - cy) / ry
  const inside = 1 - t * t
  if (inside <= 0) return 0
  return rx * Math.sqrt(inside)
}

/** This row's symmetric leading/trailing spacer fraction so its full width fits inside the
 * display ellipse's chord across its own vertical EXTENT — sampled at whichever of the row's top
 * or bottom edge sits farther from the display's vertical center, not the row's center line,
 * since a key's rendered rect spans the row's full height: sizing off the center alone would
 * leave the row's far edge (still real height away) poking past a chord that's already narrowing
 * there, exactly the clipping this feature exists to prevent. `top`/`bottom` padding shift the
 * effective vertical range this math treats as "the keyboard's own usable area" — increasing
 * `top` moves the assumed top edge downward (away from the display's physical top), so the first
 * row is treated as less extreme and gets a correspondingly gentler indent; useful as a manual
 * fine-tune independent of `safeAreaMargin` (which eroded the ellipse itself). */
function roundRowSpacer(display: Pick<UiDisplaySettings, 'width' | 'height'>, widgetRect: KeyboardWidgetRect, padding: UiKeyboardEdgePadding, rowIndex: number, rowCount: number): number {
  if (widgetRect.width <= 0 || rowCount <= 0) return 0
  const effectiveY = widgetRect.y + padding.top
  const effectiveHeight = Math.max(0, widgetRect.height - padding.top - padding.bottom)
  const rowTop = effectiveY + (rowIndex / rowCount) * effectiveHeight
  const rowBottom = effectiveY + ((rowIndex + 1) / rowCount) * effectiveHeight
  const cy = display.height / 2
  const extremeY = Math.abs(rowTop - cy) >= Math.abs(rowBottom - cy) ? rowTop : rowBottom
  // TANGENT_SAFETY shrinks the target chord slightly so content sits strictly inside the ellipse
  // rather than exactly tangent to it — sizing to the mathematically exact chord width leaves
  // content touching the boundary with zero margin, which floating-point corner checks (see
  // findClippedKeys) can flag as "just barely outside" on either side of that knife-edge.
  const TANGENT_SAFETY = 0.97
  const chordWidth = 2 * ellipseChordHalfWidth(display, extremeY, padding.safeAreaMargin) * TANGENT_SAFETY
  if (chordWidth >= widgetRect.width) return 0
  const frac = clampFraction((widgetRect.width - chordWidth) / (2 * widgetRect.width))
  return frac < MIN_SPACER_FRACTION_TO_EMIT ? 0 : frac
}

/** Splits any row whose real available width can't fit all its keys at a legible minimum size,
 * moving the trailing overflow onto a newly-inserted row immediately after it — every character
 * stays directly tappable, nothing is ever dropped (a locked-in scope decision: dropping
 * characters would make them only reachable via a layout switch or alt-char long-press, a real
 * usability regression for a text keyboard). `recomputeSpacer` is called for every row on every
 * pass with the row's new index/total count (needed for the round-ellipse path, where a spacer
 * depends on row position — irrelevant, and simply ignored, for the fixed-padding custom path). */
function settleOverflow(rows: UiResolvedKeyboardKey[][], widgetWidth: number, recomputeSpacer: (rowIndex: number, rowCount: number) => number): UiKeyboardRowLayout[] {
  let current = rows
  for (let pass = 0; pass < MAX_WRAP_PASSES; pass++) {
    let changed = false
    const next: UiResolvedKeyboardKey[][] = []
    for (const keys of current) {
      const rowIndex = next.length
      const spacer = recomputeSpacer(rowIndex, current.length)
      const availableWidth = widgetWidth * (1 - 2 * spacer)
      if (keys.length > 1 && availableWidth / keys.length < MIN_KEY_PX) {
        const maxKeysFit = Math.max(1, Math.floor(availableWidth / MIN_KEY_PX))
        const overflowCount = keys.length - maxKeysFit
        if (overflowCount > 0 && overflowCount < keys.length) {
          next.push(keys.slice(0, keys.length - overflowCount))
          next.push(keys.slice(keys.length - overflowCount))
          changed = true
          continue
        }
      }
      next.push(keys)
    }
    current = next
    if (!changed) break
  }
  return current.map((keys, rowIndex) => {
    const spacer = recomputeSpacer(rowIndex, current.length)
    return { keys, leadingSpacerFraction: spacer, trailingSpacerFraction: spacer }
  })
}

/** The one function both the live-preview renderer and every LVGL codegen path call to decide how
 * a keyboard's rows indent/wrap for the project's display — see this module's own header comment
 * for the full "structural, not pixel-exact, parity" guarantee. Never reorders real keys relative
 * to `rows.flat()`'s own reading order (only inserts spacers and moves row-break points) — this is
 * what keeps encoder/simulate-focus key-cycling (store.ts's simulateFocusNext/Previous/Press,
 * which already walk resolveKeyboardMap(...).flat() directly, decoupled from visual row layout)
 * correct with zero changes here. */
export function computeAdaptiveKeyboardRowLayout(
  display: Pick<UiDisplaySettings, 'width' | 'height' | 'shape'>,
  widgetRect: KeyboardWidgetRect,
  rows: UiResolvedKeyboardKey[][],
  shape: UiKeyboardShape,
  padding: UiKeyboardEdgePadding
): UiKeyboardRowLayout[] {
  // Identity fast-path, checked first, no ellipse/padding math at all — the exact mechanism that
  // guarantees byte-identical preview/export output for every keyboard saved before this feature
  // existed (see normalizeKeyboardConfig's 'rectangular' backfill) and for 'adaptive' on a
  // non-round display (nothing to curve).
  if (shape === 'rectangular' || (shape === 'adaptive' && display.shape !== 'round')) {
    return rows.map((keys) => ({ keys, leadingSpacerFraction: 0, trailingSpacerFraction: 0 }))
  }

  if (shape === 'custom') {
    const leading = clampFraction(widgetRect.width > 0 ? padding.leftCurve / widgetRect.width : 0)
    const trailing = clampFraction(widgetRect.width > 0 ? padding.rightCurve / widgetRect.width : 0)
    // Fixed per the user's own authored padding — not position-dependent, so the settle loop's
    // recompute callback just returns the same values every pass regardless of row index/count.
    // settleOverflow's symmetric-spacer return shape doesn't fit asymmetric leading/trailing, so
    // custom shape is handled directly here instead of sharing settleOverflow's return mapping.
    let current = rows
    for (let pass = 0; pass < MAX_WRAP_PASSES; pass++) {
      let changed = false
      const next: UiResolvedKeyboardKey[][] = []
      for (const keys of current) {
        const availableWidth = widgetRect.width * (1 - leading - trailing)
        if (keys.length > 1 && availableWidth / keys.length < MIN_KEY_PX) {
          const maxKeysFit = Math.max(1, Math.floor(availableWidth / MIN_KEY_PX))
          const overflowCount = keys.length - maxKeysFit
          if (overflowCount > 0 && overflowCount < keys.length) {
            next.push(keys.slice(0, keys.length - overflowCount))
            next.push(keys.slice(keys.length - overflowCount))
            changed = true
            continue
          }
        }
        next.push(keys)
      }
      current = next
      if (!changed) break
    }
    return current.map((keys) => ({ keys, leadingSpacerFraction: leading, trailingSpacerFraction: trailing }))
  }

  // shape === 'round', or 'adaptive' on a round display.
  return settleOverflow(rows, widgetRect.width, (rowIndex, rowCount) => roundRowSpacer(display, widgetRect, padding, rowIndex, rowCount))
}

function keyFlexWeight(key: UiResolvedKeyboardKey): number {
  return key.control === KB_CONTROL.space ? 3 : key.control ? 1.4 : 1
}

/** Which keys, given already-resolved row layouts, would render at least partially outside the
 * display's own round safe area — used only for the Rectangular/Custom-shape diagnostic (see
 * validateLvglExport.ts / WidgetRenderer.tsx); Adaptive/Round shape never has any hits by
 * construction, so callers should gate on shape before calling this rather than expecting an
 * empty result to mean "already checked and fine." Computes each key's approximate rect using the
 * exact same flex-weight proportions KeyboardKeyGrid renders with, then reuses
 * displayMask.ts's own rectFitsDisplayShape — no separate ellipse-math reimplementation. */
export function findClippedKeys(display: Pick<UiDisplaySettings, 'width' | 'height' | 'shape'>, widgetRect: KeyboardWidgetRect, rowLayouts: UiKeyboardRowLayout[]): { rowIndex: number; keyId: string }[] {
  if (display.shape !== 'round') return []
  const shapeDisplay = { width: display.width, height: display.height, shape: uiDisplayShapeToDisplayShape(display.shape) }
  const hits: { rowIndex: number; keyId: string }[] = []
  const rowCount = rowLayouts.length
  rowLayouts.forEach((row, rowIndex) => {
    const realWeights = row.keys.map(keyFlexWeight)
    const realTotal = realWeights.reduce((a, b) => a + b, 0)
    if (realTotal <= 0) return
    const denom = Math.max(1e-6, 1 - row.leadingSpacerFraction - row.trailingSpacerFraction)
    const leadingWeight = (row.leadingSpacerFraction / denom) * realTotal
    const trailingWeight = (row.trailingSpacerFraction / denom) * realTotal
    const totalWeight = leadingWeight + realTotal + trailingWeight
    const rowY = widgetRect.y + (rowIndex / rowCount) * widgetRect.height
    const rowHeight = widgetRect.height / rowCount
    let cursor = widgetRect.x + (leadingWeight / totalWeight) * widgetRect.width
    row.keys.forEach((key, i) => {
      const keyWidth = (realWeights[i] / totalWeight) * widgetRect.width
      if (!rectFitsDisplayShape(shapeDisplay, { x: cursor, y: rowY, width: keyWidth, height: rowHeight })) {
        hits.push({ rowIndex, keyId: key.keyId })
      }
      cursor += keyWidth
    })
  })
  return hits
}
