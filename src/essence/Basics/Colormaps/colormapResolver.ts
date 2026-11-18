// The one place that answers, for a layer, which ramps it can use, what one
// ramp's colours are, and whether that ramp can be reversed.
//
// Answers come from the layer's colormap sources (colormapSources), tried in
// order: the source the layer names, or else its tiling service; then the
// bundled standard ramps, which are always there. A renderer, a legend and a
// picker swatch asking about the same layer and ramp therefore get the same
// table from the same source, and a deployment with no tiling service still
// has every bundled ramp.
//
// A source of another kind is added with registerColormapSource and named by
// a layer's colormap setting; nothing that consumes ramps changes.

import { colormapTableToCss, type ColormapTable } from './colormapTable'
import { getBaseColormapName, isReversedColormap } from './colormapNaming'
import {
    bundleSource,
    serviceSource,
    type ColormapRamp,
    type ColormapSource,
} from './colormapSources'
import { FALLBACK_COLORMAP, getStandardColormapTable } from './standardColormaps'

export type { ColormapRamp, ColormapSource } from './colormapSources'

/**
 * How a value finds its colour. `continuous` scales values across min/max onto
 * the ramp; `categorical` uses the raw value as an index into the ramp, with
 * no scaling, as land-cover classes and other coded values need.
 */
export type ColormapMode = 'continuous' | 'categorical'

/** Which ramp to resolve, as a layer's colormap setting names it. */
export type ColormapRequest = {
    /** The ramp. A legacy `_r` suffix reverses it, as `reversed` does. */
    name: string
    reversed?: boolean
    mode?: ColormapMode
    /** A registered source kind; absent means the layer's tiling service. */
    source?: string | null
}

/** What a source factory may read about the layer it serves. */
export type ColormapContext = {
    /** The layer's tiling service, or null when it has none in reach. */
    serviceUrl?: string | null
}

/** Builds a source for a layer, or null when it has nothing for that layer. */
export type ColormapSourceFactory = (
    ctx: ColormapContext
) => ColormapSource | null

/** A ramp resolved to the table that paints it. */
export type ResolvedColormap = {
    table: ColormapTable
    /** The source the table came from. */
    sourceId: string
    /** The forward ramp name actually painted, lowercased. */
    name: string
    reversed: boolean
    /**
     * Identifies the table: equal keys mean identical tables, so a renderer
     * can cache a GPU texture under it and re-render only when it changes.
     */
    key: string
}

export const SERVICE_SOURCE = 'service'
export const BUNDLE_SOURCE = 'bundle'

const factories = new Map<string, ColormapSourceFactory>([
    [
        SERVICE_SOURCE,
        (ctx) => (ctx.serviceUrl ? serviceSource(ctx.serviceUrl) : null),
    ],
    [BUNDLE_SOURCE, () => bundleSource],
])

/**
 * Makes a kind of source available for layers to name. Returns a function
 * that removes it again.
 */
export const registerColormapSource = (
    kind: string,
    factory: ColormapSourceFactory
): (() => void) => {
    factories.set(kind, factory)
    return () => {
        if (factories.get(kind) === factory) factories.delete(kind)
    }
}

const warnedUnknownSource = new Set<string>()

/**
 * The sources a layer's ramps come from, in the order they are asked: the
 * named source, or else the tiling service; then the bundle. A source with
 * nothing for this layer — no service configured, say — is left out, so it is
 * never asked.
 */
export const colormapSourcesFor = (
    source: string | null | undefined,
    ctx: ColormapContext = {}
): ColormapSource[] => {
    const kinds = [source || SERVICE_SOURCE, BUNDLE_SOURCE]
    const sources: ColormapSource[] = []
    for (const kind of kinds) {
        const factory = factories.get(kind)
        if (!factory) {
            if (!warnedUnknownSource.has(kind)) {
                warnedUnknownSource.add(kind)
                console.warn(`Colormap source "${kind}" is not registered.`)
            }
            continue
        }
        const built = factory(ctx)
        if (built && !sources.some((s) => s.id === built.id)) sources.push(built)
    }
    return sources
}

/** The forward name and direction a request asks for. */
const readRequest = (
    request: ColormapRequest
): { name: string; reversed: boolean } => {
    const name = getBaseColormapName(request.name).toLowerCase()
    // A categorical ramp maps codes to colours; reversing it would recolour
    // every class, so it is never reversed.
    if (request.mode === 'categorical') return { name, reversed: false }
    return {
        name,
        reversed: isReversedColormap(request.name) !== Boolean(request.reversed),
    }
}

const resolvedFrom = (
    table: ColormapTable,
    sourceId: string,
    name: string,
    reversed: boolean
): ResolvedColormap => ({
    table,
    sourceId,
    name,
    reversed,
    key: `${sourceId}|${name}${reversed ? '_r' : ''}`,
})

/**
 * What paints when no source has the ramp: the bundled fallback, forward, the
 * same ramp the renderer and legend both use for a name nothing recognizes.
 */
const fallback = (): ResolvedColormap =>
    resolvedFrom(
        getStandardColormapTable(FALLBACK_COLORMAP),
        'fallback',
        FALLBACK_COLORMAP,
        false
    )

/**
 * The table a request paints with: from the first of the layer's sources that
 * has the ramp, else the fallback ramp. Never rejects.
 */
