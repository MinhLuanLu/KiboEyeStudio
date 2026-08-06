import { useState } from 'react'
import { useStore } from '@/state/store'
import type { UiAsset, UiCssRule, UiDesignProject, UiWidget } from '@/types'
import { computeEffectiveStyle } from '@/lib/uiDesign/cssCascade'
import { CONTAINER_LIKE, DEFAULT_VISUAL_CSS, WidgetInner, backgroundImageCss, mergeDefined, styleToCss } from './WidgetRenderer'

/** Read-only recursive widget renderer for the Export dialog's preview — reuses the exact same
 * presentational mapping (styleToCss/backgroundImageCss/WidgetInner/DEFAULT_VISUAL_CSS) the real
 * design canvas's WidgetRenderer uses, so "what you see here" can never drift from "what you see
 * while designing." Deliberately does NOT reuse WidgetRenderer itself — that component wires up
 * click-to-select/drag-to-move/resize against the live project, which would let a click inside
 * this preview accidentally move something while the user is just trying to look at the export. */
function PreviewNode({
  widget,
  widgets,
  cssRules,
  assetsById,
  theme
}: {
  widget: UiWidget
  widgets: Record<string, UiWidget>
  cssRules: UiCssRule[]
  assetsById: Map<string, UiAsset>
  theme: Pick<UiDesignProject, 'theme' | 'customThemeTokens'>
}) {
  if (!widget.visible) return null

  if (widget.type === 'screen') {
    const screenEffectiveStyle = computeEffectiveStyle(widget, cssRules, theme)
    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: screenEffectiveStyle.backgroundGradient
            ? `linear-gradient(${screenEffectiveStyle.backgroundGradient.direction === 'horizontal' ? '90deg' : '180deg'}, ${screenEffectiveStyle.background ?? 'transparent'}, ${screenEffectiveStyle.backgroundGradient.to})`
            : screenEffectiveStyle.background,
          opacity: screenEffectiveStyle.opacity !== undefined ? screenEffectiveStyle.opacity / 100 : undefined,
          ...backgroundImageCss(screenEffectiveStyle, assetsById)
        }}
      >
        {widget.childIds.map((id) => {
          const child = widgets[id]
          return child ? <PreviewNode key={id} widget={child} widgets={widgets} cssRules={cssRules} assetsById={assetsById} theme={theme} /> : null
        })}
      </div>
    )
  }

  const effectiveStyle = computeEffectiveStyle(widget, cssRules, theme)
  const isImageLike = widget.type === 'image' || widget.type === 'icon'
  const transformParts: string[] = []
  if (isImageLike && effectiveStyle.rotation) transformParts.push(`rotate(${effectiveStyle.rotation}deg)`)
  if (isImageLike && effectiveStyle.scale !== undefined && effectiveStyle.scale !== 1) transformParts.push(`scale(${effectiveStyle.scale})`)
  const css = mergeDefined(DEFAULT_VISUAL_CSS[widget.type] ?? {}, {
    ...styleToCss(effectiveStyle),
    ...backgroundImageCss(effectiveStyle, assetsById),
    transform: transformParts.length > 0 ? transformParts.join(' ') : undefined
  })
  const isDisabled = Boolean(widget.props.disabled)

  return (
    <div
      className={`kibo-ui-widget kibo-ui-widget--${widget.type}`}
      style={{
        ...css,
        position: 'absolute',
        opacity: isDisabled ? ((css.opacity as number | undefined) ?? 1) * 0.5 : css.opacity
      }}
    >
      <WidgetInner widget={widget} />
      {CONTAINER_LIKE.has(widget.type) &&
        widget.childIds.map((id) => {
          const child = widgets[id]
          return child ? <PreviewNode key={id} widget={child} widgets={widgets} cssRules={cssRules} assetsById={assetsById} theme={theme} /> : null
        })}
    </div>
  )
}

/** A screen-shaped, screen-sized read-only preview box — the "how does this look" companion to
 * the Export dialog's code tabs. Renders straight from the live project.uiDesign (the exact same
 * data the selected export mode reads), not from the generated C++ text, so it's always in sync
 * with what you're about to download without needing a real LVGL engine to interpret the export. */
export function LvglScreenPreview({ screenId }: { screenId: string | null }) {
  const uiDesign = useStore((s) => s.project.uiDesign)
  const screen = uiDesign.screens.find((s) => s.id === screenId) ?? uiDesign.screens[0]
  const assetsById = new Map(uiDesign.assets.map((a) => [a.id, a]))
  const display = uiDesign.display
  const borderRadius = display.shape === 'round' ? '50%' : '0px'

  if (!screen) {
    return <div className="p-3 text-xs text-studio-muted">No screens in this project yet.</div>
  }
  const root = uiDesign.widgets[screen.rootWidgetId]
  if (!root) return null

  // Scale the box down to fit a modest preview column, matching the display's own aspect ratio
  // exactly (never distorted) — a plain CSS transform, not a re-layout, so it's pixel-identical
  // to the full-size canvas just shrunk.
  const maxBoxWidth = 220
  const scale = Math.min(1, maxBoxWidth / Math.max(1, display.width))

  return (
    <div className="flex flex-col items-center gap-1.5 p-2">
      <div style={{ width: display.width * scale, height: display.height * scale }}>
        <div
          style={{
            width: display.width,
            height: display.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            borderRadius,
            background: '#ffffff',
            overflow: 'hidden',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 4px 12px rgba(0,0,0,0.35)',
            color: '#000000',
            fontFamily: 'Montserrat, Arial, sans-serif',
            fontSize: 14
          }}
        >
          <PreviewNode
            widget={root}
            widgets={uiDesign.widgets}
            cssRules={uiDesign.css}
            assetsById={assetsById}
            theme={{ theme: uiDesign.theme, customThemeTokens: uiDesign.customThemeTokens }}
          />
        </div>
      </div>
      <span className="text-[10px] text-studio-muted">
        {screen.name} · {Math.round(display.width)}×{Math.round(display.height)}
      </span>
    </div>
  )
}

/** Multi-screen variant for Complete Project/Module/Header modes (which export every screen, not
 * just one) — a small tab strip above the same LvglScreenPreview, defaulting to whichever screen
 * is active in the design canvas. */
export function LvglMultiScreenPreview() {
  const uiDesign = useStore((s) => s.project.uiDesign)
  const [selected, setSelected] = useState<string | null>(null)
  const screenId = selected && uiDesign.screens.some((s) => s.id === selected) ? selected : (uiDesign.activeScreenId ?? uiDesign.screens[0]?.id ?? null)

  if (uiDesign.screens.length === 0) return <div className="p-3 text-xs text-studio-muted">No screens in this project yet.</div>

  return (
    <div className="flex flex-col">
      {uiDesign.screens.length > 1 && (
        <div className="flex items-center gap-1 px-2 pt-2 flex-wrap">
          {uiDesign.screens.map((s) => (
            <button
              key={s.id}
              className={`studio-tab text-[10px] ${screenId === s.id ? 'studio-tab-active' : ''}`}
              onClick={() => setSelected(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <LvglScreenPreview screenId={screenId} />
    </div>
  )
}
