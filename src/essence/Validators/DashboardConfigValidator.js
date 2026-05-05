/**
 * Dashboard Configuration Validator
 *
 * Validates modern interface configurations against the PanelManager schema.
 * This ensures configs are well-formed before being passed to PanelManager.
 */

/**
 * @typedef {import('../types/dashboard').MissionConfig} MissionConfig
 * @typedef {import('../types/dashboard').PanelConfig} PanelConfig
 * @typedef {import('../types/dashboard').ToolConfig} ToolConfig
 * @typedef {import('../types/dashboard').ValidationResult} ValidationResult
 */

import { PANEL_POSITION, PANEL_STATE, PANEL_LAYOUT_TYPE } from '../Basics/PanelManager_/types/layout'
import { TOOL_ORIENTATION } from '../Basics/ToolController_/types/tool'
import { VALID_MODES, VALID_LAYOUT_STYLES } from '../types/dashboard'

// Extract valid values from TypeScript constants
const VALID_POSITIONS = Object.values(PANEL_POSITION)
const VALID_STATES = Object.values(PANEL_STATE)
const VALID_LAYOUT_TYPES = Object.values(PANEL_LAYOUT_TYPE)
const VALID_ORIENTATIONS = Object.values(TOOL_ORIENTATION)

/**
 * Validates a complete modern interface configuration object.
 *
 * Expects structure:
 * {
 *   panelSettings: {
 *     panels: [...],
 *     layoutStyle: 'overlay' | 'compact'
 *   },
 *   tools: [...]
 * }
 *
 * @param {MissionConfig} config - The complete mission config to validate
 * @returns {ValidationResult} - { valid: boolean, errors: string[] }
 */
export function validateModernConfig(config) {
    const errors = []

    if (!config || typeof config !== 'object') {
        errors.push('Config must be an object')
        return { valid: false, errors }
    }

    // Validate panelSettings
    if (!config.panelSettings || typeof config.panelSettings !== 'object') {
        errors.push('Config must have a "panelSettings" object')
        return { valid: false, errors }
    }

    const panelSettings = config.panelSettings

    // Validate panels array
    if (!panelSettings.panels || !Array.isArray(panelSettings.panels)) {
        errors.push('panelSettings must have a "panels" array')
        return { valid: false, errors }
    }

    if (panelSettings.panels.length === 0) {
        errors.push('panelSettings must have at least one panel')
    }

    // Validate layoutStyle (optional, defaults to 'overlay')
    if (panelSettings.layoutStyle && !VALID_LAYOUT_STYLES.includes(panelSettings.layoutStyle)) {
        errors.push(
            `panelSettings.layoutStyle must be one of: ${VALID_LAYOUT_STYLES.join(', ')}`
        )
    }

    // Validate each panel
    const panelIds = new Set()
    panelSettings.panels.forEach((panel, index) => {
        const panelErrors = validatePanelConfig(panel, index)
        errors.push(...panelErrors)

        // Check for duplicate panel IDs
        if (panel.id) {
            if (panelIds.has(panel.id)) {
                errors.push(`Duplicate panel ID: "${panel.id}"`)
            }
            panelIds.add(panel.id)
        }
    })

    // Validate tools array (optional)
    if (config.tools && !Array.isArray(config.tools)) {
        errors.push('Config "tools" must be an array')
    }

    // Validate tools reference valid panels
    if (config.tools && Array.isArray(config.tools)) {
        config.tools.forEach((tool, index) => {
            if (!tool || typeof tool !== 'object') {
                errors.push(`Tool[${index}] must be an object`)
                return
            }

            if (!tool.name || typeof tool.name !== 'string') {
                errors.push(`Tool[${index}] must have a string "name"`)
            }

            if (!tool.js || typeof tool.js !== 'string') {
                errors.push(`Tool[${index}] must have a string "js"`)
            }
        })
    }

    return {
        valid: errors.length === 0,
        errors
    }
}

/**
 * Validates a legacy dashboard configuration object (for backwards compatibility).
 *
 * Expects structure:
 * {
 *   mode?: 'classic' | 'modern',
 *   panels: [...],
 *   layoutStyle?: 'overlay' | 'compact',
 *   toolPanelMapping?: {...}
 * }
 *
 * @param {Object} dashboardConfig - The dashboard config to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validateDashboardConfig(dashboardConfig) {
    const errors = []

    if (!dashboardConfig || typeof dashboardConfig !== 'object') {
        errors.push('Dashboard config must be an object')
        return { valid: false, errors }
    }

    // Validate mode (optional, defaults to 'classic')
    if (dashboardConfig.mode && !VALID_MODES.includes(dashboardConfig.mode)) {
        errors.push(
            `Dashboard config "mode" must be one of: ${VALID_MODES.join(', ')}`
        )
    }

    // Validate panels array
    if (!dashboardConfig.panels || !Array.isArray(dashboardConfig.panels)) {
        errors.push('Dashboard config must have a "panels" array')
        return { valid: false, errors }
    }

    if (dashboardConfig.panels.length === 0) {
        errors.push('Dashboard config must have at least one panel')
    }

    // Validate layoutStyle (optional, defaults to 'overlay')
    if (dashboardConfig.layoutStyle && !VALID_LAYOUT_STYLES.includes(dashboardConfig.layoutStyle)) {
        errors.push(
            `Dashboard config "layoutStyle" must be one of: ${VALID_LAYOUT_STYLES.join(', ')}`
        )
    }

    // Validate each panel
    const panelIds = new Set()
    dashboardConfig.panels.forEach((panel, index) => {
        const panelErrors = validatePanelConfig(panel, index)
        errors.push(...panelErrors)

        // Check for duplicate panel IDs
        if (panel.id) {
            if (panelIds.has(panel.id)) {
                errors.push(`Duplicate panel ID: "${panel.id}"`)
            }
            panelIds.add(panel.id)
        }
    })

    return {
        valid: errors.length === 0,
        errors
    }
}

/**
 * Validates a single panel configuration object.
 *
 * @param {PanelConfig} panel - The panel config to validate
 * @param {number} index - Index in the panels array (for error messages)
 * @returns {string[]} - Array of error messages
 */
