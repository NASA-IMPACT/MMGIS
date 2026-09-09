import { test, expect, vi, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../src/pre/tools', () => ({ toolModules: {} }))

import ToolControllerModern_ from '../../src/essence/Basics/ToolController_/ToolControllerModern_'
import PanelManager_ from '../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../src/essence/Basics/PanelManager_/types/layout.ts'

const panel = (overrides = {}) => ({
    id: 'left-panel',
    position: 'left',
    layoutType: 'stacked',
    priority: 0,
    stateConstraints: {
        allowedStates: [PANEL_STATE.EXPANDED],
        defaultState: PANEL_STATE.EXPANDED,
    },
    ...overrides,
})

// Tool ids come from the config's `js` field, so these read back as the same
// names the panel lists.
const tools = (...names) => names.map(name => ({ name, js: name }))

const idsIn = (region) => region.map(t => t.id)

afterEach(() => {
    PanelManager_.clear()
})

test('pinned tools land in the pinned region and the rest in the body', () => {
    PanelManager_.registerPanel(panel({
        pinnedTools: ['MapControl'],
        panelTools: ['Layers', 'Draw'],
    }))

    ToolControllerModern_.assignToolsToPanels(tools('Layers', 'Draw', 'MapControl'))

    expect(idsIn(PanelManager_.getPinnedToolsForPanel('left-panel'))).toEqual(['MapControl'])
    expect(idsIn(PanelManager_.getScrollingToolsForPanel('left-panel'))).toEqual(['Layers', 'Draw'])
})

test('the pinned region follows the configured order, not the tools array order', () => {
    PanelManager_.registerPanel(panel({ pinnedTools: ['Second', 'First'] }))

    ToolControllerModern_.assignToolsToPanels(tools('First', 'Second'))

    expect(idsIn(PanelManager_.getPinnedToolsForPanel('left-panel'))).toEqual(['Second', 'First'])
})

test('a tool named in both lists is pinned once, not placed twice', () => {
    PanelManager_.registerPanel(panel({
        pinnedTools: ['MapControl'],
        panelTools: ['MapControl', 'Layers'],
    }))

    ToolControllerModern_.assignToolsToPanels(tools('MapControl', 'Layers'))

    expect(idsIn(PanelManager_.getPinnedToolsForPanel('left-panel'))).toEqual(['MapControl'])
    expect(idsIn(PanelManager_.getScrollingToolsForPanel('left-panel'))).toEqual(['Layers'])
})

test('a pinned tool is not placed a second time by the fallback pass', () => {
    PanelManager_.registerPanel(panel({ id: 'left-panel', pinnedTools: ['MapControl'] }))
    PanelManager_.registerPanel(panel({ id: 'right-panel', position: 'right', priority: 1 }))

    ToolControllerModern_.assignToolsToPanels(tools('MapControl'))

    expect(idsIn(PanelManager_.getPinnedToolsForPanel('left-panel'))).toEqual(['MapControl'])
    expect(PanelManager_.getToolsForPanel('right-panel')).toEqual([])
})

test('a pinned name that matches no tool is skipped without disturbing the rest', () => {
    PanelManager_.registerPanel(panel({
        pinnedTools: ['Ghost'],
        panelTools: ['Layers'],
    }))

    ToolControllerModern_.assignToolsToPanels(tools('Layers'))

    expect(PanelManager_.getPinnedToolsForPanel('left-panel')).toEqual([])
    expect(idsIn(PanelManager_.getScrollingToolsForPanel('left-panel'))).toEqual(['Layers'])
})

test('a panel with no pinned region keeps its pinned tools in the body', () => {
    PanelManager_.registerPanel(panel({
        id: 'top-panel',
        position: 'top',
        pinnedTools: ['MapControl'],
        panelTools: ['Layers'],
    }))

    ToolControllerModern_.assignToolsToPanels(tools('MapControl', 'Layers'))

    expect(PanelManager_.getPinnedToolsForPanel('top-panel')).toEqual([])
    expect(idsIn(PanelManager_.getScrollingToolsForPanel('top-panel'))).toEqual(['MapControl', 'Layers'])
})

test('a tool displaced by pinned tools filling maxTools lands in another panel', () => {
    PanelManager_.registerPanel(panel({
        id: 'left-panel',
        pinnedTools: ['MapControl'],
        panelTools: ['Layers'],
        capabilities: { maxTools: 1 },
    }))
    PanelManager_.registerPanel(panel({ id: 'right-panel', position: 'right', priority: 1 }))

    ToolControllerModern_.assignToolsToPanels(tools('MapControl', 'Layers'))

    expect(idsIn(PanelManager_.getPinnedToolsForPanel('left-panel'))).toEqual(['MapControl'])
    expect(PanelManager_.getScrollingToolsForPanel('left-panel')).toEqual([])
    expect(idsIn(PanelManager_.getToolsForPanel('right-panel'))).toEqual(['Layers'])
})