export const resolveColormapTable = async (
    request: ColormapRequest,
    ctx: ColormapContext = {}
): Promise<ResolvedColormap> => {
    const { name, reversed } = readRequest(request)
    if (!name) return fallback()
    for (const source of colormapSourcesFor(request.source, ctx)) {
        let table: ColormapTable | null = null
        try {
            table = await source.getTable(name, reversed)
        } catch (err) {
            // A source is meant to resolve to null; one that throws is
            // treated the same, so a broken source cannot blank a legend.
            console.warn(`Colormap source "${source.id}" failed:`, err)
        }
        if (table) return resolvedFrom(table, source.id, name, reversed)
    }
    return fallback()
}

/**
 * The best table known for a request right now, without waiting. `settled`
 * is false while a source ahead of the one answering has yet to say whether
 * it has the ramp, in which case resolveColormapTable may yet answer
 * differently.
 */
export const peekColormapTable = (
    request: ColormapRequest,
    ctx: ColormapContext = {}
): { resolved: ResolvedColormap; settled: boolean } => {
    const { name, reversed } = readRequest(request)
    if (!name) return { resolved: fallback(), settled: true }
    let settled = true
    for (const source of colormapSourcesFor(request.source, ctx)) {
        const table = source.peekTable(name, reversed)
        if (table === undefined) {
            settled = false
            continue
        }
        if (table) return { resolved: resolvedFrom(table, source.id, name, reversed), settled }
    }
    return { resolved: fallback(), settled }
}

/**
 * Upgrades waiting on a lookup, by the caller's `upgradeKey` plus what is
 * being looked up, so a caller asking again before the answer lands is told
 * once rather than once per ask.
 */
const upgradesInFlight = new Set<string>()

/**
 * The table to paint with right now, for a renderer that cannot wait. When a
 * source that is still loading may change the answer, the lookup is started
 * and `onUpgrade` is called with the final table once it differs from the one
 * returned, so the caller can repaint. The first paint never waits on a
 * service.
 *
 * With an `upgradeKey` (a layer's id, say), asking again while the same
 * lookup is still in flight for that key adds no second `onUpgrade`: the
 * first one stands for all of them.
 */
export const colormapTableNow = (
    request: ColormapRequest,
    ctx: ColormapContext = {},
    onUpgrade?: (resolved: ResolvedColormap) => void,
    upgradeKey?: string
): ResolvedColormap => {
    const { resolved, settled } = peekColormapTable(request, ctx)
    if (settled) return resolved
    const { name, reversed } = readRequest(request)
    const waiting =
        upgradeKey == null
            ? null
            : [
                  upgradeKey,
                  colormapSourcesFor(request.source, ctx)
                      .map((source) => source.id)
                      .join(','),
                  `${name}${reversed ? '_r' : ''}`,
              ].join('|')
    if (waiting != null) {
        if (upgradesInFlight.has(waiting)) return resolved
        upgradesInFlight.add(waiting)
    }
    void resolveColormapTable(request, ctx).then((final) => {
        if (waiting != null) upgradesInFlight.delete(waiting)
        if (final.key !== resolved.key) onUpgrade?.(final)
    })
    return resolved
}

/** One ramp's 256 colours as CSS colours, low end first. Never rejects. */
export const resolveColormapColors = async (
    request: ColormapRequest,
    ctx: ColormapContext = {}
): Promise<string[]> =>
    colormapTableToCss((await resolveColormapTable(request, ctx)).table)

/**
 * The ramps a layer can use: the list of the first of its sources that can
 * give one. The bundle always can, so a missing or unreachable service never
 * leaves a layer with no ramps.
 */
export const listColormaps = async (
    source: string | null | undefined,
    ctx: ColormapContext = {}
): Promise<{ sourceId: string; ramps: ColormapRamp[] }> => {
    for (const candidate of colormapSourcesFor(source, ctx)) {
        let ramps: ColormapRamp[] | null = null
        try {
            ramps = await candidate.list()
        } catch (err) {
            console.warn(`Colormap source "${candidate.id}" failed:`, err)
        }
        if (ramps && ramps.length > 0) return { sourceId: candidate.id, ramps }
    }
    return { sourceId: bundleSource.id, ramps: (await bundleSource.list()) ?? [] }
}

/** The listed ramp a name refers to, matched without regard to case. */
export const findColormapRamp = (
    ramps: ColormapRamp[],
    name: string | null | undefined
): ColormapRamp | null => {
    const exact = (name || '').trim().toLowerCase()
    if (!exact) return null
    // A listed `_r` name is a ramp in its own right only when its forward
    // form is not listed (see rampsFromNames), so an exact match comes first
    // and the forward name of a reversed ramp second.
    const byName = (wanted: string): ColormapRamp | null =>
        ramps.find((ramp) => ramp.name.toLowerCase() === wanted) ?? null
    return byName(exact) ?? byName(getBaseColormapName(exact).toLowerCase())
}

/**
 * Whether `ramp`, found for `name` by findColormapRamp, is the ramp named
 * exactly, `_r` and all, rather than the forward ramp `name` reverses.
 */
export const isExactColormapRamp = (
    ramp: ColormapRamp | null,
    name: string | null | undefined
): boolean =>
    ramp != null && ramp.name.toLowerCase() === (name || '').trim().toLowerCase()

/**
 * Whether a layer's ramp may be offered reversed: only when its source
 * publishes the reversed ramp, and never for a categorical one.
 */
export const isColormapReversible = async (
    request: ColormapRequest,
    ctx: ColormapContext = {}
): Promise<boolean> => {
    if (request.mode === 'categorical') return false
    const { ramps } = await listColormaps(request.source, ctx)
    return findColormapRamp(ramps, request.name)?.reversible === true
}
