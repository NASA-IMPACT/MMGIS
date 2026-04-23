import { test, expect } from '@playwright/test'
import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { TOOL_ORIENTATION } from '../../../src/essence/Basics/PanelManager_/types/tool.ts'
import { createMockPanelConfig, createMockToolMetadata, mockWindowDispatchEvent, setupWindowEnvironment } from './testHelpers.js'

test.describe('PanelManager - Tool Management', () => {
    let panelManager

    test.beforeEach(() => {
        setupWindowEnvironment()
        panelManager = new PanelManager()
    })

    test.describe('addToolToPanel', () => {
        test.beforeEach(() => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)
        })

        test('adds a compatible tool to panel', () => {
            const toolMetadata = createMockToolMetadata()
            panelManager.addToolToPanel('test-panel', toolMetadata)

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools.has('test-tool')).toBe(true)
        })

        test('stores tool metadata', () => {
            const toolMetadata = createMockToolMetadata()

            panelManager.addToolToPanel('test-panel', toolMetadata)

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools.get('test-tool')).toBe(toolMetadata)
        })

        test('sets active tool when adding first tool to focused panel', () => {
            // Set panel to focused state first
            const config = createMockPanelConfig({
                id: 'focused-panel',
                stateConstraints: {
                    allowedStates: [PANEL_STATE.FOCUSED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.FOCUSED,
                },
            })
            panelManager.registerPanel(config)

            const toolMetadata = createMockToolMetadata()
            panelManager.addToolToPanel('focused-panel', toolMetadata)

            const state = panelManager.getPanelState('focused-panel')
            expect(state.activeToolId).toBe('test-tool')
        })

        test('does not set active tool when panel is not focused', () => {
            const toolMetadata = createMockToolMetadata()
            panelManager.addToolToPanel('test-panel', toolMetadata)

            const state = panelManager.getPanelState('test-panel')
            expect(state.activeToolId).toBeUndefined()
        })

        test('throws when panel not found', () => {
            const toolMetadata = createMockToolMetadata()

            expect(() => panelManager.addToolToPanel('nonexistent', toolMetadata)).toThrow(
                'Panel with ID nonexistent not found'
            )
        })

        test('throws when tool is incompatible', () => {
            const toolMetadata = createMockToolMetadata({
                requiredOrientation: TOOL_ORIENTATION.HORIZONTAL,
            })

            expect(() => panelManager.addToolToPanel('test-panel', toolMetadata)).toThrow(
                'Tool test-tool is not compatible with panel test-panel'
            )
        })

        test('throws when panel is at max capacity', () => {
            const config = createMockPanelConfig({
                id: 'limited-panel',
                capabilities: {
                    supportedOrientation: TOOL_ORIENTATION.VERTICAL,
                    maxTools: 1,
                },
            })
            panelManager.registerPanel(config)

            const tool1 = createMockToolMetadata({ id: 'tool-1' })
            const tool2 = createMockToolMetadata({ id: 'tool-2' })

            panelManager.addToolToPanel('limited-panel', tool1)

            expect(() => panelManager.addToolToPanel('limited-panel', tool2)).toThrow(
                'Panel limited-panel is at maximum capacity (1)'
            )
        })

        test('allows multiple tools when no max capacity set', () => {
            const tool1 = createMockToolMetadata({ id: 'tool-1' })
            const tool2 = createMockToolMetadata({ id: 'tool-2' })
            const tool3 = createMockToolMetadata({ id: 'tool-3' })

            panelManager.addToolToPanel('test-panel', tool1)
            panelManager.addToolToPanel('test-panel', tool2)
            panelManager.addToolToPanel('test-panel', tool3)

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools.size).toBe(3)
        })
    })

    test.describe('removeToolFromPanel', () => {
        test.beforeEach(() => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)
        })

        test('removes a tool from panel', () => {
            const toolMetadata = createMockToolMetadata()
            panelManager.addToolToPanel('test-panel', toolMetadata)

            panelManager.removeToolFromPanel('test-panel', 'test-tool')

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools.has('test-tool')).toBe(false)
            expect(state.tools.size).toBe(0)
        })

        test('removes tool metadata when it exists', () => {
            const toolMetadata = createMockToolMetadata()

            panelManager.addToolToPanel('test-panel', toolMetadata)
            panelManager.removeToolFromPanel('test-panel', 'test-tool')

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools.has('test-tool')).toBe(false)
        })

        test('sets activeToolId to first remaining tool when active tool is removed', () => {
            const tool1 = createMockToolMetadata({ id: 'tool-1' })
            const tool2 = createMockToolMetadata({ id: 'tool-2' })
            const tool3 = createMockToolMetadata({ id: 'tool-3' })

            panelManager.addToolToPanel('test-panel', tool1)
            panelManager.addToolToPanel('test-panel', tool2)
            panelManager.addToolToPanel('test-panel', tool3)

            // Manually set active tool
            const panel = panelManager.getPanelState('test-panel')
            panel.activeToolId = 'tool-2'

            panelManager.removeToolFromPanel('test-panel', 'tool-2')

            const state = panelManager.getPanelState('test-panel')
            expect(state.activeToolId).toBe('tool-1')
        })

        test('sets activeToolId to undefined when last tool is removed', () => {
            const toolMetadata = createMockToolMetadata()
            panelManager.addToolToPanel('test-panel', toolMetadata)

            const panel = panelManager.getPanelState('test-panel')
            panel.activeToolId = 'test-tool'

            panelManager.removeToolFromPanel('test-panel', 'test-tool')

            const state = panelManager.getPanelState('test-panel')
            expect(state.activeToolId).toBeUndefined()
        })

        test('does not change activeToolId when removing non-active tool', () => {
            const tool1 = createMockToolMetadata({ id: 'tool-1' })
            const tool2 = createMockToolMetadata({ id: 'tool-2' })

            panelManager.addToolToPanel('test-panel', tool1)
            panelManager.addToolToPanel('test-panel', tool2)

            const panel = panelManager.getPanelState('test-panel')
            panel.activeToolId = 'tool-1'

            panelManager.removeToolFromPanel('test-panel', 'tool-2')

            const state = panelManager.getPanelState('test-panel')
            expect(state.activeToolId).toBe('tool-1')
        })

        test('throws when panel not found', () => {
            expect(() => panelManager.removeToolFromPanel('nonexistent', 'test-tool')).toThrow(
                'Panel with ID nonexistent not found'
            )
        })

        test('throws when tool not found in panel', () => {
            expect(() => panelManager.removeToolFromPanel('test-panel', 'nonexistent-tool')).toThrow(
                'Tool nonexistent-tool not found in panel test-panel'
            )
        })

        test('triggers layout recalculation after removal', () => {
            const toolMetadata = createMockToolMetadata()
            panelManager.addToolToPanel('test-panel', toolMetadata)

            const mock = mockWindowDispatchEvent()

            panelManager.removeToolFromPanel('test-panel', 'test-tool')

            expect(mock.events.length).toBeGreaterThan(0)
            expect(mock.events[mock.events.length - 1].type).toBe('mmgis-panel-layout-changed')
            mock.restore()
        })

        test('allows removing multiple tools sequentially', () => {
            const tool1 = createMockToolMetadata({ id: 'tool-1' })
            const tool2 = createMockToolMetadata({ id: 'tool-2' })
            const tool3 = createMockToolMetadata({ id: 'tool-3' })

            panelManager.addToolToPanel('test-panel', tool1)
            panelManager.addToolToPanel('test-panel', tool2)
            panelManager.addToolToPanel('test-panel', tool3)

            panelManager.removeToolFromPanel('test-panel', 'tool-1')
            panelManager.removeToolFromPanel('test-panel', 'tool-3')

            const state = panelManager.getPanelState('test-panel')
            expect(Array.from(state.tools.keys())).toEqual(['tool-2'])
        })
    })

    test.describe('getToolsForPanel', () => {
        test.beforeEach(() => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)
        })

        test('returns array of tool metadata', () => {
            const tool1 = createMockToolMetadata({ id: 'tool-1', name: 'Tool 1' })
            const tool2 = createMockToolMetadata({ id: 'tool-2', name: 'Tool 2' })

            panelManager.addToolToPanel('test-panel', tool1)
            panelManager.addToolToPanel('test-panel', tool2)

            const tools = panelManager.getToolsForPanel('test-panel')
            expect(tools).toHaveLength(2)
            expect(tools[0]).toBe(tool1)
            expect(tools[1]).toBe(tool2)
        })

        test('returns empty array when panel has no tools', () => {
            const tools = panelManager.getToolsForPanel('test-panel')
            expect(tools).toEqual([])
        })

        test('returns empty array when panel not found', () => {
            const tools = panelManager.getToolsForPanel('nonexistent')
            expect(tools).toEqual([])
        })
    })
})
