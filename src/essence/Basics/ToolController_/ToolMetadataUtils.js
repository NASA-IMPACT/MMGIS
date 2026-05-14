/**
 * Tool Metadata Validation and Sanitization Utilities
 */

import DOMPurify from 'dompurify'
import { TOOL_ORIENTATION } from './types/tool'
import { PANEL_POSITION } from '../PanelManager_/types/layout'
import { createLogger } from '../Logger_/Logger_'

const logger = createLogger('ToolMetadataUtils')


/**
 * Sanitizes a string value using DOMPurify to prevent XSS attacks
 * Falls back to regex-based sanitization if DOMPurify is unavailable
 * @param {string} value - The value to sanitize
 * @param {string} type - The type of value ('id', 'class', or 'text')
 * @returns {string} Sanitized value
 */
export function sanitizeValue(value, type = 'text') {
    if (!value || typeof value !== 'string') {
        return ''
    }

    let sanitized

    // Use DOMPurify if available
    if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
        sanitized = DOMPurify.sanitize(value, {
            ALLOWED_TAGS: [], // Strip all HTML tags
            ALLOWED_ATTR: [], // Strip all attributes
            KEEP_CONTENT: true // Keep text content
        }).trim()
    } else {
        // Remove HTML tags and trim
        sanitized = value.replace(/<[^>]*>/g, '').trim()
    }

    // Additional type-specific sanitization (defense-in-depth)
    switch (type) {
        case 'id':
            // IDs should only contain alphanumeric, hyphen, underscore
            return sanitized.replace(/[^a-zA-Z0-9_-]/g, '')
        case 'class':
            // CSS classes should only contain alphanumeric, hyphen, underscore, space
            return sanitized.replace(/[^a-zA-Z0-9_\s-]/g, '')
        case 'text':
        default:
            return sanitized
    }
}

/**
 * Sanitizes and validates numeric values
 * Protects against invalid values (NaN, Infinity), extreme values, and type coercion issues
 *
 * @param {*} value - Value to sanitize (will be coerced to number)
 * @param {Object} options - Validation options
 * @param {number} [options.min=0] - Minimum allowed value
 * @param {number} [options.max=Number.MAX_SAFE_INTEGER] - Maximum allowed value
 * @param {number} [options.defaultValue=0] - Default value for invalid inputs
 * @param {boolean} [options.allowFloat=false] - Whether to allow floating point numbers
 * @returns {number} Sanitized number within bounds
 */
export function sanitizeNumber(value, options = {}) {
    const {
        min = 0,
        max = Number.MAX_SAFE_INTEGER,
        defaultValue = 0,
        allowFloat = false
    } = options

    // Parse to number
    const num = Number(value)

    // Check for invalid numbers (NaN, Infinity, -Infinity)
    if (!Number.isFinite(num)) {
        logger.warn(`Invalid number value: ${value}, using default: ${defaultValue}`)
        return defaultValue
    }

    // Clamp to bounds
    const clamped = Math.max(min, Math.min(max, num))

    // Round if integers only
    return allowFloat ? clamped : Math.round(clamped)
}

/**
 * Sanitizes an enum value against a list of valid values
 * @param {*} value - Value to sanitize
 * @param {Array} validValues - Array of valid enum values
 * @param {*} defaultValue - Default value if invalid
 * @param {string} fieldName - Field name for logging
 * @param {string} toolId - Tool ID for logging
 * @returns {*} Sanitized enum value
 */
export function sanitizeEnum(value, validValues, defaultValue, fieldName, toolId) {
    if (value === undefined || value === null) {
        return defaultValue
    }

    if (!validValues.includes(value)) {
        logger.warn(
            `Invalid ${fieldName} for tool "${toolId}": "${value}". Valid values: ${validValues.join(', ')}. Using default: ${defaultValue}`
        )
        return defaultValue
    }

    return value
}

/**
 * Sanitizes an array of enum values
 * @param {*} value - Value to sanitize (should be array)
 * @param {Array} validValues - Array of valid enum values
 * @param {Array} defaultValue - Default array if invalid
 * @param {string} fieldName - Field name for logging
 * @param {string} toolId - Tool ID for logging
 * @returns {Array} Sanitized array of enum values
 */
export function sanitizeEnumArray(value, validValues, defaultValue, fieldName, toolId) {
    if (value === undefined || value === null) {
        return defaultValue
    }

    if (!Array.isArray(value)) {
        logger.warn(`${fieldName} for tool "${toolId}" is not an array, using default`)
        return defaultValue
    }

    // Filter to only valid values
    const sanitized = value.filter(v => validValues.includes(v))

    if (sanitized.length === 0) {
        logger.warn(
            `All ${fieldName} values for tool "${toolId}" were invalid. Valid values: ${validValues.join(', ')}. Using default.`
        )
        return defaultValue
    }

    // Log if some values were filtered out
    if (sanitized.length < value.length) {
        const invalid = value.filter(v => !validValues.includes(v))
        logger.warn(
            `Removed invalid ${fieldName} values for tool "${toolId}": ${invalid.join(', ')}`
        )
    }

    return sanitized
}

