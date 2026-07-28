import type { Project, StickerAsset, StickerInstance } from '@/types'
import { STICKER_BUILTINS_WITH_FIRMWARE_DRAWER } from './cppExport'

export type StickerValidationStatus = 'passed' | 'warning' | 'failed'

export interface StickerValidationResult {
  stickerId: string
  stickerName: string
  /** Which sticker list this instance lives in — 'Project' (always exported), or
   * 'Expression "X"' / 'Animation "Y"' (exported, but only drawn on real hardware while that
   * expression/animation is the active one — see the Stickers comment in cppExport.ts). */
  scope: string
  status: StickerValidationStatus
  messages: string[]
}

/**
 * Runs the same checks exportStickers() (cppExport.ts) implicitly relies on, per sticker
 * instance across every scope (project/expression/animation), and reports pass/warning/fail
 * with a concrete reason for each — rather than a sticker silently not appearing on hardware
 * with no way to tell why. Mirrors (but doesn't duplicate) exportStickers()'s own asset
 * lookup/raster-data logic exactly, so "Passed" here means "this is genuinely what gets baked
 * into the header," not a separate, possibly-diverging check.
 */
export function validateStickerExport(project: Project): StickerValidationResult[] {
  const assetsById = new Map(project.stickerAssets.map((a) => [a.id, a]))
  const results: StickerValidationResult[] = []

  function checkInstance(s: StickerInstance, scope: string) {
    const messages: string[] = []
    let status: StickerValidationStatus = 'passed'

    if (!s.visible) {
      results.push({
        stickerId: s.id,
        stickerName: s.name,
        scope,
        status: 'warning',
        messages: ['Hidden in the Sticker Manager (visibility off) — matches the studio preview, so it\'s intentionally left out of the export, not a bug.']
      })
      return
    }

    const asset: StickerAsset | undefined = assetsById.get(s.assetId)
    if (!asset) {
      results.push({
        stickerId: s.id,
        stickerName: s.name,
        scope,
        status: 'failed',
        messages: [`Its source asset ("${s.assetId}") no longer exists in this project's sticker library — re-add this sticker from an existing asset.`]
      })
      return
    }

    if (asset.kind === 'procedural') {
      if (!asset.builtinId || !STICKER_BUILTINS_WITH_FIRMWARE_DRAWER.has(asset.builtinId)) {
        status = 'failed'
        messages.push(`Built-in "${asset.builtinId ?? '?'}" has no firmware drawer yet — renders in the studio preview but draws nothing on real hardware.`)
      }
    } else {
      if (!asset.frameRgba || asset.frameRgba.length === 0) {
        status = 'failed'
        messages.push('No decoded pixel data for this imported PNG/GIF — re-import the file (Import PNG.../Import GIF... in the Sticker Manager) so it can be re-encoded for export.')
      } else {
        const previewFrameCount = asset.frames?.length ?? 0
        if (asset.frameRgba.length !== previewFrameCount) {
          status = 'warning'
          messages.push(
            `Pixel data has ${asset.frameRgba.length} frame(s) but the preview has ${previewFrameCount} — some animation frames may be missing from the export. Re-import the file.`
          )
        }
        const dims = asset.frameRgba[0]
        if (dims && (dims.width === 0 || dims.height === 0)) {
          status = 'failed'
          messages.push('Decoded image has zero width/height.')
        }
      }
    }

    if (s.width <= 0 || s.height <= 0) {
      status = 'failed'
      messages.push(`Width/height is ${s.width}x${s.height} — nothing to draw at this size.`)
    }
    if (s.opacity <= 0) {
      status = status === 'failed' ? status : 'warning'
      messages.push('Opacity is 0% — invisible until an animation (fade-in, pulse) raises it.')
    }

    if (status === 'passed') messages.push('Exports correctly and will render on real hardware.')
    results.push({ stickerId: s.id, stickerName: s.name, scope, messages, status })
  }

  for (const s of project.stickers) checkInstance(s, 'Project')
  for (const e of project.expressions) {
    for (const s of e.stickers) checkInstance(s, `Expression "${e.name}"`)
  }
  for (const a of project.animations) {
    for (const s of a.stickers) checkInstance(s, `Animation "${a.name}"`)
  }

  return results
}
