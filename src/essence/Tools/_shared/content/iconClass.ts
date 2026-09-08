/**
 * Icon classes for plugins.
 *
 * Core owns the spellings a config author is allowed to write, the rules that
 * turn each one into a CSS class, and the icon stylesheet those classes name. A
 * plugin hands over whatever the mission JSON held and renders the class it
 * gets back, so no plugin carries its own copy of the prefixing rules.
 *
 * Markup and the characters a class attribute cannot hold are stripped, but
 * spaces survive — they have to, since 'mdi mdi-poll' and 'fas fa-home' are
 * accepted spellings. A value like 'mdi mdi-poll some-other-class' therefore
 * reaches the element with the extra class intact. Mission config is
 * admin-authored and the worst outcome is a differently-styled glyph, so this
 * is a fidelity limit, not a security boundary.
 *
 * A synchronous import rather than an mmgisAPI request: resolving an icon is a
 * pure string transform, and putting it on the bus would make every caller
 * await a promise before it could draw a button.
 *
 * An unusable value resolves to null rather than to a stand-in icon, so a
 * caller can still tell "no icon" from "some icon" and decide for itself what
 * an icon's absence means for its layout.
 */
import {
    normalizeIconClass,
    sanitizeValue,
} from '../../../Basics/ToolController_/ToolMetadataUtils'

/**
 * Resolve a configured icon into the class to put on an element, or null when
 * the value names no icon core can render.
 *
 * The accepted spellings are core's: a full class ('mdi mdi-poll'), the mdi/js
 * export name ('mdiPoll'), the bare class ('mdi-poll'), the icon name alone
 * ('poll'), or another library's class ('fas fa-home').
 */
export function resolveIconClass(iconClass: string): string | null {
    // Strip markup and anything a class attribute cannot hold before core
    // matches the value against the spellings it knows.
    const sanitized = sanitizeValue(iconClass, 'class')
    if (!sanitized) return null

    return normalizeIconClass(sanitized).normalized || null
}
