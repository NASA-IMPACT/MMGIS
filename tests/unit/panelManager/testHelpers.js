import { PANEL_POSITION, PANEL_STATE, PANEL_LAYOUT_TYPE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { TOOL_ORIENTATION } from '../../../src/essence/Basics/ToolController_/types/tool.ts'

/**
 * Create a basic mock panel configuration for testing
 */
export function createMockPanelConfig(overrides = {}) {
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
export function createMockToolMetadata(overrides = {}) {
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
export function mockWindowDispatchEvent() {
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

/**
 * Setup window object for test environment
 */
export function setupWindowEnvironment() {
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
}
