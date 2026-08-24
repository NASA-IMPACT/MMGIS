import { test, expect, vi } from 'vitest'

// PanelManager_ imports mmgisAPI, which transitively pulls in the entire Map_
// rendering stack. These specs only exercise panel logic, so mock it out (the
// adjacent __mocks__ stub) to keep the import graph light.
vi.mock('../../../src/essence/mmgisAPI/mmgisAPI')
import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { createMockPanelConfig, mockLayoutChangedEvents, setupWindowEnvironment } from './testHelpers.js'

test.describe('PanelManager - Registration', () => {
    let panelManager

    test.beforeEach(() => {
        setupWindowEnvironment()
        panelManager = new PanelManager()
    })

    test.describe('registerPanel', () => {
        test('registers a panel with basic configuration', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            const state = panelManager.getPanelState('test-panel')
            expect(state).toBeDefined()
            expect(state.id).toBe('test-panel')
            expect(state.state).toBe(PANEL_STATE.EXPANDED)
            expect(state.config).toEqual(config)
        })

        test('initializes panel with correct default state', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.ICONIFIED],
                    defaultState: PANEL_STATE.ICONIFIED,
                },
            })
            panelManager.registerPanel(config)

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.ICONIFIED)
        })

        test('initializes empty tools map', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools).toBeInstanceOf(Map)
            expect(state.tools.size).toBe(0)
        })

        test('generates containerId from panel id', () => {
            const config = createMockPanelConfig({ id: 'my-panel' })
            panelManager.registerPanel(config)

            const state = panelManager.getPanelState('my-panel')
            expect(state.containerId).toBe('panel-my-panel')
        })

        test('throws when registering duplicate panel ID', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            expect(() => panelManager.registerPanel(config)).toThrow(
                'Panel with ID test-panel already exists'
            )
        })

        test('throws when defaultState is not in allowedStates', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.ICONIFIED, PANEL_STATE.FOCUSED],
                    defaultState: PANEL_STATE.EXPANDED, // Not in allowedStates!
                },
            })

            expect(() => panelManager.registerPanel(config)).toThrow(
                "Invalid configuration for panel test-panel: defaultState 'expanded' is not in allowedStates"
            )
        })

        test('triggers layout recalculation after registration', () => {
            const mock = mockLayoutChangedEvents()
            const config = createMockPanelConfig()

            panelManager.registerPanel(config)

            expect(mock.events.length).toBe(1)
            expect(mock.events[0].type).toBe('mmgis-panel-layout-changed')
            mock.restore()
        })
    })

    test.describe('unregisterPanel', () => {
        test('removes a registered panel', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            panelManager.unregisterPanel('test-panel')

            const state = panelManager.getPanelState('test-panel')
            expect(state).toBeUndefined()
        })

        test('throws when unregistering non-existent panel', () => {
            expect(() => panelManager.unregisterPanel('nonexistent')).toThrow(
                'Panel with ID nonexistent not found'
            )
        })

        test('triggers layout recalculation after unregistration', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            const mock = mockLayoutChangedEvents()

            panelManager.unregisterPanel('test-panel')

            expect(mock.events.length).toBe(1)
            expect(mock.events[0].type).toBe('mmgis-panel-layout-changed')
            mock.restore()
        })

        test('allows re-registering a panel after unregistering', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)
            panelManager.unregisterPanel('test-panel')

            // Should not throw
            expect(() => panelManager.registerPanel(config)).not.toThrow()

            const state = panelManager.getPanelState('test-panel')
            expect(state).toBeDefined()
        })
    })
})
