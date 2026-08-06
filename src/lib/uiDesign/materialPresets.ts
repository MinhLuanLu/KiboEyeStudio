// Material Presets — curated bundles over the real Advanced Style System fields (see
// UiWidgetStyle's glow/elevation/backgroundOpacity/borderOpacity/surfaceStyle fields and
// lvglExport.ts's styleSetCalls()). Applying a preset merges a fixed style + state-style bundle
// into a widget's own `style`/`states` — it's a starting point, not a locked mode; every field it
// sets remains directly editable afterward through the normal Appearance controls.
//
// 8 of the spec's 17 presets are built this pass (Plastic, Glass, Matte, Glossy, Minimal, Premium,
// Dark Glass, Neon) — the rest (Acrylic, Metal, Carbon Fiber, Soft UI, Frosted Glass, Automotive,
// Gaming, Industrial) are deferred, per the "Advanced Style System..." plan's own scope decision.

import type { UiWidgetStateStyles, UiWidgetStyle } from '@/types'

export type MaterialPresetId = 'plastic' | 'glass' | 'matte' | 'glossy' | 'minimal' | 'premium' | 'darkGlass' | 'neon'

export interface MaterialPresetBundle {
  style: Partial<UiWidgetStyle>
  states: UiWidgetStateStyles
}

export const MATERIAL_PRESET_LABELS: Record<MaterialPresetId, string> = {
  plastic: 'Plastic',
  glass: 'Glass',
  matte: 'Matte',
  glossy: 'Glossy',
  minimal: 'Minimal',
  premium: 'Premium',
  darkGlass: 'Dark Glass',
  neon: 'Neon'
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPresetBundle> = {
  plastic: {
    style: { background: '#E8E8EC', borderWidth: 1, borderColor: '#C9C9D2', borderRadius: 10, elevation: 4 },
    states: { pressed: { elevation: 1 }, focused: { borderColor: '#8A8AF0', borderWidth: 2 } }
  },
  glass: {
    style: { background: '#FFFFFF', backgroundOpacity: 18, borderWidth: 1, borderColor: '#FFFFFF', borderOpacity: 35, borderRadius: 14, surfaceStyle: 'glass' },
    states: { pressed: { backgroundOpacity: 28 }, focused: { borderOpacity: 70 } }
  },
  matte: {
    style: { background: '#2A2C31', borderWidth: 0, borderRadius: 8, elevation: 0 },
    states: { pressed: { background: '#222327' }, focused: { borderWidth: 2, borderColor: '#5B6', borderOpacity: 100 } }
  },
  glossy: {
    style: { background: '#2F80ED', backgroundGradient: { to: '#1B5FC7', direction: 'vertical' }, borderRadius: 12, elevation: 6, glowColor: '#5B9CFF', glowRadius: 6 },
    states: { pressed: { elevation: 2, glowRadius: 2 }, focused: { borderWidth: 2, borderColor: '#FFFFFF' } }
  },
  minimal: {
    style: { background: '#FFFFFF', borderWidth: 1, borderColor: '#E2E2E6', borderRadius: 6, elevation: 0 },
    states: { pressed: { background: '#F2F2F5' }, focused: { borderColor: '#2196F3', borderWidth: 1 } }
  },
  premium: {
    style: { background: '#1C1C22', backgroundGradient: { to: '#101014', direction: 'vertical' }, borderWidth: 1, borderColor: '#4A4A58', borderRadius: 14, elevation: 10, glowColor: '#C9A24B', glowRadius: 10 },
    states: { pressed: { elevation: 4 }, focused: { borderColor: '#C9A24B', borderWidth: 2 } }
  },
  darkGlass: {
    style: { background: '#0A0A0F', backgroundOpacity: 55, borderWidth: 1, borderColor: '#FFFFFF', borderOpacity: 15, borderRadius: 16, surfaceStyle: 'glass', color: '#F2F2F2' },
    states: { pressed: { backgroundOpacity: 70 }, focused: { borderOpacity: 60 } }
  },
  neon: {
    style: { background: '#0D0D14', borderWidth: 1, borderColor: '#05D9E8', borderRadius: 10, glowColor: '#05D9E8', glowRadius: 16, color: '#05D9E8' },
    states: { pressed: { glowRadius: 6 }, focused: { borderColor: '#FF2A6D', glowColor: '#FF2A6D' } }
  }
}
