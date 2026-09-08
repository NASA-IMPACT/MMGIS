// Turns the action button's icon config — an author's choice between an
// uploaded file, a link to one, and a named icon-font glyph — into the single
// value the bar draws from.
//
// Same failure posture as the rest of the bar's config reading: an admin writes
// this JSON by hand through the Configure page, so a half-finished or mistyped
// entry degrades to a button without an icon, never to a throw.

import type { ActionIcon } from './types'

/**
 * The icon fields as they sit in a mission's tool variables. Every one is
 * optional and every one is text: the source names which of the three inputs
 * the author filled in, and `legacy` is the single-field form a mission
 * configured before the source existed.
 */
export type ActionIconConfig = {
    source?: string
    upload?: string
    url?: string
    mdi?: string
    legacy?: string
}

/** A field counts as filled only when it holds non-blank text. */
function text(value: string | undefined): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * A bare icon string — the single-field form, which said nothing about where
 * the icon came from. Anything holding a path or a scheme is a file; the rest
 * is an icon-font name, which is what that field was documented to take.
 */
function legacyKind(value: string): { image: string } | { name: string } {
    return /[/.]|^data:/i.test(value) ? { image: value } : { name: value }
}

/**
 * Which of the configured inputs supplies the icon.
 *
 * `source` says which one the author meant; when it names an input that was
 * left empty, or is missing entirely, the first input that does hold something
 * wins. That keeps a half-finished configuration drawing the icon it visibly
 * has rather than nothing at all.
 */
function pick(
    config: ActionIconConfig
): { image: string } | { name: string } | null {
    const upload = text(config.upload)
    const url = text(config.url)
    const mdi = text(config.mdi)
    const source = text(config.source)

    if (source === 'upload' && upload) return { image: upload }
    if (source === 'link' && url) return { image: url }
    if (source === 'mdi' && mdi) return { name: mdi }

    if (upload) return { image: upload }
    if (url) return { image: url }
    if (mdi) return { name: mdi }

    const legacy = text(config.legacy)
    if (legacy) return legacyKind(legacy)

    return null
}

/**
 * The icon the bar should draw, or null for a button that gets none — which is
 * also what tells the bar it may not shrink the button to a glyph, since there
 * would be nothing left to identify the action by.
 *
 * `toIconClass` turns an icon name into the class attribute to put on the
 * element. It is passed in rather than imported because the accepted spellings
 * and the stylesheet that backs them belong to the host, not to this library;
 * a name the host makes nothing of reads as no icon, so an unusable value and
 * an unconfigured one leave the button in the same state.
 */
export function resolveActionIcon(
    config: ActionIconConfig,
    toIconClass: (name: string) => string | null
): ActionIcon | null {
    const picked = pick(config)
    if (!picked) return null
    if ('image' in picked) return { kind: 'image', src: picked.image }

    const className = toIconClass(picked.name)
    return className ? { kind: 'mdi', className } : null
}
