/**
 * Icon classes for plugins. Core owns the accepted spellings, the rules that
 * map each one to a CSS class, and the stylesheet those classes name.
 */
import {
    normalizeIconClass,
    sanitizeValue,
} from '../../../Basics/ToolController_/ToolMetadataUtils'

/**
 * The class for a configured icon, or null when the value names none. Accepts
 * 'mdi mdi-poll', 'mdiPoll', 'mdi-poll', 'poll', and 'fas fa-home'.
 */
export function resolveIconClass(iconClass: string): string | null {
    const sanitized = sanitizeValue(iconClass, 'class')
    if (!sanitized) return null

    return normalizeIconClass(sanitized).normalized || null
}
