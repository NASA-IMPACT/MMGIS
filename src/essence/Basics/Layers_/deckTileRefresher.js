import { compileTileUrl } from './tileUrlUtils'
import { wmsLayerSource } from '../MapEngines/Adapters/DeckGLHelpers'

/**
 * The tile source a refresh asks for, compiled for deck.gl, or undefined when
 * there is none.
 *
 * A deck tile layer takes one static URL, so the per-tile params Leaflet adds
 * in getTileUrl are baked in here. This lives on the domain side rather than
 * in the adapter because compileTileUrl branches on MMGIS service prefixes
 * (stac-collection, COG, titiler-url) and injects COG fields, none of which an
 * adapter may know.
 *
 * @param {object} ctx - `{ url, tileOptions }` from the engine.
 * @returns {string | undefined}
 */
function compileSource(ctx) {
    if (ctx.url == null) return
    return compileTileUrl(ctx.url, ctx.tileOptions ?? {}) || undefined
}

/**
 * How a plain deck.gl raster tile layer recomputes itself, for
 * `IMapEngine.setLayerRefresher`.
 *
 * Returning nothing leaves the engine holding the instance it already has:
 * handing deck an empty url would blank the layer. Returning a clone with the
 * URL the layer already serves costs nothing - deck.gl's TileLayer compares
 * `data` URLs by value and keeps its tileset when they match.
 *
 * @param {object} layer - The deck.gl layer the engine currently holds.
 * @param {object} ctx - `{ url, tileOptions }` from the engine.
 * @returns {object | undefined} The replacement layer, or nothing to keep the
 *   one held.
 */
export function refreshDeckTileLayer(layer, ctx = {}) {
    const compiled = compileSource(ctx)
    if (!compiled) return
    return layer.clone({ data: compiled })
}

/**
 * The same, for a deck.gl WMS layer. Its `data` is an image source built from
 * the base URL and the query's params, not the URL itself: handed the full
 * URL as a string, deck.gl appends a second query to it.
 *
 * Where the tile layer above can hand deck.gl a URL it already has and be
 * ignored, a source is a new object every time and deck.gl compares `data`
 * objects by identity, so a clone always costs a GetCapabilities and a GetMap
 * - even for the image already drawn. `wmsLayerSource` records the URL it
 * built from in the layer's props, so a refresh that compiles to the same URL
 * keeps the layer instead.
 *
 * @param {object} layer - The deck.gl WMSLayer the engine currently holds.
 * @param {object} ctx - `{ url, tileOptions }` from the engine.
 * @returns {object | undefined}
 */
export function refreshDeckWmsLayer(layer, ctx = {}) {
    const compiled = compileSource(ctx)
    if (!compiled || compiled === layer.props.wmsSourceUrl) return
    return layer.clone(wmsLayerSource(compiled))
}
