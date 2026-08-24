// Normalizes the rail's own hand-authored themes config. The rail owns what
// it renders (id, label, icon) and the boot-time selection; the panel owns
// each theme's filters. They join on `id`.
//
// Same failure posture as the panel's normalizeConfig: admins write this JSON
// by hand, so realistic typos degrade to a loud warning and a rail that still
// renders, never a crash.

import type { ThemeSummary } from './types'

const TAG = '[LayerFilterThemes]'

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
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
        // Anything non-string would render as `mdi-undefined`.
        if (typeof entry.icon === 'string' && entry.icon !== '') {
            theme.icon = entry.icon
        }
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
