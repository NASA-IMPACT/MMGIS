import { test, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import PanelManager_ from '../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../src/essence/Basics/PanelManager_/types/layout.ts'

const PANEL_ID = 'pinned-panel'

const config = (overrides = {}) => ({
    id: PANEL_ID,
    position: 'left',
    layoutType: 'stacked',
    priority: 0,
    stateConstraints: {
        allowedStates: [PANEL_STATE.EXPANDED, PANEL_STATE.COLLAPSED],
        defaultState: PANEL_STATE.EXPANDED,
    },
    ...overrides,
})

const tool = (id) => ({ id, name: id, icon: 'mdi mdi-map' })

// The panel is rendered through the same entry point the layout uses, so the
// spec sees the real DOM shape: a pinned region and a body inside the content
// wrapper. Returns the rendered region element.
const renderPanel = async () => {
    const { _renderRegion } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )
    return _renderRegion('left', [PanelManager_.getPanelState(PANEL_ID)])[0]
}

afterEach(() => {
    PanelManager_.clear()
    vi.restoreAllMocks()
})

test('a panel with nothing pinned renders no pinned region', async () => {
    PanelManager_.registerPanel(config())
    PanelManager_.addToolToPanel(PANEL_ID, tool('Layers'))

    const region = await renderPanel()

    expect(region.querySelector('.ui-panel-pinned')).toBeNull()
    expect(region.querySelectorAll('.ui-panel-body > .ui-tool-card')).toHaveLength(1)
})

test('pinned tools render in the pinned region, above the panel body', async () => {
    PanelManager_.registerPanel(config())
    PanelManager_.addToolToPanel(PANEL_ID, tool('MapControl'), { pinned: true })
    PanelManager_.addToolToPanel(PANEL_ID, tool('Layers'))

    const region = await renderPanel()
    const content = region.querySelector('.ui-panel-content')
    const pinned = content.querySelector('.ui-panel-pinned')

    expect([...content.children].indexOf(pinned)).toBeLessThan(
        [...content.children].indexOf(content.querySelector('.ui-panel-body'))
    )
    expect([...pinned.querySelectorAll('.ui-tool-card')].map(c => c.dataset.tool)).toEqual(['MapControl'])
    expect(
        [...region.querySelectorAll('.ui-panel-body > .ui-tool-card')].map(c => c.dataset.tool)
    ).toEqual(['Layers'])
})

test('pinned tools render in the order they are configured', async () => {
    PanelManager_.registerPanel(config())
    PanelManager_.addToolToPanel(PANEL_ID, tool('First'), { pinned: true })
    PanelManager_.addToolToPanel(PANEL_ID, tool('Second'), { pinned: true })

    const region = await renderPanel()

    expect(
        [...region.querySelectorAll('.ui-panel-pinned .ui-tool-card')].map(c => c.dataset.tool)
    ).toEqual(['First', 'Second'])
})

test('a panel whose tools are all pinned renders no empty-panel message', async () => {
    PanelManager_.registerPanel(config())
    PanelManager_.addToolToPanel(PANEL_ID, tool('MapControl'), { pinned: true })

    const region = await renderPanel()

    expect(region.querySelector('.ui-panel-pinned .ui-tool-card')).not.toBeNull()
    expect(region.querySelector('.ui-empty-text')).toBeNull()
})

test('a panel with no tools at all still reports itself empty', async () => {
    PanelManager_.registerPanel(config())

    const region = await renderPanel()

    expect(region.querySelector('.ui-empty-text')).not.toBeNull()
})

test('in a tabbed panel the pinned region sits above the tab bar and out of the tabs', async () => {
    PanelManager_.registerPanel(config({ layoutType: 'tabbed' }))
    PanelManager_.addToolToPanel(PANEL_ID, tool('MapControl'), { pinned: true })
    PanelManager_.addToolToPanel(PANEL_ID, tool('Layers'))
    PanelManager_.addToolToPanel(PANEL_ID, tool('Draw'))

    const region = await renderPanel()
    const pinned = region.querySelector('.ui-panel-pinned')
    const tabBar = region.querySelector('.ui-panel-tabs')

    expect(pinned.compareDocumentPosition(tabBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect([...tabBar.querySelectorAll('.ui-panel-tab')].map(t => t.dataset.tool)).toEqual(['Layers', 'Draw'])
    expect([...pinned.querySelectorAll('.ui-tool-card')].map(c => c.dataset.tool)).toEqual(['MapControl'])
})

test('pinned tools keep their icon-tray buttons', async () => {
    PanelManager_.registerPanel(config())
    PanelManager_.addToolToPanel(PANEL_ID, tool('MapControl'), { pinned: true })
    PanelManager_.addToolToPanel(PANEL_ID, tool('Layers'))

    const region = await renderPanel()

    expect(
        [...region.querySelectorAll('.ui-panel-icons .ui-panel-icon-btn')].map(b => b.dataset.tool)
    ).toEqual(['MapControl', 'Layers'])
})
