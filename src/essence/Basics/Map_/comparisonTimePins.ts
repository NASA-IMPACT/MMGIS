/**
 * Per-layer deck prop overrides that redraw a layer at a pinned time window.
 *
 * Comparison draws each side into its own rendering surface by cloning the
 * live deck layers. A clone carries its source verbatim, so both sides show the
 * same instant unless something replaces the prop the layer reads its data
 * from. This module derives that prop: it shallow-clones a layer's config with
 * the pinned times in place and runs it back through the tile-URL pipeline that
 * built the original.
 *
 * The clone is the point. `L_.layers.data[id]` is what the live map renders
 * from, and writing pinned times onto it would drag the primary view to the
 * pinned date too.
 *
 * Being synchronous and config-only parts ways with core twice, deliberately.
 * TimeControl.reloadLayer substitutes placeholders only for `global` and
 * `requery` layers, while a pinned side reads every layer at the one window it
 * names, `local` included. And `variables.urlReplacements` entries with
 * `on: 'timeChange'` need a fetch to resolve, so a layer using them keeps its
 * raw `{key}` on the pinned side.
 */
import L_ from '../Layers_/Layers_'
import {
    buildTileUrlOptions,
    compileTileUrl,
    formatLayerTime,
    shouldUseDeckRaster,
} from '../Layers_/tileUrlUtils'
import {
    resolveTileLayerSource,
    resolveDeckCOGFileUrl,
} from '../Layers_/tileLayerSource'
import { MAP_ENGINE, toCanonicalLayerType } from '../MapEngines/types/engine'

/** The window one comparison side pins its layers to. */
export type TimePin = {
    /** ISO instant the window opens at. */
    start: string
    /** ISO instant the window closes at — the date the side is showing. */
    end: string
}

/** Deck props to override on a layer, keyed by MMGIS layer id. */
export type LayerPropPatches = Record<string, Record<string, unknown>>

/**
 * The window a side pins to when the user picks `instant`.
 *
 * Mirrors how core derives layer time from global time: the start is shared
 * with the global timeline and only the closing instant moves, which is what
 * makes the two sides differ by date alone. That start is read once, at pin
 * time, so moving the timeline's bounds afterwards needs a re-pin; moving its
 * instant leaves a pinned side alone, which is what pinning means.
 */
export function pinWindowFor(instant: string): TimePin {
    // The window collapses onto `instant` — zero-width, read as "this moment" —
    // when TimeControl_ has no usable start yet, and when the pinned instant is
    // older than that start, which would otherwise open the window after it
    // closes and leave every consumer reading a backwards interval.
    const globalStart = L_.TimeControl_?.getStartTime?.()
    const usable =
        typeof globalStart === 'string' &&
        globalStart !== '' &&
        !isAfter(globalStart, instant)
    return { start: usable ? (globalStart as string) : instant, end: instant }
}

/** True when `a` is a later instant than `b`; false if either fails to parse. */
function isAfter(a: string, b: string): boolean {
    const ta = Date.parse(a)
    const tb = Date.parse(b)
    if (Number.isNaN(ta) || Number.isNaN(tb)) return false
    return ta > tb
}

/**
 * The deck prop patch each of `layerIds` needs to draw at `pin`.
 *
 * A layer is absent from the result when its source carries no time — an
 * untimed layer, or a kind whose data is fetched rather than templated (vector
 * GeoJSON) — in which case it draws the same on both sides.
 */
export function buildTimePinnedProps(
    layerIds: string[],
    pin: TimePin,
): LayerPropPatches {
    const patches: LayerPropPatches = {}
    for (const id of layerIds) {
        const layerObj = L_.layers?.data?.[id]
        if (!layerObj || layerObj.time?.enabled !== true) continue
        const patch = patchFor(layerObj, pin)
        if (patch) patches[id] = patch
    }
    return patches
}

/** The patch for one layer, or null when its source cannot carry a time. */
function patchFor(
    layerObj: Record<string, any>,
    pin: TimePin,
): Record<string, unknown> | null {
    const pinned = withPinnedTime(layerObj, pin)
    switch (toCanonicalLayerType(layerObj.type)) {
        case 'tile': {
            const source = resolveTileLayerSource(pinned)
            if (
                shouldUseDeckRaster(
                    MAP_ENGINE.DECKGL,
                    source.splitColonType,
                    pinned,
                )
            ) {
                return { geotiff: resolveDeckCOGFileUrl(pinned, source) }
            }
            // A WMS layer reads from a WMSImageSource the engine builds out of
            // the service URL, not from a templated tile URL. A string patch
            // would replace it and lose its parameters.
            if (source.tileFormat === 'wms') return null
            return {
                data: compileTileUrl(
                    source.url,
                    buildTileUrlOptions(
                        pinned,
                        source.splitColonType,
                        source.tileFormat,
                    ),
                ),
            }
        }
        case 'vectortile':
            // Only a URL that carried a time placeholder can be pinned through
            // its data prop. Other vectortile sources — a `geodatasets:` layer,
            // whose URL Map_.makeVectorTileLayer rewrites into an API query —
            // would get a patch built from a URL form this module does not
            // produce, blanking the layer on the pinned side. They keep the
            // source the live layer was built with instead.
            return pinned.url === layerObj.url
                ? null
                : { data: L_.getUrl(pinned.type, pinned.url, pinned) }
        default:
            return null
    }
}

/**
 * A shallow copy of the config with the pinned window in place and its time
 * placeholders already substituted in the URL.
 *
 * Substituting here rather than at each call site matches
 * TimeControl.reloadLayer, which rewrites the URL before rebuilding the layer:
 * it substitutes `{starttime}`, `{endtime}` and `{customtime.N}`, and the two
 * must agree or the sides would differ for a reason other than the date.
 *
 * `{time}` is left for the branch that owns it — compileTileUrl resolves it
 * from the window's closing instant on the tile branch, nothing does on the
 * vectortile branch, matching TimeControl on both. compileTileUrl's second
 * pass over the other three finds nothing left to replace.
 */
function withPinnedTime(
    layerObj: Record<string, any>,
    pin: TimePin,
): Record<string, any> {
    const time = { ...(layerObj.time ?? {}), start: pin.start, end: pin.end }
    const format = formatLayerTime(time.format)
    let url = String(layerObj.url ?? '')
        .replace(/{starttime}/g, format(pin.start))
        .replace(/{endtime}/g, format(pin.end))

    const customTimes = time.customTimes?.times
    if (Array.isArray(customTimes)) {
        customTimes.forEach((value: string, i: number) => {
            url = url.replace(new RegExp(`{customtime.${i}}`, 'g'), value)
        })
    }

    return { ...layerObj, url, time }
}