function validatePanelConfig(panel, index) {
    const errors = []
    const prefix = `Panel[${index}]`

    if (!panel || typeof panel !== 'object') {
        errors.push(`${prefix}: Must be an object`)
        return errors
    }

    // Required fields
    if (!panel.id || typeof panel.id !== 'string') {
        errors.push(`${prefix}: Must have a string "id"`)
    } else {
        // Validate ID format (alphanumeric, hyphens, underscores only)
        if (!/^[a-zA-Z0-9_-]+$/.test(panel.id)) {
            errors.push(`${prefix}: ID "${panel.id}" must contain only alphanumeric characters, hyphens, and underscores`)
        }
    }

    if (!panel.position || !VALID_POSITIONS.includes(panel.position)) {
        errors.push(
            `${prefix}: Must have a valid "position" (${VALID_POSITIONS.join(', ')})`
        )
    }

    if (typeof panel.priority !== 'number') {
        errors.push(`${prefix}: Must have a numeric "priority"`)
    } else if (panel.priority < 0) {
        errors.push(`${prefix}: "priority" must be non-negative`)
    }

    if (!panel.layoutType || !VALID_LAYOUT_TYPES.includes(panel.layoutType)) {
        errors.push(
            `${prefix}: Must have a valid "layoutType" (${VALID_LAYOUT_TYPES.join(', ')})`
        )
    }

    if (panel.hasHeader !== undefined && typeof panel.hasHeader !== 'boolean') {
        errors.push(`${prefix}: "hasHeader" must be a boolean`)
    }

    // Validate stateConstraints
    if (!panel.stateConstraints || typeof panel.stateConstraints !== 'object') {
        errors.push(`${prefix}: Must have a "stateConstraints" object`)
    } else {
        const sc = panel.stateConstraints

        if (!Array.isArray(sc.allowedStates) || sc.allowedStates.length === 0) {
            errors.push(`${prefix}.stateConstraints: Must have non-empty "allowedStates" array`)
        } else {
            // Check all allowed states are valid
            sc.allowedStates.forEach(state => {
                if (!VALID_STATES.includes(state)) {
                    errors.push(
                        `${prefix}.stateConstraints: Invalid state "${state}" (must be one of ${VALID_STATES.join(', ')})`
                    )
                }
            })
        }

        if (!sc.defaultState || !VALID_STATES.includes(sc.defaultState)) {
            errors.push(
                `${prefix}.stateConstraints: Must have a valid "defaultState" (${VALID_STATES.join(', ')})`
            )
        } else if (sc.allowedStates && !sc.allowedStates.includes(sc.defaultState)) {
            errors.push(
                `${prefix}.stateConstraints: "defaultState" must be in "allowedStates"`
            )
        }
    }

    // Validate optional capabilities
    if (panel.capabilities) {
        const cap = panel.capabilities

        if (cap.supportedOrientation && !VALID_ORIENTATIONS.includes(cap.supportedOrientation)) {
            errors.push(
                `${prefix}.capabilities: Invalid "supportedOrientation" (must be one of ${VALID_ORIENTATIONS.join(', ')})`
            )
        }

        if (cap.maxTools !== undefined && (typeof cap.maxTools !== 'number' || cap.maxTools < 1)) {
            errors.push(`${prefix}.capabilities: "maxTools" must be a positive number`)
        }

        if (cap.resizable !== undefined && typeof cap.resizable !== 'boolean') {
            errors.push(`${prefix}.capabilities: "resizable" must be a boolean`)
        }

        if (cap.minSize !== undefined && typeof cap.minSize !== 'number') {
            errors.push(`${prefix}.capabilities: "minSize" must be a number`)
        }

        if (cap.maxSize !== undefined && typeof cap.maxSize !== 'number') {
            errors.push(`${prefix}.capabilities: "maxSize" must be a number`)
        }

        if (cap.minSize !== undefined && cap.maxSize !== undefined && cap.minSize > cap.maxSize) {
            errors.push(`${prefix}.capabilities: "minSize" cannot be greater than "maxSize"`)
        }
    }

    // Validate optional dimensions
    if (panel.dimensions) {
        const dim = panel.dimensions

        if (dim.iconifiedSize !== undefined && typeof dim.iconifiedSize !== 'number') {
            errors.push(`${prefix}.dimensions: "iconifiedSize" must be a number`)
        }

        // expandedSize can be number, 'content', or object
        if (dim.expandedSize !== undefined) {
            if (
                typeof dim.expandedSize !== 'number' &&
                dim.expandedSize !== 'content' &&
                (typeof dim.expandedSize !== 'object' || dim.expandedSize === null)
            ) {
                errors.push(
                    `${prefix}.dimensions: "expandedSize" must be a number, "content", or object with min/max`
                )
            }
        }
    }

    return errors
}

/**
 * Sanitizes a string for safe use in HTML/URLs.
 * Removes potentially dangerous characters.
 *
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
export function sanitizeText(text) {
    if (typeof text !== 'string') return ''
    return String(text).replace(/[<>'"]/g, '')
}
