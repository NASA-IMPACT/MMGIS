import { test, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
// Reaching 'hidden' from 'unloaded' loads the plugin first, and loadPlugin
// looks tool ids up in the real registry; stand in a minimal module.
vi.mock('../../../src/pre/tools', () => ({
    toolModules: { ReconcileTool: { make: () => {}, destroy: () => {} } },
}))

import { mmgisAPI, mmgisAPI_ } from '../../../src/essence/mmgisAPI/mmgisAPI'
import PanelManager_ from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import ToolControllerModern_ from '../../../src/essence/Basics/ToolController_/ToolControllerModern_'
import { PANEL_STATE, COMMAND_REFUSAL_REASONS as CORE_REASONS }
    from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import {
    PANEL_PLUGIN_BUS,
    PANEL_PLUGIN_EVENTS,
    COMMAND_REFUSAL_REASONS as CLIENT_REASONS,
    mmgisOnPanelsChanged,
    mmgisOnPluginsChanged,
} from '../../../src/essence/Tools/_shared/adapters/mmgisAPI.ts'

// The client-side specs stub window.mmgisAPI, so a name that drifts from the
// provider answering it still passes there. This file drives the real bus.

beforeEach(() => {
    window.mmgisAPI = mmgisAPI
})

afterEach(() => {
    delete window.mmgisAPI
    vi.restoreAllMocks()
})

test('every name the client speaks is a name core answers', () => {
    for (const name of Object.values(PANEL_PLUGIN_BUS)) {
        expect(mmgisAPI.hasHandler(name), `no provider registered for "${name}"`).toBe(true)
    }
})

test('the client subscribes to the panel event core actually emits', () => {
    mmgisAPI_._panelManager = PanelManager_
    const seen = []
    const off = mmgisOnPanelsChanged((panels) => seen.push(panels))

    try {
        PanelManager_.registerPanel({
            id: 'reconcile-panel',
            position: 'left',
            layoutType: 'stacked',
            priority: 0,
            stateConstraints: {
                allowedStates: [PANEL_STATE.EXPANDED, PANEL_STATE.COLLAPSED],
                defaultState: PANEL_STATE.EXPANDED,
            },
        })

        expect(seen).toHaveLength(1)
        expect(seen[0]).toContainEqual(
            expect.objectContaining({ id: 'reconcile-panel', state: 'expanded' })
        )
    } finally {
        off()
        PanelManager_.unregisterPanel('reconcile-panel')
        mmgisAPI_._panelManager = null
    }
})

test('the client subscribes to the plugin event core actually emits', () => {
    document.body.innerHTML = '<div id="reconcile-target"></div>'
    mmgisAPI_._pluginController = ToolControllerModern_
    const seen = []
    const off = mmgisOnPluginsChanged((plugins) => seen.push(plugins))

    try {
        ToolControllerModern_.registerDeferred(
            { id: 'ReconcileTool', name: 'Reconcile' }, 'reconcile-target'
        )
        ToolControllerModern_.setPluginState('ReconcileTool', 'hidden')

        expect(seen).toHaveLength(1)
        expect(seen[0]).toContainEqual({ id: 'ReconcileTool', state: 'hidden' })
    } finally {
        off()
        ToolControllerModern_.destroyAllTools()
        mmgisAPI_._pluginController = null
        document.body.innerHTML = ''
    }
})

test('both sides name the same refusal reasons', () => {
    // Each side of the bus writes the list out separately.
    expect([...CLIENT_REASONS].sort()).toEqual([...CORE_REASONS].sort())
})
