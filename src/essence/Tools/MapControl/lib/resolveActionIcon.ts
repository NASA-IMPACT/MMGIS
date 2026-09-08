// Turns the action button's icon config — an author's choice between an
// uploaded file, a link to one, and a named icon-font glyph — into the single
// value the bar draws from.
//
// Same failure posture as the rest of the bar's config reading: an admin writes
// this JSON by hand through the Configure page, so a half-finished or mistyped
// entry degrades to a loud warning and a button without an icon, never to a
// throw.

import type { ActionIcon } from './types'

const TAG = '[MapControl]'

/**
 * The icon fields as they sit in a mission's tool variables. Every one is
 * optional and every one is text: `source` names which of the three inputs the
 * author filled in, and the other three carry the inputs themselves.
 */
export type ActionIconConfig = {
    source?: string
    upload?: string
    url?: string
    mdi?: string
}

/** A field counts as filled only when it holds non-blank text. */
function text(value: string | undefined): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
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

    if (source) {
        console.warn(
            `${TAG} config error: the action button selects icon source "${source}" but every icon field is empty — the button renders without an icon`
        )
    }
    return null
}

/**
 * The icon the bar should draw, or null for a button that gets none.
 *
 * `toIconClass` turns an icon name into the class attribute to put on the
 * element. It is passed in rather than imported because the accepted spellings
 * and the stylesheet that backs them belong to the host, not to this library.
 */
export function resolveActionIcon(
    config: ActionIconConfig,
    toIconClass: (name: string) => string | null
): ActionIcon | null {
    const picked = pick(config)
    if (!picked) return null
    if ('image' in picked) return { kind: 'image', src: picked.image }

    const className = toIconClass(picked.name)
    if (!className) {
        console.warn(
            `${TAG} config error: the action button's icon name "${picked.name}" matches no icon the host can draw — the button renders without an icon`
        )
        return null
    }
    return { kind: 'mdi', className }
}
