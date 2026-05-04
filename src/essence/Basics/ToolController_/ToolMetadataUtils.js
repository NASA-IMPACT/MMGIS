/**
 * Tool Metadata Validation Utilities
 */

import { TOOL_ORIENTATION } from './types/tool'
import { PANEL_POSITION } from '../PanelManager_/types/layout'
import { createLogger } from '../Logger_/Logger_'

const logger = createLogger('ToolMetadataUtils')


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
 * Validates and sanitizes tool icon class name
 * Automatically adds "mdi mdi-" prefix if user only provides icon name
 *
 * Examples:
 *   "layers" -> "mdi mdi-layers"
 *   "format-list-bulleted-type" -> "mdi mdi-format-list-bulleted-type"
 *   "mdi mdi-map" -> "mdi mdi-map" (already formatted)
 *   "fas fa-home" -> "fas fa-home" (other icon library)
 *
 * @param {string} iconClass - Icon class name or just icon name
 * @param {string} toolId - Tool ID for logging purposes
 * @returns {string} Valid icon class name
 */
export function getValidIconClass(iconClass, toolId) {
    const defaultIcon = 'mdi mdi-view-dashboard'

    // Check if iconClass is a non-empty string
    if (!iconClass || typeof iconClass !== 'string' || iconClass.trim() === '') {
        if (window.mmgisglobal?.debug) {
            logger.warn(`Invalid icon class for tool "${toolId}", using default`)
        }
        return defaultIcon
    }

    const trimmed = iconClass.trim()

    // Basic validation: should contain only valid CSS class characters
    if (!/^[\w\s-]+$/.test(trimmed)) {
        logger.warn(`Invalid icon class format for tool "${toolId}": "${iconClass}", using default`)
        return defaultIcon
    }

    // If it's already a full MDI class (starts with "mdi mdi-"), pass it through
    if (trimmed.startsWith('mdi mdi-')) {
        return trimmed
    }

    // If it's another icon library (Font Awesome, etc.), pass it through
    if (/^(fas|far|fal|fab|fa|glyphicon)\s+/.test(trimmed)) {
        return trimmed
    }

    // If it's just the icon name (e.g., "layers", "format-list-bulleted-type"), add MDI prefix
    // Valid icon names: lowercase letters, numbers, and hyphens
    if (/^[a-z0-9-]+$/.test(trimmed)) {
        return `mdi mdi-${trimmed}`
    }

    // Handle legacy formats and fix them
    // "mdiLayers" -> "mdi mdi-layers"
    if (/^mdi[A-Z]/.test(trimmed)) {
        const iconName = trimmed
            .substring(3)
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '')
        logger.warn(`Auto-fixed icon for tool "${toolId}": "${iconClass}" -> "mdi mdi-${iconName}"`)
        return `mdi mdi-${iconName}`
    }

    // "mdi-layers" -> "mdi mdi-layers"
    if (/^mdi-[a-z0-9-]+$/.test(trimmed)) {
        logger.warn(`Auto-fixed icon for tool "${toolId}": "${iconClass}" -> "mdi ${trimmed}"`)
        return `mdi ${trimmed}`
    }

    // Anything else that doesn't match expected patterns - use default
    logger.warn(`Unknown icon format for tool "${toolId}": "${iconClass}", using default`)
    return defaultIcon
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

    // Build metadata, reading from both root (legacy) and nested locations
    // Nested metadata takes precedence
    const metadata = {
        id: toolId,
        name: toolName,
        // Icon can be at root as 'defaultIcon' (legacy) or in metadata as 'icon'
        icon: getValidIconClass(
            declaredMetadata.icon || toolConfig.icon || toolConfig.defaultIcon || 'cog',
            toolId
        ),
        // Orientation defaults to ANY if not specified
        requiredOrientation: declaredMetadata.requiredOrientation || TOOL_ORIENTATION.ANY,
    }

    // Add optional layout fields from nested metadata (preferred) or root (legacy)
    if (declaredMetadata.compatiblePositions !== undefined) {
        metadata.compatiblePositions = declaredMetadata.compatiblePositions
    }

    if (declaredMetadata.preferredPosition !== undefined) {
        metadata.preferredPosition = declaredMetadata.preferredPosition
    }

    if (declaredMetadata.modernLayoutSupport !== undefined) {
        metadata.modernLayoutSupport = declaredMetadata.modernLayoutSupport
    }

    // Validate metadata in debug mode
    if (window.mmgisglobal?.debug) {
        validateToolMetadata(metadata)
    }

    return metadata
}
