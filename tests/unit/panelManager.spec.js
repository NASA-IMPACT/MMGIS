import { test, expect } from '@playwright/test'
import { PanelManager } from '../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_POSITION, PANEL_STATE, PANEL_LAYOUT_TYPE } from '../../src/essence/Basics/PanelManager_/types/layout.ts'
import { TOOL_ORIENTATION } from '../../src/essence/Basics/ToolController_/types/tool.ts'

/**
 * Create a basic mock panel configuration for testing
 */
function createMockPanelConfig(overrides = {}) {
    return {
        id: 'test-panel',
        position: PANEL_POSITION.LEFT,
        priority: 0,
        layoutType: PANEL_LAYOUT_TYPE.STACKED,
        stateConstraints: {
            allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
            defaultState: PANEL_STATE.EXPANDED,
        },
        capabilities: {
            supportedOrientation: TOOL_ORIENTATION.VERTICAL,
        },
        ...overrides,
    }
}

/**
 * Create a mock tool metadata for testing
 */
function createMockToolMetadata(overrides = {}) {
    return {
        id: 'test-tool',
        name: 'Test Tool',
        requiredOrientation: TOOL_ORIENTATION.VERTICAL,
        ...overrides,
    }
}

/**
 * Mock window.dispatchEvent for testing layout changes
 */
function mockWindowDispatchEvent() {
    const events = []

    // Ensure global window object exists
    if (typeof global.window === 'undefined') {
        global.window = {}
    }

    const originalDispatchEvent = global.window.dispatchEvent

    global.window.dispatchEvent = (event) => {
        events.push(event)
        return true
    }

    return {
        events,
        restore: () => {
            if (originalDispatchEvent) {
                global.window.dispatchEvent = originalDispatchEvent
            } else {
                delete global.window.dispatchEvent
            }
        },
    }
}

test.describe('PanelManager', () => {
    let panelManager

    test.beforeEach(() => {
        // Ensure window is available in the test environment
        if (typeof global.window === 'undefined') {
            global.window = {
                dispatchEvent: () => true,
                CustomEvent: class CustomEvent {
                    constructor(type, options) {
                        this.type = type
                        this.detail = options?.detail
                    }
                },
            }
        }

        // Make window available globally without the global prefix
        if (typeof window === 'undefined') {
            globalThis.window = global.window
        }

        // Create a fresh instance for each test to avoid state pollution
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

        test('initializes empty tools array', () => {
            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            const state = panelManager.getPanelState('test-panel')
            expect(state.tools).toEqual([])
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

        test('triggers layout recalculation after registration', () => {
            const mock = mockWindowDispatchEvent()
            const config = createMockPanelConfig()

            panelManager.registerPanel(config)

            expect(mock.events.length).toBe(1)
            expect(mock.events[0].type).toBe('mmgis-panel-layout-changed')
            mock.restore()
        })
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
            expect(state.tools).toContain('test-tool')
        })

        test('stores tool instance when provided', () => {
            const toolMetadata = createMockToolMetadata()
            const toolInstance = { someMethod: () => {} }

            panelManager.addToolToPanel('test-panel', toolMetadata, toolInstance)

            const state = panelManager.getPanelState('test-panel')
            expect(state.toolInstances['test-tool']).toBe(toolInstance)
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
            expect(state.tools.length).toBe(3)
        })
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
            const mock = mockWindowDispatchEvent()

            panelManager.setPanelState('test-panel', PANEL_STATE.COLLAPSED)

            expect(mock.events.length).toBeGreaterThan(0)
            expect(mock.events[mock.events.length - 1].type).toBe('mmgis-panel-layout-changed')
            mock.restore()
        })

        test('throws when panel not found', () => {
            expect(() => panelManager.setPanelState('nonexistent', PANEL_STATE.COLLAPSED)).toThrow(
                'Panel with ID nonexistent not found'
            )
        })

        test('throws when state transition not allowed', () => {
            const config = createMockPanelConfig({
                id: 'restricted-panel',
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.EXPANDED,
                },
            })
            panelManager.registerPanel(config)

            expect(() => panelManager.setPanelState('restricted-panel', PANEL_STATE.ICONIFIED)).toThrow(
                'State transition to iconified is not allowed for panel restricted-panel'
            )
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

        test('sets active tool when in expanded state', () => {
            panelManager.setPanelState('test-panel', PANEL_STATE.EXPANDED)

            panelManager.focusTool('test-panel', 'test-tool')

            const state = panelManager.getPanelState('test-panel')
            expect(state.activeToolId).toBe('test-tool')
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
            const mock = mockWindowDispatchEvent()

            panelManager.focusTool('test-panel', 'test-tool')

            expect(mock.events.length).toBeGreaterThan(0)
            mock.restore()
        })
    })

    test.describe('togglePanelCollapsed', () => {
        test('collapses panel when currently expanded', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.EXPANDED,
                },
            })
            panelManager.registerPanel(config)

            panelManager.togglePanelCollapsed('test-panel')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.COLLAPSED)
        })

        test('expands panel to default state when currently collapsed', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.EXPANDED,
                },
            })
            panelManager.registerPanel(config)

            panelManager.setPanelState('test-panel', PANEL_STATE.COLLAPSED)
            panelManager.togglePanelCollapsed('test-panel')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.EXPANDED)
        })

        test('expands to first available state when default is collapsed', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.ICONIFIED, PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.COLLAPSED,
                },
            })
            panelManager.registerPanel(config)

            panelManager.togglePanelCollapsed('test-panel')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.EXPANDED)
        })

        test('does nothing when panel not found', () => {
            expect(() => panelManager.togglePanelCollapsed('nonexistent')).not.toThrow()
        })

        test('does nothing when collapse not allowed', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.EXPANDED],
                    defaultState: PANEL_STATE.EXPANDED,
                },
            })
            panelManager.registerPanel(config)

            panelManager.togglePanelCollapsed('test-panel')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.EXPANDED)
        })

        test('collapses from iconified state', () => {
            const config = createMockPanelConfig({
                stateConstraints: {
                    allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.ICONIFIED],
                    defaultState: PANEL_STATE.ICONIFIED,
                },
            })
            panelManager.registerPanel(config)

            panelManager.togglePanelCollapsed('test-panel')

            const state = panelManager.getPanelState('test-panel')
            expect(state.state).toBe(PANEL_STATE.COLLAPSED)
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

        test('returns false when panel is at max capacity', () => {
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

        test('returns false when panel does not exist', () => {
            const tool = createMockToolMetadata()

            expect(panelManager.isToolCompatible('nonexistent', tool)).toBe(false)
        })
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

        test('does nothing when panel not found', () => {
            expect(() => panelManager.resizePanel('nonexistent', 300)).not.toThrow()
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

    test.describe('recalculateLayout', () => {
        test('dispatches custom event with panel data', () => {
            const mock = mockWindowDispatchEvent()

            const config = createMockPanelConfig()
            panelManager.registerPanel(config)

            // recalculateLayout is called during registration, clear previous events
            mock.events.length = 0

            panelManager.recalculateLayout()

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
            panelManager.recalculateLayout()

            const event = mock.events[0]
            expect(event.detail.panels[0].id).toBe('panel-2')
            expect(event.detail.panels[1].id).toBe('panel-3')
            expect(event.detail.panels[2].id).toBe('panel-1')
            mock.restore()
        })
    })
})
