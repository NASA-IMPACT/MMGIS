// Where colour ramps come from.
//
// A source answers two questions: which ramps it has (and which of them it
// publishes reversed), and what one ramp's 256 colours are, forward or
// reversed. Every consumer reaches ramps through the resolver
// (colormapResolver), which picks a layer's sources, so a source of another
// kind — a ramp written into a mission's config, a static catalogue, another
// service — is added by registering it there, with no consumer changed.
//
// Two sources are built in: a layer's tiling service, and the standard ramps
// bundled with the app.

import type { ColormapTable } from './colormapTable'
import { getBaseColormapName, isReversedColormap } from './colormapNaming'
import {
    STANDARD_COLORMAP_NAMES,
    UNREVERSED_STANDARD_COLORMAPS,
    getStandardColormapTable,
} from './standardColormaps'
import {
    fetchColormapList,
    fetchColormapTable,
    peekColormapTable,
} from './titilerColormaps'

/** One ramp a source offers, by its forward name. */
export type ColormapRamp = {
    name: string
    /** Whether the source publishes this ramp reversed (`{name}_r`). */
    reversible: boolean
}

export interface ColormapSource {
    /**
     * Identifies what this source serves. Two sources with the same id serve
     * the same tables, so the id is safe to cache a painted table under.
     */
    readonly id: string
    /** The ramps on offer, or null when the source cannot say right now. */
    list(): Promise<ColormapRamp[] | null>
    /**
     * One ramp's table, `name` being its forward name matched without regard
     * to case; reversed as the source publishes it when `reversed` is set.
     * Null when the source does not have it or cannot provide it. Never
     * rejects.
     */
    getTable(name: string, reversed: boolean): Promise<ColormapTable | null>
    /**
     * What getTable would answer now, without waiting or asking anyone: the
     * table, null when the source does not have it, or undefined when that is
     * not yet known.
     */
    peekTable(name: string, reversed: boolean): ColormapTable | null | undefined
}

/**
 * The ramps behind a list of names as a tiling service spells them, where a
 * ramp's reversed form is listed as a name of its own (`viridis_r`). A `_r`
 * name whose forward form is not listed is a ramp in its own right.
 */
export const rampsFromNames = (names: string[]): ColormapRamp[] => {
    const listed = new Set(names.map((name) => name.toLowerCase()))
    return names
        .filter(
            (name) =>
                !isReversedColormap(name) ||
                !listed.has(getBaseColormapName(name).toLowerCase())
        )
        .map((name) => ({
            name,
            reversible: listed.has(`${name.toLowerCase()}_r`),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

const reversedName = (name: string, reversed: boolean): string =>
    reversed ? `${name}_r` : name

/**
 * The standard ramps bundled with the app. Always available, so it is what
 * every layer falls back to. A reversed ramp is the forward table mirrored,
 * which stands in for a service's own `_r` table only when no service can be
 * asked.
 */
export const bundleSource: ColormapSource = {
    id: 'bundle',
    list: async () =>
        STANDARD_COLORMAP_NAMES.map((name) => ({
            name,
            reversible: !UNREVERSED_STANDARD_COLORMAPS.has(name),
        })),
    getTable: async (name, reversed) => getStandardColormapTable(name, reversed),
    peekTable: (name, reversed) => getStandardColormapTable(name, reversed),
}

const serviceSources = new Map<string, ColormapSource>()

/**
 * A tiling service's ramps: the standard ones plus whatever the deployment
 * defines. A reversed ramp is the service's own `_r` table.
 */
export const serviceSource = (serviceUrl: string): ColormapSource => {
    const baseUrl = serviceUrl.replace(/\/$/, '')
    let source = serviceSources.get(baseUrl)
    if (!source) {
        source = {
            id: `service:${baseUrl}`,
            list: async () => {
                const names = await fetchColormapList(baseUrl)
                return names ? rampsFromNames(names) : null
            },
            getTable: (name, reversed) =>
                fetchColormapTable(reversedName(name, reversed), baseUrl),
            peekTable: (name, reversed) =>
                peekColormapTable(reversedName(name, reversed), baseUrl),
        }
        serviceSources.set(baseUrl, source)
    }
    return source
}
