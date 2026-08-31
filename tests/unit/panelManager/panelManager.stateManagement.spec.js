import { test, expect, vi } from 'vitest'

// PanelManager_ imports mmgisAPI, which transitively pulls in the entire Map_
// rendering stack. These specs only exercise panel logic, so mock it out (the
// adjacent __mocks__ stub) to keep the import graph light.
vi.mock('../../../src/essence/mmgisAPI/mmgisAPI')
import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { createMockPanelConfig, createMockToolMetadata, mockLayoutChangedEvents, setupWindowEnvironment } from './testHelpers.js'

test.describe('PanelManager - State Management', () => {
    let panelManager

    test.beforeEach(() => {
        setupWindowEnvironment()
        panelManager = new PanelManager()
    })

    test.describe('setPanelState', () => {
        test.beforeEach(() => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [
                        PANEL_STATE.COLLAPSED,
                        PANEL_STATE.ICONIFIED,
                        PANEL_STATE.FOCUSED,
                        PANEL_STATE.EXPANDED,
                    ],
                    defaultState: PANEL_STATE.EXPANDED,
                },
            })
            panelManager.registerPanel(config)
        })

        test('changes panel state to allowed state', () => {
            panelManager.setPanelState('test-panel', PANEL_STATE.ICONIFIED)

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.ICONIFIED)
        })

        test('triggers layout recalculation after state change', () => {
            const mock = mockLayoutChangedEvents()

            panelManager.setPanelState('test-panel', PANEL_STATE.COLLAPSED)

            expect(mock.events.length).toBeGreaterThan(0)
            expect(mock.events[mock.events.length - 1].type).toBe('panels:changed')
            mock.restore()
        })

        test('reports not-found for an unknown panel', () => {
            expect(panelManager.setPanelState('nonexistent', PANEL_STATE.COLLAPSED))
                .toEqual({ ok: false, reason: 'not-found' })
        })

        test('refuses a state outside allowedStates', () => {
            const config = createMockPanelConfig({
                id: 'restricted-panel',
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.EXPANDED,
                },
            })
            panelManager.registerPanel(config)

            expect(panelManager.setPanelState('restricted-panel', PANEL_STATE.ICONIFIED))
                .toEqual({ ok: false, reason: 'state-not-allowed' })
        })
    })

    test.describe('focusTool', () => {
        test.beforeEach(() => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [
                        PANEL_STATE.ICONIFIED,
                        PANEL_STATE.FOCUSED,
                        PANEL_STATE.EXPANDED,
                    ],
                    defaultState: PANEL_STATE.ICONIFIED,
                },
            })
            panelManager.registerPanel(config)

            const tool = createMockToolMetadata()
            panelManager.addToolToPanel('test-panel', tool)
        })

        test('focuses tool and transitions from iconified to focused', () => {
            panelManager.focusTool('test-panel', 'test-tool')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.FOCUSED)
            expect(state.activeToolId).toBe('test-tool')
        })

        test('sets active tool when already in focused state', () => {
            panelManager.setPanelState('test-panel', PANEL_STATE.FOCUSED)

            const tool2 = createMockToolMetadata({ id: 'tool-2' })
            panelManager.addToolToPanel('test-panel', tool2)

            panelManager.focusTool('test-panel', 'tool-2')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.FOCUSED)
            expect(state.activeToolId).toBe('tool-2')
        })

        test('throws when panel is in expanded state', () => {
            panelManager.setPanelState('test-panel', PANEL_STATE.EXPANDED)

            expect(() => panelManager.focusTool('test-panel', 'test-tool')).toThrow(
                'Cannot focus tool when panel is expanded. Panel must be in iconified or focused state.'
            )
        })

        test('throws when panel not found', () => {
            expect(() => panelManager.focusTool('nonexistent', 'test-tool')).toThrow(
                'Panel with ID nonexistent not found'
            )
        })

        test('throws when tool not found in panel', () => {
            expect(() => panelManager.focusTool('test-panel', 'nonexistent-tool')).toThrow(
                'Tool nonexistent-tool not found in panel test-panel'
            )
        })

        test('throws when panel is collapsed', () => {
            const config = createMockPanelConfig({
                id: 'collapsed-panel',
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.COLLAPSED,
                },
            })
            panelManager.registerPanel(config)

            const tool = createMockToolMetadata({ id: 'tool-3' })
            panelManager.addToolToPanel('collapsed-panel', tool)

            expect(() => panelManager.focusTool('collapsed-panel', 'tool-3')).toThrow(
                'Cannot focus tool when panel is collapsed'
            )
        })

        test('triggers layout recalculation', () => {
            const mock = mockLayoutChangedEvents()

            panelManager.focusTool('test-panel', 'test-tool')

            expect(mock.events.length).toBeGreaterThan(0)
            mock.restore()
        })
    })

})
