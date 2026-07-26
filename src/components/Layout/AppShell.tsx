import { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
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
import { ExportDialog } from '@/components/Export/ExportDialog'
import { ReferenceImportDialog } from '@/components/Import/ReferenceImportDialog'

function ResizeHandle({ direction = 'vertical' }: { direction?: 'vertical' | 'horizontal' }) {
  return (
    <PanelResizeHandle
      className={`bg-studio-border hover:bg-studio-accent transition-colors ${
        direction === 'vertical' ? 'w-px' : 'h-px'
      }`}
    />
  )
}

export function AppShell({ toolbarActions }: { toolbarActions: ToolbarActions }) {
  const [leftTab, setLeftTab] = useState<'animations' | 'expressions'>('animations')
  const [rightTab, setRightTab] = useState<'controls' | 'colors' | 'display' | 'personality'>('controls')

  return (
    <div className="flex flex-col h-screen w-screen">
      <Toolbar actions={toolbarActions} />
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={18} minSize={14} maxSize={30}>
            <div className="h-full studio-panel m-2 mr-1 flex flex-col overflow-hidden">
              <div className="flex border-b border-studio-border">
                <button
                  className={`studio-tab flex-1 ${leftTab === 'animations' ? 'studio-tab-active' : ''}`}
                  onClick={() => setLeftTab('animations')}
                >
                  Animations
                </button>
                <button
                  className={`studio-tab flex-1 ${leftTab === 'expressions' ? 'studio-tab-active' : ''}`}
                  onClick={() => setLeftTab('expressions')}
                >
                  Expressions
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {leftTab === 'animations' ? <AnimationLibraryPanel /> : <ExpressionLibraryPanel />}
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
              <div className="flex border-b border-studio-border">
                <button
                  className={`studio-tab flex-1 ${rightTab === 'controls' ? 'studio-tab-active' : ''}`}
                  onClick={() => setRightTab('controls')}
                >
                  Controls
                </button>
                <button
                  className={`studio-tab flex-1 ${rightTab === 'colors' ? 'studio-tab-active' : ''}`}
                  onClick={() => setRightTab('colors')}
                >
                  Colors
                </button>
                <button
                  className={`studio-tab flex-1 ${rightTab === 'display' ? 'studio-tab-active' : ''}`}
                  onClick={() => setRightTab('display')}
                >
                  Display
                </button>
                <button
                  className={`studio-tab flex-1 ${rightTab === 'personality' ? 'studio-tab-active' : ''}`}
                  onClick={() => setRightTab('personality')}
                >
                  Personality
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {rightTab === 'controls' && <ControlsPanel />}
                {rightTab === 'colors' && <ColorPanel />}
                {rightTab === 'display' && <DisplayPanel />}
                {rightTab === 'personality' && <PersonalityPanel />}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
      <ExportDialog />
      <ReferenceImportDialog />
    </div>
  )
}
