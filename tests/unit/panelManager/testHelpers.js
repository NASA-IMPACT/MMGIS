import { PANEL_POSITION, PANEL_STATE, PANEL_LAYOUT_TYPE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { TOOL_ORIENTATION } from '../../../src/essence/Basics/ToolController_/types/tool.ts'
import { mmgisAPI } from '../../../src/essence/mmgisAPI/mmgisAPI'
import { onTestFinished } from 'vitest'

const LAYOUT_CHANGED_EVENT = 'panels:changed'

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
 * Capture panel change notifications fired over the in-app event bus.
 *
 * PanelManager_ broadcasts via mmgisAPI.emit (mitt). This subscribes to that
 * bus and collects each notification, normalizing to the shape the panel specs
 * assert on:
 *   { type: 'panels:changed', detail: { panels } }
 */
export function mockLayoutChangedEvents() {
    const events = []

    const handler = (payload) => {
        events.push({
            type: LAYOUT_CHANGED_EVENT,
            detail: payload,
        })
    }

    mmgisAPI.on(LAYOUT_CHANGED_EVENT, handler)
    // Auto-unsubscribe when the current test ends, so a forgotten restore()
    // cannot leak this handler onto the shared singleton bus.
    onTestFinished(() => mmgisAPI.off(LAYOUT_CHANGED_EVENT, handler))

    return {
        events,
        restore: () => {
            mmgisAPI.off(LAYOUT_CHANGED_EVENT, handler)
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
