// Normalizes the hand-authored themes config at the adapter boundary. Admins
// write this JSON by hand (and Configure's raw editor pre-seeds `{}`, the
// exact wrong shape), so realistic typos — an object where an array belongs,
// a theme without `filters`, a filter without the keys the renderer indexes
// by — must degrade to a loud console warning, never a crashed panel.

import type { ThemeDef, FilterDef } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
}

const TAG = '[LayerFilter]'

/** Always returns a safe ThemeDef[]; every dropped/coerced shape warns. */
export function normalizeThemesConfig(raw: unknown): ThemeDef[] {
    if (raw == null) return []
    if (!Array.isArray(raw)) {
        console.warn(
            `${TAG} config error: \`themes\` must be an array, got ${
                Array.isArray(raw) ? 'array' : typeof raw
            } — the filter will render empty until the config is fixed`,
        )
        return []
    }

    const themes: ThemeDef[] = []
    raw.forEach((entry, i) => {
        if (!isRecord(entry)) {
            console.warn(`${TAG} config error: themes[${i}] is not an object — dropped`)
            return
        }
        if (typeof entry.id !== 'string' || entry.id === '') {
            console.warn(`${TAG} config error: themes[${i}] has no string \`id\` — dropped`)
            return
        }

        let filters = entry.filters
        if (filters == null) {
            filters = []
        } else if (!Array.isArray(filters)) {
            console.warn(
                `${TAG} config error: themes[${i}].filters ("${entry.id}") must be an array — treating as empty`,
            )
            filters = []
        }

        const validFilters = (filters as unknown[]).filter((f, j) => {
            if (!isRecord(f)) {
                console.warn(
                    `${TAG} config error: theme "${entry.id}" filters[${j}] is not an object — dropped`,
                )
                return false
            }
            // `id` keys the options map and the selection state — a filter
            // without one can only misbehave.
            if (typeof f.id !== 'string' || f.id === '') {
                console.warn(
                    `${TAG} config error: theme "${entry.id}" filters[${j}] has no string \`id\` — dropped`,
                )
                return false
            }
            // `property` is required only for property-backed filters —
            // geocode, pick-one-entry and derived filters carry none.
            const propertyless =
                f.type === 'geocode' || f.isEntry === true || f.derived != null
            if (
                !propertyless &&
                (typeof f.property !== 'string' || f.property === '')
            ) {
                console.warn(
                    `${TAG} config error: theme "${entry.id}" filter "${f.id}" has no string \`property\` — dropped`,
                )
                return false
            }
            return true
        }) as FilterDef[]

        themes.push({ ...(entry as unknown as ThemeDef), filters: validFilters })
    })
    return themes
}
