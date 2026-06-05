/**
 * Dashboard Configuration Factory
 *
 * Provides preset dashboard configurations for common use cases.
 * These configs are validated by DashboardConfigValidator before use.
 */

import { PANEL_POSITION, PANEL_STATE, PANEL_LAYOUT_TYPE } from './types/layout'

/**
 * Gets a default dashboard config for common use cases.
 * Useful for testing or as a starting point.
 *
 * @param {string} preset - Preset name ('default', 'minimal', 'full')
 * @returns {Object} - Dashboard config object
 */
export function getDefaultDashboardConfig(preset = 'default') {
    const presets = {
        default: {
            panelSettings: {
                layoutStyle: 'overlay',
                panels: [
                    {
                        id: 'left-panel',
                        position: PANEL_POSITION.LEFT,
                        priority: 0,
                        layoutType: PANEL_LAYOUT_TYPE.STACKED,
                        stateConstraints: {
                            allowedStates: [
                                PANEL_STATE.COLLAPSED,
                                PANEL_STATE.ICONIFIED,
                                PANEL_STATE.EXPANDED
                            ],
                            defaultState: PANEL_STATE.ICONIFIED
                        },
                        capabilities: {
                            supportedOrientation: 'vertical',
                            resizable: true,
                            minSize: 200,
                            maxSize: 600
                        },
                        dimensions: {
                            iconifiedSize: 40,
                            expandedSize: 350
                        }
                    }
                ]
            },
            tools: []
        },
        minimal: {
            panelSettings: {
                layoutStyle: 'overlay',
                panels: [
                    {
                        id: 'main-panel',
                        position: PANEL_POSITION.LEFT,
                        priority: 0,
                        layoutType: PANEL_LAYOUT_TYPE.TABBED,
                        stateConstraints: {
                            allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                            defaultState: PANEL_STATE.EXPANDED
                        },
                        capabilities: {
                            supportedOrientation: 'any'
                        }
                    }
                ]
            },
            tools: []
        },
        full: {
            panelSettings: {
                layoutStyle: 'overlay',
                panels: [
                    {
                        id: 'top-panel',
                        position: PANEL_POSITION.TOP,
                        priority: 0,
                        layoutType: PANEL_LAYOUT_TYPE.STACKED,
                        stateConstraints: {
                            allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                            defaultState: PANEL_STATE.COLLAPSED
                        },
                        capabilities: {
                            supportedOrientation: 'horizontal'
                        },
                        dimensions: {
                            expandedSize: 60
                        }
                    },
                    {
                        id: 'left-panel',
                        position: PANEL_POSITION.LEFT,
                        priority: 1,
                        layoutType: PANEL_LAYOUT_TYPE.STACKED,
                        stateConstraints: {
                            allowedStates: [
                                PANEL_STATE.COLLAPSED,
                                PANEL_STATE.ICONIFIED,
                                PANEL_STATE.FOCUSED,
                                PANEL_STATE.EXPANDED
                            ],
                            defaultState: PANEL_STATE.ICONIFIED
                        },
                        capabilities: {
                            supportedOrientation: 'vertical',
                            resizable: true,
                            minSize: 250,
                            maxSize: 700
                        },
                        dimensions: {
                            iconifiedSize: 40,
                            expandedSize: 400
                        }
                    },
                    {
                        id: 'right-panel',
                        position: PANEL_POSITION.RIGHT,
                        priority: 2,
                        layoutType: PANEL_LAYOUT_TYPE.TABBED,
                        stateConstraints: {
                            allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                            defaultState: PANEL_STATE.COLLAPSED
                        },
                        capabilities: {
                            supportedOrientation: 'vertical',
                            resizable: true,
                            minSize: 200,
                            maxSize: 500
                        },
                        dimensions: {
                            expandedSize: 300
                        }
                    },
                    {
                        id: 'bottom-panel',
                        position: PANEL_POSITION.BOTTOM,
                        priority: 3,
                        layoutType: PANEL_LAYOUT_TYPE.STACKED,
                        stateConstraints: {
                            allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED],
                            defaultState: PANEL_STATE.COLLAPSED
                        },
                        capabilities: {
                            supportedOrientation: 'horizontal'
                        },
                        dimensions: {
                            expandedSize: 200
                        }
                    }
                ]
            },
            tools: []
        }
    }

    return presets[preset] || presets.default
}
