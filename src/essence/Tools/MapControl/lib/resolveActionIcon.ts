// Turns the action button's icon config into the single value the bar draws
// from. A half-finished or mistyped entry warns and yields no icon; it never
// throws.

import type { ActionIcon } from './types'

const TAG = '[MapControl]'

/** The icon fields as they sit in a mission's tool variables: optional text. */
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
 * Which configured input supplies the icon: the one `source` names, or — when
 * that one is empty or `source` is unset — the first input holding anything.
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
 * `toIconClass` maps an icon name to the class attribute for it; the host owns
 * which spellings that accepts.
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
