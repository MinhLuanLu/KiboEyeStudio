// Project-level color theme engine for UI Design Mode — a named color-token table, not a
// runtime LVGL theming system (LVGL has no live style-recompute-on-theme-change wired into this
// exporter; every other style field is already baked at export time, and themed fields follow
// the same rule — see resolveThemedStyle()). A "theme" is cheap to add more of since it's just a
// palette, which is why all 10 named themes from the spec are included even though most of them
// only really differ from each other by color choice, not behavior.

import type { UiDesignProject, UiThemeId, UiThemeTokens, UiWidget } from '@/types'

export const UI_THEMES: Record<Exclude<UiThemeId, 'custom'>, UiThemeTokens> = {
  light: { background: '#F2F2F2', surface: '#FFFFFF', primary: '#2196F3', secondary: '#607D8B', text: '#1A1A1A', textMuted: '#6B6B6B', border: '#D8D8D8', accent: '#2196F3' },
  dark: { background: '#121212', surface: '#1E1E1E', primary: '#4FA3FF', secondary: '#8A8A8A', text: '#F2F2F2', textMuted: '#9A9A9A', border: '#2E2E2E', accent: '#4FA3FF' },
  amoled: { background: '#000000', surface: '#0A0A0A', primary: '#3DA9FC', secondary: '#7A7A7A', text: '#FFFFFF', textMuted: '#8A8A8A', border: '#1A1A1A', accent: '#3DA9FC' },
  material: { background: '#121212', surface: '#1F1F1F', primary: '#6750A4', secondary: '#625B71', text: '#E6E1E5', textMuted: '#938F99', border: '#49454F', accent: '#D0BCFF' },
  fluent: { background: '#F3F3F3', surface: '#FFFFFF', primary: '#0078D4', secondary: '#005A9E', text: '#1B1B1B', textMuted: '#605E5C', border: '#E1DFDD', accent: '#0078D4' },
  apple: { background: '#F2F2F7', surface: '#FFFFFF', primary: '#007AFF', secondary: '#5856D6', text: '#000000', textMuted: '#8E8E93', border: '#E5E5EA', accent: '#007AFF' },
  gaming: { background: '#0D0D14', surface: '#171723', primary: '#7C4DFF', secondary: '#00E5FF', text: '#F2F2F2', textMuted: '#8A8AA0', border: '#2A2A3D', accent: '#00E5FF' },
  automotive: { background: '#14161A', surface: '#1E2126', primary: '#FF9E2C', secondary: '#3D4450', text: '#F2F2F2', textMuted: '#8A9099', border: '#2E333A', accent: '#FF9E2C' },
  cyberpunk: { background: '#0A0014', surface: '#150826', primary: '#FF2A6D', secondary: '#05D9E8', text: '#F2F2F2', textMuted: '#A38FB5', border: '#3A1E52', accent: '#05D9E8' }
}

export const UI_THEME_LABELS: Record<UiThemeId, string> = {
  light: 'Light',
  dark: 'Dark',
  amoled: 'AMOLED',
  material: 'Material',
  fluent: 'Fluent',
  apple: 'Apple',
  gaming: 'Gaming',
  automotive: 'Automotive',
  cyberpunk: 'Cyberpunk',
  custom: 'Custom'
}

export const DEFAULT_CUSTOM_THEME_TOKENS: UiThemeTokens = { ...UI_THEMES.dark }

/** Resolves a project's currently-active theme to a concrete token table — 'custom' reads the
 * user-edited palette (falling back to the dark theme's shape if somehow unset, e.g. an old save
 * that predates this feature). */
export function resolveThemeTokens(uiDesign: Pick<UiDesignProject, 'theme' | 'customThemeTokens'>): UiThemeTokens {
  if (uiDesign.theme === 'custom') return uiDesign.customThemeTokens ?? DEFAULT_CUSTOM_THEME_TOKENS
  return UI_THEMES[uiDesign.theme] ?? UI_THEMES.dark
}

/** Returns a copy of `widget.style` with every field named in `widget.themeTokens` overridden by
 * the project's current theme's resolved color for that token — used identically by the live
 * preview (WidgetRenderer.tsx, so switching themes updates every themed widget instantly) and by
 * the LVGL exporter (lvglExport.ts, which bakes the resolved literal hex at generation time,
 * matching how every other style field is already baked at export time). A widget with no
 * `themeTokens` entries returns `widget.style` completely unchanged (identity, not a clone) —
 * zero behavior change for the overwhelming majority of widgets that don't opt into theming. */
export function resolveThemedStyle(widget: Pick<UiWidget, 'style' | 'themeTokens'>, uiDesign: Pick<UiDesignProject, 'theme' | 'customThemeTokens'>): UiWidget['style'] {
  if (!widget.themeTokens || Object.keys(widget.themeTokens).length === 0) return widget.style
  const tokens = resolveThemeTokens(uiDesign)
  const resolved = { ...widget.style }
  for (const [field, tokenKey] of Object.entries(widget.themeTokens)) {
    if (tokenKey) (resolved as Record<string, unknown>)[field] = tokens[tokenKey]
  }
  return resolved
}
