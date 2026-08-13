// Normalizes the rail's own hand-authored themes config. The rail owns what
// it renders (id, label, icon) and the boot-time selection; the panel owns
// each theme's filters. They join on `id`.
//
// Same failure posture as the panel's normalizeConfig: admins write this JSON
// by hand, so realistic typos degrade to a loud warning and a rail that still
// renders, never a crash.

import type { ThemeIcon, ThemeSummary } from './types'

const TAG = '[LayerFilterThemes]'

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** A config value only when it's a non-empty string. */
function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * A bare `icon` string, from configs written before the icon gained a source.
 * Anything carrying a path or scheme is a file; the rest is an MDI name.
 */
function legacyIcon(value: string): ThemeIcon {
    return /[/.]|^data:/i.test(value)
        ? { kind: 'image', src: value }
        : { kind: 'mdi', name: value }
}

/**
 * Which icon a theme entry carries.
 *
 * `iconSource` says which of the three inputs the author filled in; when it
 * names one that was left empty, or is missing entirely, the first input that
 * does hold something wins. That keeps a half-finished row rendering the icon
 * it visibly has rather than nothing at all.
 */
function resolveIcon(entry: Record<string, unknown>, index: number): ThemeIcon | undefined {
    const upload = text(entry.iconUpload)
    const url = text(entry.iconUrl)
    const mdi = text(entry.iconMdi)
    const source = text(entry.iconSource)

    if (source === 'upload' && upload) return { kind: 'image', src: upload }
    if (source === 'link' && url) return { kind: 'image', src: url }
    if (source === 'mdi' && mdi) return { kind: 'mdi', name: mdi }

    if (upload) return { kind: 'image', src: upload }
    if (url) return { kind: 'image', src: url }
    if (mdi) return { kind: 'mdi', name: mdi }

    const legacy = text(entry.icon)
    if (legacy) return legacyIcon(legacy)

    if (source) {
        console.warn(
            `${TAG} config error: themes[${index}] selects icon source "${source}" but that field is empty — the entry renders without an icon`,
        )
    }
    return undefined
}

/** Always returns a safe ThemeSummary[]; every dropped/coerced shape warns. */
export function normalizeRailThemes(raw: unknown): ThemeSummary[] {
    if (raw == null) return []
    if (!Array.isArray(raw)) {
        console.warn(
            `${TAG} config error: \`themes\` must be an array, got ${typeof raw} — the rail will render empty until the config is fixed`,
        )
        return []
    }

    const themes: ThemeSummary[] = []
    const seen = new Set<string>()

    raw.forEach((entry, i) => {
        if (!isRecord(entry)) {
            console.warn(`${TAG} config error: themes[${i}] is not an object — dropped`)
            return
        }
        // `id` is the join key to the panel's theme config and the payload the
        // rail broadcasts — an entry without one can only misbehave.
        if (typeof entry.id !== 'string' || entry.id === '') {
            console.warn(`${TAG} config error: themes[${i}] has no string \`id\` — dropped`)
            return
        }
        if (seen.has(entry.id)) {
            console.warn(
                `${TAG} config error: themes[${i}] repeats id "${entry.id}" — dropped (first one wins)`,
            )
            return
        }
        seen.add(entry.id)

        const theme: ThemeSummary = {
            id: entry.id,
            // An unlabelled tab is unclickable in practice; the id is a worse
            // label than the author intended but better than a blank button.
            label:
                typeof entry.label === 'string' && entry.label !== ''
                    ? entry.label
                    : entry.id,
        }
        const icon = resolveIcon(entry, i)
        if (icon) theme.icon = icon
        themes.push(theme)
    })

    return themes
}

/** The theme id to select on load: the configured default when it exists,
 *  else the first theme (warning when a configured default matches nothing —
 *  the silent alternative is a rail whose selection matches no panel). */
export function resolveInitialThemeId(
    themes: ThemeSummary[],
    configured: unknown,
): string | null {
    if (themes.length === 0) return null
    if (typeof configured === 'string' && configured !== '') {
        if (themes.some((t) => t.id === configured)) return configured
        console.warn(
            `${TAG} config error: defaultThemeId "${configured}" matches no theme — falling back to "${themes[0].id}"`,
        )
    }
    return themes[0].id
}
