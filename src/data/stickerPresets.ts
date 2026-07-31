import { nanoid } from 'nanoid'
import type { StickerInstance, StickerLayer } from '@/types'
import { DEFAULT_STICKER_ANIM } from '@/types'

type PresetSticker = Omit<StickerInstance, 'order'>

function sticker(name: string, builtinId: string, layer: StickerLayer, x: number, y: number, size: number, overrides: Partial<StickerInstance> = {}): PresetSticker {
  return {
    id: nanoid(8),
    assetId: `builtin-${builtinId}`,
    name,
    layer,
    x,
    y,
    width: size,
    height: size,
    scaleX: 100,
    scaleY: 100,
    rotation: 0,
    opacity: 100,
    tint: null,
    flipH: false,
    flipV: false,
    visible: true,
    locked: false,
    anim: { ...DEFAULT_STICKER_ANIM },
    // Presets apply to a Project/Expression/Animation sticker scope (see applyStickerPreset in
    // store.ts), never directly onto a specific timeline sticker Track — '' means "not yet
    // assigned to a track", same as a freshly-imported/legacy sticker; the Sticker Manager
    // and, for Animation scope, the Timeline let the user assign one afterward.
    trackId: '',
    ...overrides
  }
}

/** One preset button's worth of stickers, applied to the active expression in one click from
 * the Sticker Manager (see applyStickerPreset() in state/store.ts). `make()` builds fresh
 * instances (new ids) every call, so applying the same preset twice adds a second copy
 * instead of colliding ids or silently no-oping — `order` is assigned by the caller, based on
 * how many stickers already exist in each target layer. */
export interface StickerPresetBundle {
  id: string
  name: string
  make: () => PresetSticker[]
}

export const STICKER_PRESET_BUNDLES: StickerPresetBundle[] = [
  {
    id: 'sleeping',
    name: 'Sleeping',
    make: () => [
      sticker('Zzz', 'zzz', 'front', 70, -80, 50),
      sticker('Stars', 'stars', 'behind', 0, -90, 120, { opacity: 70 }),
      sticker('Clouds', 'clouds', 'behind', -70, -85, 70, { tint: '#dfe8ee', opacity: 80 })
    ]
  },
  {
    id: 'sad',
    name: 'Sad',
    make: () => [
      sticker('Rain', 'rain', 'behind', 0, -20, 220, { tint: '#7fa8c9' }),
      sticker('Tears', 'tears', 'front', -35, 30, 40, { tint: '#8fd0ff' }),
      sticker('Tears', 'tears', 'front', 35, 34, 36, { tint: '#8fd0ff', anim: { ...DEFAULT_STICKER_ANIM, startDelayMs: 300 } }),
      sticker('Dark Clouds', 'clouds', 'behind', 0, -90, 140, { tint: '#5b6672', opacity: 90 })
    ]
  },
  {
    id: 'happy',
    name: 'Happy',
    make: () => [
      sticker('Hearts', 'hearts', 'front', -60, -70, 60, { tint: '#ff6b9a' }),
      sticker('Hearts', 'hearts', 'front', 60, -60, 46, { tint: '#ff9fc2', anim: { ...DEFAULT_STICKER_ANIM, startDelayMs: 400 } }),
      sticker('Sparkles', 'sparkles', 'front', 0, -95, 130, { tint: '#ffe066' }),
      sticker('Confetti', 'confetti', 'front', 0, -30, 220, { opacity: 90 })
    ]
  },
  {
    id: 'cold',
    name: 'Cold',
    make: () => [
      sticker('Snow', 'snow', 'behind', -40, -30, 220, { tint: '#eaf6ff' }),
      sticker('Snow', 'snow', 'behind', 40, -10, 220, { tint: '#bfe3ff', opacity: 70, anim: { ...DEFAULT_STICKER_ANIM, startDelayMs: 250 } })
    ]
  },
  {
    id: 'angry',
    name: 'Angry',
    make: () => [
      sticker('Smoke', 'smoke', 'behind', 0, -95, 140, { tint: '#6b6b6b', opacity: 70 }),
      sticker('Fire', 'fire', 'front', -70, -75, 46, { tint: '#ff7a1a' }),
      sticker('Fire', 'fire', 'front', 70, -75, 46, { tint: '#ff9a3c', anim: { ...DEFAULT_STICKER_ANIM, startDelayMs: 200 } }),
      sticker('Lightning', 'lightning', 'front', 0, -60, 60, { tint: '#ffe066' })
    ]
  },
  {
    id: 'surprised',
    name: 'Surprised',
    make: () => [
      sticker('Expanding Circles', 'expandingCircles', 'behind', 0, 0, 220, { tint: '#ffffff', opacity: 60 }),
      sticker('Burst Lines', 'burstLines', 'behind', 0, 0, 240, { tint: '#ffe066' }),
      sticker('Stars', 'stars', 'front', 0, -95, 130, { tint: '#ffffff' })
    ]
  }
]
