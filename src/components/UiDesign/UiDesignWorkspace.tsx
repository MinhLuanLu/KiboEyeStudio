import { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { ToolbarActions } from '@/components/Layout/Toolbar'
import { PanelTabs } from '@/components/ui/PanelTabs'
import { UiDesignTopBar } from './UiDesignTopBar'
import { ScreenTabs } from './ScreenTabs'
import { Toolbox } from './Toolbox'
import { LayersPanel } from './LayersPanel'
import { Canvas } from './Canvas'
import { PropertiesPanel } from './PropertiesPanel'
import { HtmlEditor } from './HtmlEditor'
import { CssEditor } from './CssEditor'
import { AssetManagerPanel } from './AssetManagerPanel'
import { DisplaySettingsPanel } from './DisplaySettingsPanel'
import { LogicPanel } from './LogicPanel'
import { VariableManagerPanel } from './VariableManagerPanel'
import { DataSourceManagerPanel } from './DataSourceManagerPanel'
import { LvglCodePanel } from './LvglCodePanel'
import { useUiDesignKeyboardShortcuts } from '@/lib/uiDesign/useUiDesignKeyboardShortcuts'
import { WorkspaceSettingsPanel } from './WorkspaceSettingsPanel'

type LeftTab = 'toolbox' | 'layers'
type RightTab = 'properties' | 'html' | 'css' | 'assets' | 'display' | 'logic' | 'variables' | 'dataSources' | 'workspace'

const LEFT_TABS: { value: LeftTab; label: string }[] = [
  { value: 'toolbox', label: 'Toolbox' },
  { value: 'layers', label: 'Layers' }
]

const RIGHT_TABS: { value: RightTab; label: string }[] = [
  { value: 'properties', label: 'Properties' },
  { value: 'dataSources', label: 'Data Sources' },
  { value: 'assets', label: 'Assets' },
  { value: 'display', label: 'Display' },
  { value: 'workspace', label: 'Workspace' },
  // Less frequently used than the panels above — kept at the end of the tab list.
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'logic', label: 'Logic' },
  { value: 'variables', label: 'Variables' }
]

function ResizeHandle({ direction = 'vertical' }: { direction?: 'vertical' | 'horizontal' }) {
  return (
    <PanelResizeHandle
      className={`bg-studio-border hover:bg-studio-accent transition-colors ${direction === 'vertical' ? 'w-px' : 'h-px'}`}
    />
  )
}

// UI Design Mode's own fully self-contained workspace — its own top bar (UiDesignTopBar) plus
// its own 3-pane shell, structurally independent from EyeStudioWorkspace (its own local
// left/right sub-tab state, not the store's leftTab/rightTab). Not a tab within a shared shell
// — AppShell renders this in place of the entire Eye Studio tree, never alongside it.
export function UiDesignWorkspace({ toolbarActions }: { toolbarActions: ToolbarActions }) {
  const [leftTab, setLeftTab] = useState<LeftTab>('toolbox')
  const [rightTab, setRightTab] = useState<RightTab>('properties')
  useUiDesignKeyboardShortcuts()

  return (
    <div className="flex flex-col h-full">
      <UiDesignTopBar actions={toolbarActions} />
      <ScreenTabs />
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          {/* Every <Panel> below gets className="flex flex-col" so it establishes a real flex
              container for its own child — react-resizable-panels sizes a Panel itself via
              inline `flex: <grow> 1 0px` on a plain (non-flex) block div, so a child relying on
              `height: 100%` to fill it is resolving a percentage against a box whose `height`
              CSS property was never explicitly set (only its flex-basis was) — some browsers
              don't propagate that as a definite size to percentage-height grandchildren, so the
              child silently falls back to its own intrinsic content height instead of being
              capped. That's latent in every panel here, but only visibly breaks the ones whose
              content can genuinely grow past the allotted space (the LVGL Code editor, backed by
              CodeMirror, is the one that actually does) — making the Panel a real flex container
              and using `flex-1 min-h-0` (flex-item-to-flex-item sizing, not percentage-height)
              on the child sidesteps the ambiguity entirely, for all four panels alike. */}
          <Panel defaultSize={18} minSize={14} maxSize={30} className="flex flex-col">
            <div className="flex-1 min-h-0 studio-panel m-2 mr-1 flex flex-col overflow-hidden">
              <PanelTabs tabs={LEFT_TABS} active={leftTab} onChange={setLeftTab} />
              <div className="flex-1 min-h-0 overflow-y-auto">
                {leftTab === 'toolbox' && <Toolbox />}
                {leftTab === 'layers' && <LayersPanel />}
              </div>
            </div>
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={56} minSize={35} className="flex flex-col">
            <PanelGroup direction="vertical">
              <Panel defaultSize={58} minSize={25} className="flex flex-col">
                <div className="flex-1 min-h-0 m-2 mx-1 mb-1 studio-panel overflow-hidden">
                  <Canvas />
                </div>
              </Panel>

              <ResizeHandle direction="horizontal" />

              <Panel defaultSize={42} minSize={15} className="flex flex-col">
                <div className="flex-1 min-h-0 m-2 mx-1 mt-1 studio-panel flex flex-col overflow-hidden">
                  <div className="px-2 py-1.5 border-b border-studio-border text-xs font-medium shrink-0">LVGL Code</div>
                  <LvglCodePanel />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <ResizeHandle />

          <Panel defaultSize={26} minSize={18} maxSize={38} className="flex flex-col">
            <div className="flex-1 min-h-0 studio-panel m-2 ml-1 flex flex-col overflow-hidden">
              <PanelTabs tabs={RIGHT_TABS} active={rightTab} onChange={setRightTab} />
              <div className="flex-1 min-h-0 overflow-y-auto">
                {rightTab === 'properties' && <PropertiesPanel />}
                {rightTab === 'html' && <HtmlEditor />}
                {rightTab === 'css' && <CssEditor />}
                {rightTab === 'logic' && <LogicPanel />}
                {rightTab === 'variables' && <VariableManagerPanel />}
                {rightTab === 'dataSources' && <DataSourceManagerPanel />}
                {rightTab === 'assets' && <AssetManagerPanel />}
                {rightTab === 'display' && <DisplaySettingsPanel />}
                {rightTab === 'workspace' && <WorkspaceSettingsPanel />}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}