/**
 * Sanitizes a boolean value
 * @param {*} value - Value to sanitize
 * @param {boolean} defaultValue - Default value if invalid
 * @param {string} fieldName - Field name for logging
 * @param {string} toolId - Tool ID for logging
 * @returns {boolean} Sanitized boolean value
 */
export function sanitizeBoolean(value, defaultValue, fieldName, toolId) {
    if (value === undefined || value === null) {
        return defaultValue
    }

    if (typeof value === 'boolean') {
        return value
    }

    // Coerce common string values
    if (typeof value === 'string') {
        const lower = value.toLowerCase()
        if (lower === 'true' || lower === '1') return true
        if (lower === 'false' || lower === '0') return false
    }

    // Coerce numbers
    if (typeof value === 'number') {
        return value !== 0
    }

    logger.warn(
        `Invalid boolean value for ${fieldName} on tool "${toolId}": "${value}". Using default: ${defaultValue}`
    )
    return defaultValue
}

/**
 * Sanitizes tool metadata object to prevent XSS attacks
 * Creates a new object with sanitized values for all fields
 *
 * @param {Object} metadata - Tool metadata object to sanitize
 * @returns {Object} Sanitized tool metadata object
 * @throws {Error} If sanitization results in invalid data (e.g., empty id)
 */
export function sanitizeToolMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
        throw new Error('[ToolMetadataUtils] Cannot sanitize: metadata is not an object')
    }

    // Start with empty object - don't spread untrusted metadata
    const sanitized = {}

    // Sanitize critical string fields that are used in DOM
    sanitized.id = sanitizeValue(metadata.id, 'id')
    sanitized.name = sanitizeValue(metadata.name, 'text')
    sanitized.icon = getValidIconClass(metadata.icon, sanitized.id)

    // Verify critical fields didn't become empty
    if (!sanitized.id) {
        throw new Error('[ToolMetadataUtils] Tool ID became empty after sanitization')
    }
    if (!sanitized.name) {
        throw new Error(`[ToolMetadataUtils] Tool name became empty after sanitization (id: ${sanitized.id})`)
    }
    if (!sanitized.icon) {
        logger.warn(`Tool "${sanitized.id}" has empty icon after sanitization, using default`)
        sanitized.icon = 'mdi mdi-cog'
    }

    // Sanitize numeric fields if present
    if (metadata.width !== undefined) {
        sanitized.width = sanitizeNumber(metadata.width, {
            min: 100,
            max: 2000,
            defaultValue: 300
        })
    }

    if (metadata.height !== undefined) {
        sanitized.height = sanitizeNumber(metadata.height, {
            min: 0,
            max: 2000,
            defaultValue: 300
        })
    }

    // Sanitize enum fields
    if (metadata.requiredOrientation !== undefined) {
        const validOrientations = Object.values(TOOL_ORIENTATION)
        sanitized.requiredOrientation = sanitizeEnum(
            metadata.requiredOrientation,
            validOrientations,
            TOOL_ORIENTATION.ANY,
            'requiredOrientation',
            sanitized.id
        )
    }

    if (metadata.preferredPosition !== undefined) {
        const validPositions = Object.values(PANEL_POSITION)
        sanitized.preferredPosition = sanitizeEnum(
            metadata.preferredPosition,
            validPositions,
            PANEL_POSITION.LEFT,
            'preferredPosition',
            sanitized.id
        )
    }

    // Sanitize array fields
    if (metadata.compatiblePositions !== undefined) {
        const validPositions = Object.values(PANEL_POSITION)
        sanitized.compatiblePositions = sanitizeEnumArray(
            metadata.compatiblePositions,
            validPositions,
            [PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT],
            'compatiblePositions',
            sanitized.id
        )
    }

    // Sanitize boolean fields
    if (metadata.separatedTool !== undefined) {
        sanitized.separatedTool = sanitizeBoolean(
            metadata.separatedTool,
            false,
            'separatedTool',
            sanitized.id
        )
    }

    if (metadata.expandable !== undefined) {
        sanitized.expandable = sanitizeBoolean(
            metadata.expandable,
            false,
            'expandable',
            sanitized.id
        )
    }

    if (metadata.modernLayoutSupport !== undefined) {
        sanitized.modernLayoutSupport = sanitizeBoolean(
            metadata.modernLayoutSupport,
            false,
            'modernLayoutSupport',
            sanitized.id
        )
    }

    return sanitized
}

