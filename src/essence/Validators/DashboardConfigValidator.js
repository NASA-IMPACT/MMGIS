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

import { PANEL_POSITION, PANEL_STATE, PANEL_LAYOUT_TYPE, FLOAT_POSITIONS } from '../Basics/PanelManager_/types/layout'
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

    // Validate theme (optional, defaults to 'default')
    if (config.msv && config.msv.theme && typeof config.msv.theme !== 'string') {
        errors.push('msv.theme must be a string')
    }

    // Validate each panel
    // Float positions are tracked across BOTH the regular "panels" array and the
    // "floatingPanels" array so the one-panel-per-float-zone rule can't be bypassed
    // by splitting panels with the same float position across the two arrays.
    const panelIds = new Set()
    const floatPositions = new Set()
    panelSettings.panels.forEach((panel, index) => {
        const panelErrors = validatePanelConfig(panel, index, false)
        errors.push(...panelErrors)

        if (panel.id) {
            if (panelIds.has(panel.id)) {
                errors.push(`Duplicate panel ID: "${panel.id}"`)
            }
            panelIds.add(panel.id)
        }

        // Float positions are honored by the renderer regardless of which array a
        // panel was declared in (modern.js merges "panels" and "floatingPanels"
        // before registration), so dedup must consider this array too.
        if (panel.position && FLOAT_POSITIONS.has(panel.position)) {
            if (floatPositions.has(panel.position)) {
                errors.push(`Duplicate floating panel position: "${panel.position}" — each float zone can only have one panel`)
            }
            floatPositions.add(panel.position)
        }
    })

    // Validate optional floatingPanels array
    if (panelSettings.floatingPanels !== undefined) {
        if (!Array.isArray(panelSettings.floatingPanels)) {
            errors.push('panelSettings.floatingPanels must be an array')
        } else {
            panelSettings.floatingPanels.forEach((panel, index) => {
                const panelErrors = validatePanelConfig(panel, index, true)
                errors.push(...panelErrors)

                if (panel.id) {
                    if (panelIds.has(panel.id)) {
                        errors.push(`Duplicate panel ID: "${panel.id}"`)
                    }
                    panelIds.add(panel.id)
                }

                if (panel.position && FLOAT_POSITIONS.has(panel.position)) {
                    if (floatPositions.has(panel.position)) {
                        errors.push(`Duplicate floating panel position: "${panel.position}" — each float zone can only have one panel`)
                    }
                    floatPositions.add(panel.position)
                }
            })
        }
    }

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
 * Validates a single panel configuration object.
 *
 * @param {PanelConfig} panel - The panel config to validate
 * @param {number} index - Index in the panels array (for error messages)
 * @param {boolean} isFloat - Whether this is a floating panel (relaxes layoutType/priority requirements)
 * @returns {string[]} - Array of error messages
 */
