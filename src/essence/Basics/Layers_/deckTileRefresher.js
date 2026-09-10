import { compileTileUrl } from './tileUrlUtils'

/**
 * How a plain deck.gl raster tile layer recomputes itself, for
 * `IMapEngine.setLayerRefresher`.
 *
 * A deck tile layer takes one static URL, so the per-tile params Leaflet adds
 * in getTileUrl have to be baked in on every refresh too. That belongs on the
 * domain side rather than in the adapter: compileTileUrl is not generic — it
 * branches on MMGIS service prefixes (stac-collection, COG, titiler-url) and
 * injects COG fields, none of which an adapter may know.
 *
 * Returning nothing leaves the engine holding the instance it already has.
 *
 * @param {object} layer - The deck.gl layer the engine currently holds.
 * @param {object} ctx - `{ url, tileOptions, force }` from the engine.
 * @returns {object | undefined} The replacement layer, or nothing to keep the
 *   one held.
 */
export function refreshDeckTileLayer(layer, ctx = {}) {
    // No source URL, or one that compiles to nothing: return nothing so the
    // engine keeps the instance it holds. Handing deck an empty url would
    // blank the layer.
    if (ctx.url == null) return
    const compiled = compileTileUrl(ctx.url, ctx.tileOptions ?? {})
    if (!compiled) return

    // A time step that lands inside the same layer's current time bucket
    // compiles to the URL the layer is already serving. Cloning anyway hands
    // deck.gl a data change, which evicts the whole tileset and refetches
    // every visible tile to draw exactly what is on screen — and aborts the
    // in-flight ones, which the tile service has already started answering.
    // `force` is the caller saying the bytes behind the URL may have changed
    // (a requery, a nocache), so it reloads regardless.
    if (ctx.force !== true && compiled === layer.props.data) return

    return layer.clone({ data: compiled })
}
