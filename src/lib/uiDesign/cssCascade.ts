import type { UiCssRule, UiDesignProject, UiWidget, UiWidgetStyle } from '@/types'
import { UI_WIDGET_TAG } from '@/types'
import { resolveThemedStyle } from './themes'

/** Does `selector` (one of the simple forms this pass supports — a bare tag name, `.class`, or
 * `#id`) match `widget`? No combinators/descendant selectors — see cssSync.ts's parser, which
 * is the other half of this restriction. */
function matchesSelector(widget: UiWidget, selector: string): boolean {
  if (selector.startsWith('#')) return widget.tagId === selector.slice(1)
  if (selector.startsWith('.')) return widget.classNames.includes(selector.slice(1))
  return UI_WIDGET_TAG[widget.type] === selector
}

/** Specificity bucket used only to order same-widget rule application — tag < class < id,
 * matching real CSS's relative ordering (not real CSS specificity math, which needs
 * combinators/counts this pass doesn't support). Within the same bucket, later rules in the
 * array win (source-order, last-rule-wins — the deliberate simplification this pass makes
 * instead of a full cascade engine). */
function specificityRank(selector: string): number {
  if (selector.startsWith('#')) return 2
  if (selector.startsWith('.')) return 1
  return 0
}

/** Computes a widget's effective (rendered) style: matching CSS rules layered low-to-high
 * specificity (tag, then class, then id; last-in-array wins within a tier), with the widget's
 * own `style` (set directly via drag/resize/Properties-panel edits) always applied last as the
 * "inline style" layer — exactly mirroring real CSS's inline-beats-stylesheet rule. This is
 * computed fresh on every render rather than cached/painted onto the widget, so it's
 * automatically live: editing a CSS rule, or a widget gaining/losing a class, takes effect
 * immediately with no separate "re-apply" step. */
export function computeEffectiveStyle(widget: UiWidget, cssRules: UiCssRule[], theme?: Pick<UiDesignProject, 'theme' | 'customThemeTokens'>): UiWidgetStyle {
  const matching = cssRules.filter((r) => matchesSelector(widget, r.selector)).sort((a, b) => specificityRank(a.selector) - specificityRank(b.selector))

  const out: UiWidgetStyle = {}
  const applyDefined = (partial: Partial<UiWidgetStyle> | undefined) => {
    if (!partial) return
    for (const k in partial) {
      const v = partial[k as keyof UiWidgetStyle]
      if (v !== undefined) (out as Record<string, unknown>)[k] = v
    }
  }
  for (const rule of matching) applyDefined(rule.style)
  // Theme-token resolution only ever applies to the widget's own local style (matching the LVGL
  // exporter's identical choice — see lvglExport.ts's exportLvglStyles) — CSS-rule-sourced colors
  // stay literal.
  applyDefined(theme ? resolveThemedStyle(widget, theme) : widget.style)
  return out
}
