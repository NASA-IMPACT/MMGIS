import { test, expect } from '@playwright/test'
import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_POSITION } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { TOOL_ORIENTATION } from '../../../src/essence/Basics/ToolController_/types/tool.ts'
import { createMockPanelConfig, createMockToolMetadata, setupWindowEnvironment } from './testHelpers.js'

test.describe('PanelManager - Queries', () => {
    let panelManager

    test.beforeEach(() => {
        setupWindowEnvironment()
        panelManager = new PanelManager()
    })

    test.describe('getPanelState', () => {
        test('returns panel state for existing panel', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            const state = panelManager.getPanelState('test-panel')
            expect(state).toBeDefined()
            expect(state.id).toBe('test-panel')
        })

        test('returns undefined for non-existent panel', () => {
            const state = panelManager.getPanelState('nonexistent')
            expect(state).toBeUndefined()
        })
    })

    test.describe('getPanelsAtPosition', () => {
        test('returns empty array when no panels at position', () => {
            const panels = panelManager.getPanelsAtPosition(PANEL_POSITION.LEFT)
            expect(panels).toEqual([])
        })

        test('returns panels at specified position', () => {
            const config1 = createMockPanelConfig({ id: 'left-1', position: PANEL_POSITION.LEFT })
            const config2 = createMockPanelConfig({ id: 'left-2', position: PANEL_POSITION.LEFT })
            const config3 = createMockPanelConfig({ id: 'right-1', position: PANEL_POSITION.RIGHT })

            panelManager.registerPanel(config1)
            panelManager.registerPanel(config2)
            panelManager.registerPanel(config3)

            const leftPanels = panelManager.getPanelsAtPosition(PANEL_POSITION.LEFT)
            expect(leftPanels.length).toBe(2)
            expect(leftPanels.map(p => p.id)).toContain('left-1')
            expect(leftPanels.map(p => p.id)).toContain('left-2')
        })

        test('returns panels sorted by priority (lowest first)', () => {
            const config1 = createMockPanelConfig({ id: 'panel-1', priority: 5 })
            const config2 = createMockPanelConfig({ id: 'panel-2', priority: 1 })
            const config3 = createMockPanelConfig({ id: 'panel-3', priority: 3 })

            panelManager.registerPanel(config1)
            panelManager.registerPanel(config2)
            panelManager.registerPanel(config3)

            const panels = panelManager.getPanelsAtPosition(PANEL_POSITION.LEFT)
            expect(panels[0].id).toBe('panel-2')
            expect(panels[1].id).toBe('panel-3')
            expect(panels[2].id).toBe('panel-1')
        })

        test('sorts float panels (no priority) after prioritized panels instead of producing NaN order', () => {
            // Float panels legitimately omit priority (see DashboardConfigValidator).
            // `undefined - number` is NaN, and Array.prototype.sort treats a NaN
            // comparator result as "leave order unchanged" - this must not happen.
            const floatConfig = createMockPanelConfig({ id: 'float-panel', priority: undefined })
            const prioritized = createMockPanelConfig({ id: 'prioritized-panel', priority: 2 })

            panelManager.registerPanel(floatConfig)
            panelManager.registerPanel(prioritized)

            const panels = panelManager.getPanelsAtPosition(PANEL_POSITION.LEFT)
            expect(panels.map(p => p.id)).toEqual(['prioritized-panel', 'float-panel'])
        })
    })

    test.describe('getAllPanelsByPriority', () => {
        test('returns empty array when no panels registered', () => {
            const panels = panelManager.getAllPanelsByPriority()
            expect(panels).toEqual([])
        })

        test('returns all panels sorted by priority', () => {
            const config1 = createMockPanelConfig({ id: 'top', position: PANEL_POSITION.TOP, priority: 0 })
            const config2 = createMockPanelConfig({ id: 'right', position: PANEL_POSITION.RIGHT, priority: 1 })
            const config3 = createMockPanelConfig({ id: 'bottom', position: PANEL_POSITION.BOTTOM, priority: 2 })
            const config4 = createMockPanelConfig({ id: 'left', position: PANEL_POSITION.LEFT, priority: 3 })

            panelManager.registerPanel(config3)
            panelManager.registerPanel(config1)
            panelManager.registerPanel(config4)
            panelManager.registerPanel(config2)

            const panels = panelManager.getAllPanelsByPriority()
            expect(panels.length).toBe(4)
            expect(panels[0].id).toBe('top')
            expect(panels[1].id).toBe('right')
            expect(panels[2].id).toBe('bottom')
            expect(panels[3].id).toBe('left')
        })

        test('sorts float panels (no priority) after prioritized panels', () => {
            const edge = createMockPanelConfig({ id: 'edge', position: PANEL_POSITION.TOP, priority: 0 })
            const float = createMockPanelConfig({
                id: 'float',
                position: PANEL_POSITION.FLOAT_TOP_LEFT,
                priority: undefined,
            })

            panelManager.registerPanel(float)
            panelManager.registerPanel(edge)

            const panels = panelManager.getAllPanelsByPriority()
            expect(panels.map(p => p.id)).toEqual(['edge', 'float'])
        })
    })

    test.describe('isToolCompatible', () => {
        test.beforeEach(() => {
            const config = createMockPanelConfig({
                capabilities: {
                    supportedOrientation: TOOL_ORIENTATION.VERTICAL,
                },
            })
            panelManager.registerPanel(config)
        })

        test('returns true for compatible orientation', () => {
            const tool = createMockToolMetadata({
                requiredOrientation: TOOL_ORIENTATION.VERTICAL,
            })

            expect(panelManager.isToolCompatible('test-panel', tool)).toBe(true)
        })

        test('returns true when tool accepts any orientation', () => {
            const tool = createMockToolMetadata({
                requiredOrientation: TOOL_ORIENTATION.ANY,
            })

            expect(panelManager.isToolCompatible('test-panel', tool)).toBe(true)
        })

        test('returns true when panel accepts any orientation', () => {
            const config = createMockPanelConfig({
                id: 'any-panel',
                capabilities: {
                    supportedOrientation: TOOL_ORIENTATION.ANY,
                },
            })
            panelManager.registerPanel(config)

            const tool = createMockToolMetadata({
                requiredOrientation: TOOL_ORIENTATION.HORIZONTAL,
            })

            expect(panelManager.isToolCompatible('any-panel', tool)).toBe(true)
        })

        test('returns false for incompatible orientation', () => {
            const tool = createMockToolMetadata({
                requiredOrientation: TOOL_ORIENTATION.HORIZONTAL,
            })

            expect(panelManager.isToolCompatible('test-panel', tool)).toBe(false)
        })

        test('returns true when tool compatible with panel position', () => {
            const tool = createMockToolMetadata({
                compatiblePositions: [PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT],
            })

            expect(panelManager.isToolCompatible('test-panel', tool)).toBe(true)
        })

        test('returns false when tool incompatible with panel position', () => {
            const tool = createMockToolMetadata({
                compatiblePositions: [PANEL_POSITION.TOP, PANEL_POSITION.BOTTOM],
            })

            expect(panelManager.isToolCompatible('test-panel', tool)).toBe(false)
        })

        test('returns true when tool has no position constraints', () => {
            const tool = createMockToolMetadata({
                compatiblePositions: undefined,
            })

            expect(panelManager.isToolCompatible('test-panel', tool)).toBe(true)
        })

        test('returns false when panel does not exist', () => {
            const tool = createMockToolMetadata()

            expect(panelManager.isToolCompatible('nonexistent', tool)).toBe(false)
        })
    })
})
