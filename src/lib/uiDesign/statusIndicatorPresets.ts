// Status Indicator's status -> color/icon/glow/animation table — the ONE shared source of truth
// read by the live preview (WidgetRenderer.tsx), the LVGL exporter (lvglExport.ts's
// statusIndicatorApplyLines), and the `setStatus` ACTION_TABLE entry, so "changing the status
// automatically updates color/icon/animation/glow" can never disagree between preview and export
// — the same "one shared implementation" principle already established by pupilShapes.ts/
// keyboardLayouts.ts/resolveEffectiveShadow.

import type { UiStatusIndicatorState } from '@/types'

export interface StatusIndicatorPreset {
  label: string
  color: string
  /** A real LVGL built-in symbol macro (see lib/uiDesign/lvglSymbols.ts) — always a plain glyph
   * reference, never a raster asset, so it costs nothing extra to export. */
  icon: string
  glow: boolean
  anim: 'none' | 'pulse' | 'spin'
}

export const STATUS_INDICATOR_PRESETS: Record<UiStatusIndicatorState, StatusIndicatorPreset> = {
  online: { label: 'Online', color: '#22C55E', icon: 'LV_SYMBOL_OK', glow: true, anim: 'none' },
  offline: { label: 'Offline', color: '#6B7280', icon: 'LV_SYMBOL_CLOSE', glow: false, anim: 'none' },
  busy: { label: 'Busy', color: '#F59E0B', icon: 'LV_SYMBOL_MINUS', glow: false, anim: 'none' },
  error: { label: 'Error', color: '#EF4444', icon: 'LV_SYMBOL_WARNING', glow: true, anim: 'none' },
  warning: { label: 'Warning', color: '#F59E0B', icon: 'LV_SYMBOL_WARNING', glow: true, anim: 'pulse' },
  success: { label: 'Success', color: '#22C55E', icon: 'LV_SYMBOL_OK', glow: true, anim: 'none' },
  loading: { label: 'Loading', color: '#3B82F6', icon: 'LV_SYMBOL_REFRESH', glow: false, anim: 'spin' }
}

export const STATUS_INDICATOR_STATES: UiStatusIndicatorState[] = ['online', 'offline', 'busy', 'error', 'warning', 'success', 'loading']