function validatePanelConfig(panel, index, isFloat = false) {
    const errors = []
    const prefix = isFloat ? `FloatingPanel[${index}]` : `Panel[${index}]`

    if (!panel || typeof panel !== 'object') {
        errors.push(`${prefix}: Must be an object`)
        return errors
    }

    // What actually governs float rendering/state-machine behavior at runtime is the
    // panel's position, not which config array it was declared in (modern.js merges
    // "panels" and "floatingPanels" before registration). Use this for checks that
    // must hold regardless of source array.
    const isFloatPosition = !!(panel.position && FLOAT_POSITIONS.has(panel.position))

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
    } else if (isFloat && !FLOAT_POSITIONS.has(panel.position)) {
        errors.push(
            `${prefix}: Floating panel position must be one of the float positions (float-top-left, float-top-center, etc.)`
        )
    }

    // Validate priority - optional for float panels
    if (!isFloat) {
        if (panel.priority === undefined || panel.priority === null) {
            errors.push(`${prefix}: Must have a "priority"`)
        } else {
            const priorityNum = Number(panel.priority)
            if (isNaN(priorityNum)) {
                errors.push(`${prefix}: "priority" must be a valid number (got "${panel.priority}")`)
            } else if (priorityNum < 0) {
                errors.push(`${prefix}: "priority" must be non-negative`)
            }
        }
    } else if (panel.priority !== undefined && panel.priority !== null) {
        const priorityNum = Number(panel.priority)
        if (isNaN(priorityNum) || priorityNum < 0) {
            errors.push(`${prefix}: "priority" must be a non-negative number when provided`)
        }
    }

    // layoutType is required for edge panels, optional for float panels
    if (!isFloat && (!panel.layoutType || !VALID_LAYOUT_TYPES.includes(panel.layoutType))) {
        errors.push(
            `${prefix}: Must have a valid "layoutType" (${VALID_LAYOUT_TYPES.join(', ')})`
        )
    } else if (isFloat && panel.layoutType && !VALID_LAYOUT_TYPES.includes(panel.layoutType)) {
        errors.push(
            `${prefix}: "layoutType" must be one of: ${VALID_LAYOUT_TYPES.join(', ')}`
        )
    }

    if (panel.hasHeader !== undefined && typeof panel.hasHeader !== 'boolean') {
        errors.push(`${prefix}: "hasHeader" must be a boolean`)
    }

    // Transparency only makes sense over the map. Edge panels claim viewport space
    // and, in the compact layout style, have no map behind them at all.
    if (panel.transparent !== undefined && typeof panel.transparent !== 'boolean') {
        errors.push(`${prefix}: "transparent" must be a boolean`)
    } else if (!isFloatPosition && panel.transparent === true) {
        errors.push(`${prefix}: "transparent" is only supported on floating panels`)
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
                } else if (isFloatPosition && state !== PANEL_STATE.COLLAPSED && state !== PANEL_STATE.EXPANDED) {
                    // Float panels only support collapsed/expanded — PanelManager_.setPanelState
                    // throws for float + iconified/focused transitions, so the validator must
                    // reject these here rather than let it become a reachable runtime throw.
                    errors.push(
                        `${prefix}.stateConstraints: Floating panels only support "collapsed" and "expanded" states (got "${state}")`
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

        if (cap.maxTools !== undefined) {
            const maxToolsNum = Number(cap.maxTools)
            if (isNaN(maxToolsNum)) {
                errors.push(`${prefix}.capabilities: "maxTools" must be a valid number (got "${cap.maxTools}")`)
            } else if (maxToolsNum < 1) {
                errors.push(`${prefix}.capabilities: "maxTools" must be a positive number`)
            }
        }

        if (cap.resizable !== undefined && typeof cap.resizable !== 'boolean') {
            errors.push(`${prefix}.capabilities: "resizable" must be a boolean`)
        } else if (isFloatPosition && cap.resizable === true) {
            errors.push(`${prefix}.capabilities: "resizable" is not supported on floating panels`)
        }

        let minSize, maxSize

        if (cap.minSize !== undefined) {
            minSize = Number(cap.minSize)
            if (isNaN(minSize)) {
                errors.push(`${prefix}.capabilities: "minSize" must be a valid number (got "${cap.minSize}")`)
            }
        }

        if (cap.maxSize !== undefined) {
            maxSize = Number(cap.maxSize)
            if (isNaN(maxSize)) {
                errors.push(`${prefix}.capabilities: "maxSize" must be a valid number (got "${cap.maxSize}")`)
            }
        }

        if (minSize !== undefined && maxSize !== undefined && !isNaN(minSize) && !isNaN(maxSize) && minSize > maxSize) {
            errors.push(`${prefix}.capabilities: "minSize" cannot be greater than "maxSize"`)
        }
    }

    // Validate optional dimensions
    if (panel.dimensions) {
        const dim = panel.dimensions

        if (dim.iconifiedSize !== undefined) {
            const iconifiedSize = Number(dim.iconifiedSize)
            if (isNaN(iconifiedSize)) {
                errors.push(`${prefix}.dimensions: "iconifiedSize" must be a valid number (got "${dim.iconifiedSize}")`)
            }
        }

        // expandedSize can be number, 'content', or object
        if (dim.expandedSize !== undefined) {
            if (dim.expandedSize === 'content' || (typeof dim.expandedSize === 'object' && dim.expandedSize !== null)) {
                // Valid: 'content' or object
            } else {
                // Try to convert to number
                const expandedSizeNum = Number(dim.expandedSize)
                if (isNaN(expandedSizeNum)) {
                    errors.push(
                        `${prefix}.dimensions: "expandedSize" must be a valid number, "content", or object with min/max (got "${dim.expandedSize}")`
                    )
                }
            }
        }

        // CSS dimension fields for floating panels (number or CSS string e.g. "50%", "40vh")
        // Empty strings are treated as "not provided" and skipped.
        const cssDimFields = ['defaultWidth', 'defaultHeight', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']
        cssDimFields.forEach(field => {
            const val = dim[field]
            if (val !== undefined && val !== '' && !isValidCssDimension(val)) {
                errors.push(
                    `${prefix}.dimensions: "${field}" must be a number (px), unitless "0", or a CSS string with a unit (px, %, vh, vw, svh, dvh, vmin, vmax, ch, rem, em) — got "${val}"`
                )
            }
        })
    }

    return errors
}

/**
 * Returns true if v is a valid CSS dimension value: a number (treated as px)
 * or a string with a number followed by a recognised CSS unit.
 * @param {*} v
 * @returns {boolean}
 */
function isValidCssDimension(v) {
    if (typeof v === 'number') return true
    if (typeof v === 'string') {
        if (v === '0') return true
        return /^\d+(\.\d+)?(px|%|vh|vw|svh|dvh|vmin|vmax|ch|rem|em)$/.test(v)
    }
    return false
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
