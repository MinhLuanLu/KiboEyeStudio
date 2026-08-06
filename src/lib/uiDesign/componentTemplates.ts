// Professional Components — 6 of the spec's ~18 this pass (Card, Floating Panel, Top App Bar,
// FAB, Notification Badge, Dashboard Tile). Deliberately NOT new UiWidgetType members: each is a
// small factory composing existing, fully-exportable widget types (container/label/button) into a
// pre-styled group — same "compose existing types, don't invent new codegen" lesson this project
// already learned building the Keyboard widget (which composed 3 existing types instead of one
// monolithic new one). Because every produced widget is a type lvglExport.ts already fully
// supports, applying a component template needs ZERO new export codegen.

import type { UiWidget } from '@/types'
import { createWidget } from './widgetDefaults'

export type ComponentTemplateId = 'card' | 'floatingPanel' | 'topAppBar' | 'fab' | 'notificationBadge' | 'dashboardTile'

export const COMPONENT_TEMPLATE_LABELS: Record<ComponentTemplateId, string> = {
  card: 'Card',
  floatingPanel: 'Floating Panel',
  topAppBar: 'Top App Bar',
  fab: 'FAB',
  notificationBadge: 'Notification Badge',
  dashboardTile: 'Dashboard Tile'
}

/** `root` is the top-level widget the caller attaches to the drop target's childIds (matching
 * addUiWidget's own parentId/childIds wiring for the Keyboard widget's linked siblings);
 * `descendants` are root's own children (and their children), already wired to each other and to
 * `root.id` via parentId/childIds, but NOT yet inserted into the project's widget map — the caller
 * (the store action below) does that in one pass, same as addUiWidget's keyboard case. */
export interface ComponentTemplateResult {
  root: UiWidget
  descendants: UiWidget[]
}

function child(type: Parameters<typeof createWidget>[0], parentId: string, overrides: Partial<UiWidget>): UiWidget {
  const w = createWidget(type)
  w.parentId = parentId
  Object.assign(w, overrides)
  return w
}

export function createComponentTemplate(id: ComponentTemplateId): ComponentTemplateResult {
  switch (id) {
    case 'card': {
      const root = createWidget('container')
      root.style = { ...root.style, width: 160, height: 90, background: '#1E1E1E', borderRadius: 12, elevation: 6, paddingTop: 10, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }
      const title = child('label', root.id, { text: 'Card Title', style: { x: 10, y: 10, width: 140, height: 18, color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 } })
      const subtitle = child('label', root.id, { text: 'Supporting text goes here', style: { x: 10, y: 34, width: 140, height: 32, color: '#B0B0B0', fontSize: 11 } })
      root.childIds = [title.id, subtitle.id]
      return { root, descendants: [title, subtitle] }
    }
    case 'floatingPanel': {
      const root = createWidget('container')
      root.style = {
        ...root.style,
        width: 140,
        height: 80,
        background: '#FFFFFF',
        backgroundOpacity: 18,
        borderWidth: 1,
        borderColor: '#FFFFFF',
        borderOpacity: 35,
        borderRadius: 16,
        elevation: 10,
        surfaceStyle: 'glass'
      }
      return { root, descendants: [] }
    }
    case 'topAppBar': {
      const root = createWidget('flex')
      root.style = {
        ...root.style,
        width: '100%',
        height: 44,
        x: 0,
        y: 0,
        background: '#1A1A1F',
        elevation: 2,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12
      }
      const title = child('label', root.id, { text: 'Screen Title', style: { width: 'auto', height: 20, color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 } })
      root.childIds = [title.id]
      return { root, descendants: [title] }
    }
    case 'fab': {
      const root = createWidget('button')
      root.text = ''
      root.iconSymbol = 'LV_SYMBOL_PLUS'
      root.style = { ...root.style, width: 52, height: 52, borderRadius: 26, background: '#2196F3', elevation: 8, color: '#FFFFFF', fontSize: 20, textAlign: 'center' }
      return { root, descendants: [] }
    }
    case 'notificationBadge': {
      const root = createWidget('container')
      root.style = { ...root.style, width: 20, height: 20, borderRadius: 10, background: '#E53935', elevation: 2 }
      const count = child('label', root.id, { text: '1', style: { x: 0, y: 2, width: 20, height: 16, color: '#FFFFFF', fontSize: 11, textAlign: 'center' } })
      root.childIds = [count.id]
      return { root, descendants: [count] }
    }
    case 'dashboardTile': {
      const root = createWidget('container')
      root.style = { ...root.style, width: 100, height: 80, background: '#1E1E1E', borderRadius: 10, elevation: 4 }
      const icon = child('icon', root.id, { iconSymbol: 'LV_SYMBOL_CHARGE', style: { x: 8, y: 8, width: 20, height: 20, color: '#4FA3FF', fontSize: 18 } })
      const value = child('label', root.id, { text: '72%', style: { x: 8, y: 30, width: 84, height: 22, color: '#FFFFFF', fontWeight: 'bold', fontSize: 18 } })
      const caption = child('label', root.id, { text: 'Battery', style: { x: 8, y: 56, width: 84, height: 16, color: '#8A8A8A', fontSize: 10 } })
      root.childIds = [icon.id, value.id, caption.id]
      return { root, descendants: [icon, value, caption] }
    }
  }
}
