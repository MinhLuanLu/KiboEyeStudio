import type { UiIndicatorEasing } from '@/types'

/** Maps the Animation Controls' easing vocabulary (see `UiIndicatorEasing`, and its real LVGL
 * `lv_anim_path_*` counterpart in `scriptLang/actionTable.ts`'s `EASING_TO_LVGL_PATH`) to a CSS
 * `transition-timing-function`, so the live design-canvas preview animates value changes with a
 * visually similar curve to what the exported firmware will actually play. `bounce`/`overshoot`
 * have no native CSS keyword — approximated with an overshooting cubic-bezier curve, the same
 * "structurally similar, not frame-identical" preview/export fidelity bar this project already
 * holds other approximated preview math to. */
const EASING_TO_CSS: Record<UiIndicatorEasing, string> = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.42, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.58, 1)',
  easeInOut: 'cubic-bezier(0.42, 0, 0.58, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
}

export function indicatorEasingToCss(easing: unknown): string {
  if (typeof easing === 'string' && easing in EASING_TO_CSS) return EASING_TO_CSS[easing as UiIndicatorEasing]
  return EASING_TO_CSS.easeOut
}

/** A CSS `transition` shorthand covering `cssProperties`, gated on the widget's own `animEnabled`
 * prop — returns `undefined` (no transition at all) when animation is off, so an indicator with
 * animation disabled keeps the exact "jump straight to the new value" behavior every widget had
 * before this feature. */
export function indicatorTransition(props: Record<string, string | number | boolean>, cssProperties: string[]): string | undefined {
  if (!props.animEnabled) return undefined
  const durationMs = Math.max(0, typeof props.animDurationMs === 'number' ? props.animDurationMs : 300)
  const timing = indicatorEasingToCss(props.animEasing)
  return cssProperties.map((p) => `${p} ${durationMs}ms ${timing}`).join(', ')
}
