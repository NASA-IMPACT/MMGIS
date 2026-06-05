import { test, expect } from '@playwright/test'
import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_POSITION } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { createMockPanelConfig, mockWindowDispatchEvent, setupWindowEnvironment } from './testHelpers.js'

test.describe('PanelManager - Layout', () => {
    let panelManager

    test.beforeEach(() => {
        setupWindowEnvironment()
        panelManager = new PanelManager()
    })

    test.describe('resizePanel', () => {
        test('updates panel size when resizable', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: true,
                    minSize: 100,
                    maxSize: 500,
                },
            })
            panelManager.registerPanel(config)

            panelManager.resizePanel('test-panel', 300)

            const state = panelManager.getPanelState('test-panel')
            expect(state.currentSize).toBe(300)
        })

        test('constrains size to minimum', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: true,
                    minSize: 100,
                    maxSize: 500,
                },
            })
            panelManager.registerPanel(config)

            panelManager.resizePanel('test-panel', 50)

            const state = panelManager.getPanelState('test-panel')
            expect(state.currentSize).toBe(100)
        })

        test('constrains size to maximum', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: true,
                    minSize: 100,
                    maxSize: 500,
                },
            })
            panelManager.registerPanel(config)

            panelManager.resizePanel('test-panel', 600)

            const state = panelManager.getPanelState('test-panel')
            expect(state.currentSize).toBe(500)
        })

        test('does nothing when panel not resizable', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: false,
                },
            })
            panelManager.registerPanel(config)

            panelManager.resizePanel('test-panel', 300)

            const state = panelManager.getPanelState('test-panel')
            expect(state.currentSize).toBeUndefined()
        })

        test('throws when panel not found', () => {
            expect(() => panelManager.resizePanel('nonexistent', 300)).toThrow(
                'Panel with ID nonexistent not found'
            )
        })

        test('triggers layout recalculation after resize', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: true,
                },
            })
            panelManager.registerPanel(config)

            const mock = mockWindowDispatchEvent()

            panelManager.resizePanel('test-panel', 300)

            expect(mock.events.length).toBeGreaterThan(0)
            mock.restore()
        })

        test('uses default minSize of 0 when not specified', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: true,
                },
            })
            panelManager.registerPanel(config)

            panelManager.resizePanel('test-panel', -10)

            const state = panelManager.getPanelState('test-panel')
            expect(state.currentSize).toBe(0)
        })

        test('uses default maxSize of Infinity when not specified', () => {
            const config = createMockPanelConfig({
                capabilities: {
                    resizable: true,
                },
            })
            panelManager.registerPanel(config)

            panelManager.resizePanel('test-panel', 99999)

            const state = panelManager.getPanelState('test-panel')
            expect(state.currentSize).toBe(99999)
        })
    })

    test.describe('notifyLayoutChanged', () => {
        test('dispatches custom event with panel data', () => {
            const mock = mockWindowDispatchEvent()

            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            // notifyLayoutChanged is called during registration, clear previous events
            mock.events.length = 0

            panelManager.notifyLayoutChanged()

            expect(mock.events.length).toBe(1)
            expect(mock.events[0].type).toBe('mmgis-panel-layout-changed')
            expect(mock.events[0].detail.panels).toBeDefined()
            expect(mock.events[0].detail.panels.length).toBe(1)
            mock.restore()
        })

        test('includes all panels sorted by priority in event', () => {
            const mock = mockWindowDispatchEvent()

            const config1 = createMockPanelConfig({ id: 'panel-1', priority: 2 })
            const config2 = createMockPanelConfig({ id: 'panel-2', priority: 0 })
            const config3 = createMockPanelConfig({ id: 'panel-3', priority: 1 })

            panelManager.registerPanel(config1)
            panelManager.registerPanel(config2)
            panelManager.registerPanel(config3)

            mock.events.length = 0
            panelManager.notifyLayoutChanged()

            const event = mock.events[0]
            expect(event.detail.panels[0].id).toBe('panel-2')
            expect(event.detail.panels[1].id).toBe('panel-3')
            expect(event.detail.panels[2].id).toBe('panel-1')
            mock.restore()
        })
    })
})
