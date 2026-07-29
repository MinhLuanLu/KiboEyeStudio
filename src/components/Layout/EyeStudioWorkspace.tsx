import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from '@/state/store'
import type { LeftTab, RightTab } from '@/state/store'
import { Toolbar, type ToolbarActions } from './Toolbar'
import { PreviewCanvas } from '@/components/Canvas/PreviewCanvas'
import { Timeline } from '@/components/Timeline/Timeline'
import { AnimationLibraryPanel } from '@/components/Library/AnimationLibraryPanel'
import { ExpressionLibraryPanel } from '@/components/Library/ExpressionLibraryPanel'
import { ControlsPanel } from '@/components/Controls/ControlsPanel'
import { PersonalityPanel } from '@/components/Personality/PersonalityPanel'
import { ColorPanel } from '@/components/Colors/ColorPanel'
import { DisplayPanel } from '@/components/Display/DisplayPanel'
import { DevModePanel } from '@/components/DevMode/DevModePanel'
import { VisualReferencePanel } from '@/components/VisualReference/VisualReferencePanel'
import { StickerManagerPanel } from '@/components/Stickers/StickerManagerPanel'
import { PanelTabs } from '@/components/ui/PanelTabs'

const LEFT_TABS: { value: LeftTab; label: string }[] = [
  { value: 'animations', label: 'Animations' },
  { value: 'expressions', label: 'Expressions' }
]

const RIGHT_TABS: { value: RightTab; label: string }[] = [
  { value: 'controls', label: 'Controls' },
  { value: 'colors', label: 'Colors' },
  { value: 'display', label: 'Display' },
  { value: 'personality', label: 'Personality' },
  { value: 'visual-reference', label: 'Visual Reference' },
  { value: 'stickers', label: 'Stickers' }
]

function ResizeHandle({ direction = 'vertical' }: { direction?: 'vertical' | 'horizontal' }) {
  return (
    <PanelResizeHandle
      className={`bg-studio-border hover:bg-studio-accent transition-colors ${
        direction === 'vertical' ? 'w-px' : 'h-px'
      }`}
    />
  )
}

// A fully self-contained workspace — its own top bar (Toolbar) plus its own panel layout, not
// a tab within a shared shell. Extracted from the app's original single-workspace AppShell.tsx
// so it's a structurally separate component tree from UiDesignWorkspace and can't accidentally
// share panel/tab state with it.
export function EyeStudioWorkspace({ toolbarActions }: { toolbarActions: ToolbarActions }) {
  const leftTab = useStore((s) => s.leftTab)
  const setLeftTab = useStore((s) => s.setLeftTab)
  const rightTab = useStore((s) => s.rightTab)
  const setRightTab = useStore((s) => s.setRightTab)

  return (
    <div className="flex flex-col h-full">
      <Toolbar actions={toolbarActions} />
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={18} minSize={14} maxSize={30}>
            <div className="h-full studio-panel m-2 mr-1 flex flex-col overflow-hidden">
              <PanelTabs tabs={LEFT_TABS} active={leftTab} onChange={setLeftTab} />
              <div className="flex-1 min-h-0">
                {leftTab === 'animations' && <AnimationLibraryPanel />}
                {leftTab === 'expressions' && <ExpressionLibraryPanel />}
              </div>
            </div>
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={56} minSize={35}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={68} minSize={30}>
                <div className="h-full relative m-2 mb-1 studio-panel flex items-center justify-center overflow-hidden">
                  <DevModePanel />
                  <PreviewCanvas />
                </div>
              </Panel>
              <ResizeHandle direction="horizontal" />
              <Panel defaultSize={32} minSize={18}>
                <div className="h-full studio-panel m-2 mt-1 overflow-hidden">
                  <Timeline />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={26} minSize={18} maxSize={38}>
            <div className="h-full studio-panel m-2 ml-1 flex flex-col overflow-hidden">
              <PanelTabs tabs={RIGHT_TABS} active={rightTab} onChange={setRightTab} />
              <div className="flex-1 min-h-0">
                {rightTab === 'controls' && <ControlsPanel />}
                {rightTab === 'colors' && <ColorPanel />}
                {rightTab === 'display' && <DisplayPanel />}
                {rightTab === 'personality' && <PersonalityPanel />}
                {rightTab === 'visual-reference' && <VisualReferencePanel />}
                {rightTab === 'stickers' && <StickerManagerPanel />}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
