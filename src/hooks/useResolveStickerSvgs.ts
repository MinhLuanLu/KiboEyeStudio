import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { recolorSvgSource } from '@/lib/svgRecolor'
import { rasterizeSvgText } from '@/lib/import/stickerImport'
import type { Project } from '@/types'

/** Every sticker instance across every scope (project + each expression + each animation) — the
 * one place that knows where sticker instances live, so the resolver below can sweep all of them. */
function allStickerInstances(project: Project) {
  return [project.stickers, ...project.expressions.map((e) => e.stickers), ...project.animations.map((a) => a.stickers)].flat()
}

/**
 * Keeps every SVG sticker's `resolvedSvg` (the studio-baked recolored bitmap the live canvas AND
 * the DOM-less C++ export both read — see StickerInstance.resolvedSvg) up to date for its CURRENT
 * tint/svgColorMode/asset — for ALL stickers, not just whichever is open in the Sticker Controls
 * panel.
 *
 * Why this is global (mounted once at the workspace root) rather than per-sticker: the old
 * per-panel effect only ran for the selected sticker and was cancelled the instant you deselected,
 * so a colour change on a non-selected sticker — or one deselected before its async rasterize
 * finished, or a duplicate that copied another sticker's already-recolored frame — left a STALE
 * bitmap. In a Combination that read as "the next Animation keeps the previous Animation's sticker
 * colour". updateSticker() now nulls resolvedSvg whenever tint/svgColorMode/assetId change; this
 * effect rebuilds every null one, reliably, from a stable signature so it converges without
 * looping (writing resolvedSvg back removes that sticker from the pending set).
 */
export function useResolveStickerSvgs(): void {
  // A stable signature of exactly which SVG stickers still need resolving (id + the inputs that
  // determine the recolor). Excludes resolvedSvg itself, so writing a result back shrinks the
  // signature rather than re-triggering on the same sticker. Object.is on the string keeps the
  // effect from firing on unrelated store changes (dragging a sticker, editing the eyes, etc.).
  const pendingSig = useStore((s) => {
    const assets = new Map(s.project.stickerAssets.map((a) => [a.id, a]))
    const parts: string[] = []
    for (const st of allStickerInstances(s.project)) {
      if (st.resolvedSvg != null) continue
      const asset = assets.get(st.assetId)
      if (asset?.kind === 'svg' && asset.svgSource) parts.push(`${st.id}:${st.tint ?? 'native'}:${st.svgColorMode}`)
    }
    return parts.join('|')
  })

  useEffect(() => {
    if (!pendingSig) return
    let cancelled = false
    const s = useStore.getState()
    const assets = new Map(s.project.stickerAssets.map((a) => [a.id, a]))
    for (const st of allStickerInstances(s.project)) {
      if (st.resolvedSvg != null) continue
      const asset = assets.get(st.assetId)
      if (asset?.kind !== 'svg' || !asset.svgSource) continue
      const id = st.id
      const recolored = recolorSvgSource(asset.svgSource, st.svgColorMode, st.tint)
      rasterizeSvgText(recolored)
        .then(({ dataUrl, rgba }) => {
          // Guard against a newer edit having superseded this one (a fresh invalidation re-runs
          // the effect with a new pendingSig, which flips this closure's `cancelled`).
          if (!cancelled) useStore.getState().setStickerResolvedSvg(id, { dataUrl, rgba })
        })
        .catch(() => {
          // Malformed/unrasterizable SVG — leave resolvedSvg null (drawSticker.ts falls back to the
          // asset's natural-colours preview) rather than throw.
        })
    }
    return () => {
      cancelled = true
    }
  }, [pendingSig])
}