/**
 * Validates tool metadata and logs warnings for invalid configurations
 * Throws errors for missing critical fields (id, name)
 *
 * @param {Object} metadata - Tool metadata object to validate
 * @returns {boolean} True if metadata is completely valid, false if there are warnings
 * @throws {Error} If critical fields are missing
 */
export function validateToolMetadata(metadata) {
    const warnings = []

    // Check required fields
    if (!metadata || typeof metadata !== 'object') {
        throw new Error('[ToolMetadataUtils] Invalid metadata: not an object')
    }

    if (!metadata.id || typeof metadata.id !== 'string') {
        throw new Error('[ToolMetadataUtils] Tool metadata missing required field: id')
    }

    if (!metadata.name || typeof metadata.name !== 'string') {
        throw new Error(`[ToolMetadataUtils] Tool metadata missing required field: name (id: ${metadata.id})`)
    }

    // Validate icon if present
    if (metadata.icon !== undefined && typeof metadata.icon !== 'string') {
        warnings.push('icon must be a string')
    }

    // Validate requiredOrientation
    if (metadata.requiredOrientation !== undefined) {
        const validOrientations = Object.values(TOOL_ORIENTATION)
        if (!validOrientations.includes(metadata.requiredOrientation)) {
            warnings.push(`Invalid requiredOrientation: "${metadata.requiredOrientation}". Must be one of: ${validOrientations.join(', ')}`)
        }
    }

    // Validate compatiblePositions
    if (metadata.compatiblePositions !== undefined) {
        if (!Array.isArray(metadata.compatiblePositions)) {
            warnings.push('compatiblePositions must be an array')
        } else {
            const validPositions = Object.values(PANEL_POSITION)
            const invalidPositions = metadata.compatiblePositions.filter(
                pos => !validPositions.includes(pos)
            )
            if (invalidPositions.length > 0) {
                warnings.push(`Invalid compatiblePositions: ${invalidPositions.join(', ')}. Valid positions: ${validPositions.join(', ')}`)
            }
        }
    }

    // Validate preferredPosition
    if (metadata.preferredPosition !== undefined) {
        const validPositions = Object.values(PANEL_POSITION)
        if (!validPositions.includes(metadata.preferredPosition)) {
            warnings.push(`Invalid preferredPosition: "${metadata.preferredPosition}". Valid positions: ${validPositions.join(', ')}`)
        }

        // Check if preferredPosition is in compatiblePositions
        if (metadata.compatiblePositions &&
            Array.isArray(metadata.compatiblePositions) &&
            !metadata.compatiblePositions.includes(metadata.preferredPosition)) {
            warnings.push(
                `preferredPosition "${metadata.preferredPosition}" not in compatiblePositions [${metadata.compatiblePositions.join(', ')}]`
            )
        }
    }

    // Validate boolean fields
    if (metadata.separatedTool !== undefined && typeof metadata.separatedTool !== 'boolean') {
        warnings.push('separatedTool must be a boolean')
    }

    if (metadata.expandable !== undefined && typeof metadata.expandable !== 'boolean') {
        warnings.push('expandable must be a boolean')
    }

    if (metadata.modernLayoutSupport !== undefined && typeof metadata.modernLayoutSupport !== 'boolean') {
        warnings.push('modernLayoutSupport must be a boolean')
    }

    if (warnings.length > 0) {
        logger.warn(`Tool "${metadata.name || 'Unknown'}" (${metadata.id}) has metadata issues:`, warnings)
    }

    return warnings.length === 0
}

/**
 * Normalizes icon class format to standard format
 * Handles multiple formats: MDI, Font Awesome, plain names, and legacy formats
 *
 * Examples:
 *   "layers" -> "mdi mdi-layers"
 *   "format-list-bulleted-type" -> "mdi mdi-format-list-bulleted-type"
 *   "mdi mdi-map" -> "mdi mdi-map" (already formatted)
 *   "fas fa-home" -> "fas fa-home" (other icon library)
 *   "mdiLayers" -> { normalized: "mdi mdi-layers", wasFixed: true }
 *   "mdi-layers" -> { normalized: "mdi mdi-layers", wasFixed: true }
 *
 * @param {string} iconClass - Icon class name to normalize (must be trimmed)
 * @returns {Object} Result object with { normalized: string, wasFixed: boolean }
 */
export function normalizeIconClass(iconClass) {
    // Already a full MDI class (starts with "mdi mdi-")
    if (iconClass.startsWith('mdi mdi-')) {
        return { normalized: iconClass, wasFixed: false }
    }

    // Another icon library (Font Awesome, etc.)
    if (/^(fas|far|fal|fab|fa|glyphicon)\s+/.test(iconClass)) {
        return { normalized: iconClass, wasFixed: false }
    }

    // Legacy camelCase format: "mdiLayers" -> "mdi mdi-layers"
    // Check this before generic pattern to avoid false matches
    if (/^mdi[A-Z]/.test(iconClass)) {
        const iconName = iconClass
            .substring(3)
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '')
        return { normalized: `mdi mdi-${iconName}`, wasFixed: true, original: iconClass }
    }

    // Legacy format: "mdi-layers" -> "mdi mdi-layers"
    // Check this before generic pattern to avoid double prefix
    if (/^mdi-[a-z0-9-]+$/.test(iconClass)) {
        return { normalized: `mdi ${iconClass}`, wasFixed: true, original: iconClass }
    }

    // Just the icon name (e.g., "layers", "format-list-bulleted-type")
    // Valid icon names: lowercase letters, numbers, and hyphens
    if (/^[a-z0-9-]+$/.test(iconClass)) {
        return { normalized: `mdi mdi-${iconClass}`, wasFixed: false }
    }

    // Unknown format - return null to signal invalid
    return { normalized: null, wasFixed: false }
}

/**
 * Validates and sanitizes tool icon class name
 * Automatically adds "mdi mdi-" prefix if user only provides icon name
 * Handles validation, normalization, logging, and fallback to default
 *
 * @param {string} iconClass - Icon class name or just icon name
 * @param {string} toolId - Tool ID for logging purposes
 * @returns {string} Valid icon class name
 */
export function getValidIconClass(iconClass, toolId) {
    const defaultIcon = 'mdi mdi-view-dashboard'

    // Validate input is a non-empty string
    if (!iconClass || typeof iconClass !== 'string' || iconClass.trim() === '') {
        logger.warn(`Invalid icon class for tool "${toolId}", using default`)
        return defaultIcon
    }

    // Sanitize the input to prevent XSS (defense-in-depth)
    const sanitized = sanitizeValue(iconClass, 'class')

    if (!sanitized) {
        logger.warn(`Icon class became empty after sanitization for tool "${toolId}", using default`)
        return defaultIcon
    }

    // Normalize the icon class format
    const result = normalizeIconClass(sanitized)

    // Handle normalization failure
    if (!result.normalized) {
        logger.warn(`Unknown icon format for tool "${toolId}": "${iconClass}", using default`)
        return defaultIcon
    }

    // Log auto-fixes if they occurred
    if (result.wasFixed) {
        logger.warn(`Auto-fixed icon for tool "${toolId}": "${result.original}" -> "${result.normalized}"`)
    }

    return result.normalized
}

/**
 * Generate tool metadata from tool configuration
 * Consolidates metadata from both root-level (legacy) and nested metadata object.
 * Nested metadata takes precedence over root-level for backward compatibility.
 *
 * @param {Object} toolConfig - Tool configuration from toolConfigs.json
 * @returns {Object} Tool metadata object
 */
export function generateToolMetadata(toolConfig) {
    const toolName = toolConfig.name || 'Unknown'
    const toolId = toolConfig.js || toolName.toLowerCase().replace(/\s+/g, '-')

    // Read metadata from nested object (preferred location)
    const declaredMetadata = toolConfig.metadata || {}

    // Build raw metadata, reading from both root (legacy) and nested locations
    // Nested metadata takes precedence
    const rawMetadata = {
        id: toolId,
        name: toolName,
        // Icon can be at root as 'defaultIcon' (legacy) or in metadata as 'icon'
        icon: declaredMetadata.icon || toolConfig.icon || toolConfig.defaultIcon || 'cog',
        // Orientation defaults to ANY if not specified
        requiredOrientation: declaredMetadata.requiredOrientation || TOOL_ORIENTATION.ANY,
    }

    // Add optional layout fields from nested metadata (preferred) or root (legacy)
    if (declaredMetadata.compatiblePositions !== undefined) {
        rawMetadata.compatiblePositions = declaredMetadata.compatiblePositions
    }

    if (declaredMetadata.preferredPosition !== undefined) {
        rawMetadata.preferredPosition = declaredMetadata.preferredPosition
    }

    if (declaredMetadata.modernLayoutSupport !== undefined) {
        rawMetadata.modernLayoutSupport = declaredMetadata.modernLayoutSupport
    }

    if (declaredMetadata.separatedTool !== undefined) {
        rawMetadata.separatedTool = declaredMetadata.separatedTool
    }

    if (declaredMetadata.expandable !== undefined) {
        rawMetadata.expandable = declaredMetadata.expandable
    }

    // Add numeric fields if present
    if (declaredMetadata.width !== undefined || toolConfig.width !== undefined) {
        rawMetadata.width = declaredMetadata.width || toolConfig.width
    }

    if (declaredMetadata.height !== undefined || toolConfig.height !== undefined) {
        rawMetadata.height = declaredMetadata.height || toolConfig.height
    }

    // Validate metadata to catch configuration errors
    validateToolMetadata(rawMetadata)

    // Return completely sanitized object
    return sanitizeToolMetadata(rawMetadata)
}
