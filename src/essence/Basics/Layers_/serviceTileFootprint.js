/**
 * The footprint and zoom range a tile service reports for a layer, read from
 * the service's own tilejson.
 *
 * A deck.gl tile layer is built with no extent, so it asks for tiles across the
 * whole viewport at every zoom and the service answers 404 for nearly all of
 * them. Mission configuration's `boundingBox` is free text nothing validates
 * and reaches only the Leaflet path; the service already knows the answer.
 * TiTiler's `/cog/{tms}/tilejson.json` and titiler-pgstac's
 * `/collections/{id}/{tms}/tilejson.json` each report `bounds` in degrees and a
 * `minzoom`/`maxzoom` pair for the requested tile matrix set.
 *
 * Only the bounds and the ceiling are passed on. A service's `minzoom` is not:
 * deck.gl reads a `minZoom` alongside an `extent` as "raise every request to
 * this level", across the whole of that extent, so a continental COG reporting
 * a floor of 8 would ask for hundreds of level-8 tiles at world zoom where the
 * unbounded layer asked for a handful. TiTiler serves the levels below a COG's
 * floor from its overviews anyway, and titiler-pgstac never reports a real one.
 *
 * A layer that names its service by prefix resolves through `ServiceUrls`, so
 * a deployment pointing a layer at an external TiTiler is read at that TiTiler
 * and a static build with nothing configured makes no request at all. A layer
 * configured with a collection mosaic's full tile address is read at the
 * service that address names, since that is the one serving its tiles.
 */

import ServiceUrls from '../ServiceUrls/ServiceUrls'
import { shouldUseDeckRaster, stacCollectionNameFrom } from './tileUrlUtils'
import { fourFiniteDegrees } from './boundingBox'
import { MAP_ENGINE } from '../MapEngines/types/engine'

/**
 * WebMercatorQuad's deepest level. titiler-pgstac reports `0` and this number
 * for every collection - it numbers the whole matrix set rather than the
 * collection's own pyramid - so the pair means "no zooms reported".
 */
const WEB_MERCATOR_QUAD_MAX_ZOOM = 24

/** How long a tilejson request is given before it is abandoned, in ms. */
const TILEJSON_TIMEOUT_MS = 10000

/**
 * A placeholder `compileTileUrl` left behind, `{time}` or `{customtime.0}`
 * among them. A URL still carrying one names no file any service can answer
 * for.
 */
const UNFILLED_PLACEHOLDER = /\{[^}]*\}/

/** The time tokens `compileTileUrl` substitutes, emptying the ones it cannot. */
const TIME_PLACEHOLDERS = /\{(?:time|starttime|endtime|customtime\.\d+)\}/g

/**
 * Resolved footprints by layer name, for the readers that want a layer's
 * extent without holding its deck.gl layer - see `layerBoundsFor`.
 */
const footprintsByLayer = new Map()

/**
 * The build each layer name is currently on, as a token compared by identity.
 *
 * A layer is rebuilt while an earlier read is still in flight - a tile-level
 * switch, a colormap change - and the two can settle in either order. The
 * token taken before the read is the only way the one that settles late can
 * tell that it is describing a layer the map no longer holds.
 */
const buildsByLayer = new Map()

/**
 * In-flight and settled requests by tilejson URL, for the page's lifetime.
 * Failures are kept alongside successes: layers sharing a COG, and the
 * rebuilds a tile-level switch triggers, resolve the same URL, and a service
 * that just answered 500 should not be asked again on every one of them.
 */
const requestsByTilejsonUrl = new Map()

/**
 * Whether a compiled URL - or a piece of one, a service base or a collection
 * name - names nothing a service can answer for: a placeholder is still in it,
 * or every time placeholder its template carried compiled to nothing, leaving
 * the template with the tokens simply deleted.
 *
 * Either is a layer whose times have not resolved yet. Asking about it would
 * spend a request on a file that does not exist and, worse, remember the
 * answer under that URL for the life of the page.
 *
 * @param {string} compiledUrl - The URL, or the piece of one, as
 *   `compileTileUrl` left it.
 * @param {string} [templateUrl] - The template it was compiled from.
 * @returns {boolean}
 */
function isUnresolvedUrl(compiledUrl, templateUrl) {
    if (UNFILLED_PLACEHOLDER.test(compiledUrl)) return true
    if (!templateUrl) return false
    const emptied = templateUrl.replace(TIME_PLACEHOLDERS, '')
    return emptied !== templateUrl && emptied === compiledUrl
}

/**
 * The tilejson URL titiler-pgstac describes a collection's mosaic by.
 *
 * The path carries no `/tiles/` segment where the tile path does: the service
 * answers a tilejson path that has one with the STAC Browser page rather than
 * a 404, a failure visible only as a JSON parse error. titiler-pgstac refuses
 * the request outright without an `assets`, and answers the same bounds and
 * zooms whichever asset is named.
 *
 * One trailing slash comes off the base. A service resolved through
 * `ServiceUrls` arrives without one - it strips a configured URL's as it reads
 * it - so what is normalised here is the address form: a tile address written
 * `https://host/api//collections/...` names the base `https://host/api/`, and
 * comes out as the URL its clean spelling does, sharing the single request
 * remembered under it.
 *
 * @param {string} baseUrl - The service's base URL.
 * @param {string} collectionName - The collection's id.
 * @returns {string}
 */
function collectionTilejsonUrl(baseUrl, collectionName) {
    const base = baseUrl.replace(/\/$/, '')
    return `${base}/collections/${collectionName}/WebMercatorQuad/tilejson.json?assets=asset`
}

/**
 * A collection mosaic's tile path, as a layer configured with the service's
 * full address spells it out:
 * `<base>/collections/<name>/tiles/<tms>/{z}/{x}/{y}`, with an optional `@Nx`
 * scale suffix and format extension.
 *
 * Only an absolute `http(s)` address matches. `L_.getUrl` prefixes a relative
 * one with `L_.missionPath`, so a mission-relative address of this shape names
 * a path in the mission's own file tree, and asking it for a tilejson would
 * spend a same-origin request on something that is not a tile service at all.
 * The scheme is matched narrowly, and narrower than `F_.isUrlAbsolute` reads
 * one: an uppercase `HTTPS://` and a protocol-relative `//host/...` are
 * absolute to it and refused here, so a layer written either way draws exactly
 * as it always has and simply goes without a footprint.
 *
 * The shape is the OGC API Tiles convention rather than a titiler-pgstac
 * signature, so a service answering this path with a tilejson is assumed, not
 * proven: another service laid out the same way costs one failed request and
 * one warning.
 *
 * The collection name is one path segment with `/tiles/` immediately after it,
 * so an item-pinned address - which carries `/items/<id>` in between - cannot
 * match. The placeholders are matched in the only order the service serves,
 * so a `{z}/{y}/{x}` template belongs to something else and is refused.
 */
const COLLECTION_TILE_PATH =
    /^(https?:\/\/.*)\/collections\/([^/]+)\/tiles\/([^/]+)\/\{z\}\/\{x\}\/\{y\}(?:@\d+x)?(?:\.[a-zA-Z0-9]+)?$/

/**
 * The tilejson URL for a layer whose configured address is a collection
 * mosaic's own tile URL, or null when the address is not one.
 *
 * The service and the collection are both read out of that address.
 * `ServiceUrls` is deliberately not consulted: the author typed an absolute
 * address, and the service serving the layer's tiles is the one that can say
 * what they cover.
 *
 * The address's query string is dropped rather than carried. It holds the
 * colormap, asset, rescale and nodata the tiles are drawn with, none of which
 * change the bounds reported, and the address is read before its placeholders
 * are substituted, so a time-enabled layer's still holds a literal
 * `datetime={starttime}/{endtime}` - which the tilejson endpoint answers 500
 * for, an answer then remembered under that URL for the life of the page.
 * The URL itself is built by `collectionTilejsonUrl`, the one the
 * `stac-collection` branch builds its own with, which keeps the two branches
 * to a single request per collection between them.
 *
 * @param {string} [tileUrl] - The layer's resolved tile URL template.
 * @returns {string|null}
 */
function collectionTilejsonUrlFrom(tileUrl) {
    const [path] = (tileUrl || '').split(/[?#]/)
    const match = COLLECTION_TILE_PATH.exec(path)
    if (match == null) return null
    const [, baseUrl, collectionName, tileMatrixSet] = match

    // A raw address declares its tile matrix set in the path, where
    // `tilejsonUrlFor`'s `layerConfig.tileMatrixSet` rule - a field these
    // layers do not set - cannot see it.
    if (tileMatrixSet !== 'WebMercatorQuad') return null

    // The whole address up to the placeholders has to be literal: a service or
    // a collection still spelled as a placeholder names nothing to ask about.
    if (isUnresolvedUrl(baseUrl) || isUnresolvedUrl(collectionName)) return null

    return collectionTilejsonUrl(baseUrl, collectionName)
}

/**
 * The tilejson URL a layer's tiles are described by, or null when there is
 * none to ask.
 *
 * `COG:` and `stac-collection:` sources have a derivable tilejson path, and so
 * does a plain template that spells out a collection mosaic's full tile
 * address. A `titiler-url:` source is an opaque endpoint, every other plain
 * template - a basemap, a WMS layer - is not a TiTiler at all, a `COG:` layer
 * in deck raster mode requests no tiles to narrow, and deck.gl indexes
 * WebMercator tiles only, so another tile matrix set has no footprint this can
 * act on.
 *
 * @param {object} source - The resolved tile source.
 * @param {string|undefined} source.splitColonType - `resolveTileLayerSource`'s
 *   service prefix.
 * @param {string} source.sourceUrl - The layer's raw config URL, prefix intact.
 * @param {string} [source.tileUrl] - The layer's tile URL as the source
 *   resolver left it, placeholders intact, read for the collection and service
 *   a prefix-less address names.
 * @param {string} [source.cogUrl] - For a `COG:` source, the bare file URL its
 *   tiles are rendered from, time placeholders already substituted.
 * @param {string} [source.cogUrlTemplate] - For a `COG:` source, the template
 *   `cogUrl` was compiled from, read only to tell a time-templated URL whose
 *   times came up empty from a real one.
 * @param {object} source.layerConfig - An entry of `L_.layers.data`, read for
 *   its tile matrix set and any per-layer service override.
 * @returns {string|null}
 */
export function tilejsonUrlFor({
    splitColonType,
    sourceUrl,
    tileUrl,
    cogUrl,
    cogUrlTemplate,
    layerConfig,
}) {
    // The rule the tile URLs themselves resolve through.
    const tileMatrixSet = layerConfig?.tileMatrixSet || 'WebMercatorQuad'
    if (tileMatrixSet !== 'WebMercatorQuad') return null

    // A deck raster layer reads the .tif itself and requests no tiles, so
    // there is nothing for a footprint to narrow. The engine is named rather
    // than read from the map, which holds only because a footprint source is
    // produced on the deck.gl branch alone - a Leaflet build hands back none.
    if (shouldUseDeckRaster(MAP_ENGINE.DECKGL, splitColonType, layerConfig ?? {}))
        return null

    if (splitColonType === 'COG') {
        const baseUrl = ServiceUrls.getTiTilerUrl(layerConfig)
        if (baseUrl == null || !cogUrl) return null
        if (isUnresolvedUrl(cogUrl, cogUrlTemplate)) return null
        // `url` alone: colormap, rescale, bidx, expression and datetime change
        // what a tile looks like, never where the data is or how deep it goes.
        return `${baseUrl}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(
            cogUrl
        )}`
    }

    if (splitColonType === 'stac-collection') {
        const baseUrl = ServiceUrls.getTiTilerPgStacUrl(layerConfig)
        if (baseUrl == null) return null
        // The same reading of the name the layer's tile URLs are built from.
        const collectionName = stacCollectionNameFrom(sourceUrl)
        if (!collectionName || isUnresolvedUrl(collectionName)) return null
        return collectionTilejsonUrl(baseUrl, collectionName)
    }

    // No prefix: an address typed out in full, so that the tiles carry exactly
    // the parameters the author chose. Only the collection and the service are
    // taken from it - the tile URLs it produces are untouched. A `titiler-url:`
    // source is left out even where its address takes the same shape.
    if (splitColonType === undefined) return collectionTilejsonUrlFrom(tileUrl)

    return null
}

const clamp = (n, limit) => Math.min(Math.max(n, -limit), limit)

/**
 * A tilejson `bounds` as deck.gl's `extent`, `[west, south, east, north]` in
 * degrees, or null when the document declares no usable footprint.
 *
 * A box is accepted when its four numbers are finite and each axis runs the
 * right way, then clamped rather than refused: TiTiler routinely reports
 * `-180.0000001` for a COG that reaches the antimeridian, and ±85.0511 for one
 * covering the whole Mercator world. A box still spanning the globe after
 * clamping says nothing about where the data is - titiler-pgstac reports it for
 * any collection whose `extent.spatial.bbox` is the world - so it leaves the
 * layer unbounded rather than pinning it to an extent that excludes nothing.
 *
 * @param {unknown} bounds - A tilejson document's `bounds`.
 * @returns {[number, number, number, number] | null}
 */
function extentFromBounds(bounds) {
    const corners = fourFiniteDegrees(bounds)
    if (corners == null) return null
    const [west, south, east, north] = corners
    // Refused rather than reordered, unlike a configured box: a service whose
    // bounds run backwards is reporting a broken document, and deck.gl reads a
    // transposed extent as one that contains no tile at all.
    if (west >= east || south >= north) return null

    const extent = [
        clamp(west, 180),
        clamp(south, 90),
        clamp(east, 180),
        clamp(north, 90),
    ]
    const coversWorld =
        extent[0] === -180 &&
        extent[1] === -90 &&
        extent[2] === 180 &&
        extent[3] === 90
    return coversWorld ? null : extent
}

// `null` reads as absent rather than as the zero `Number` makes of it: a
// tilejson field written null is a field the service did not fill in.
const finiteNumber = (n) =>
    n != null && Number.isFinite(Number(n)) ? Number(n) : undefined

/**
 * The deepest level a tilejson says its data holds, or undefined when the
 * document reports the tile matrix set's own range instead of the data's.
 *
 * `minzoom` is read only to recognise that range. It is never passed on - see
 * the module comment for what deck.gl does with a request floor.
 *
 * @param {object} tilejson - A parsed tilejson document.
 * @returns {number | undefined}
 */
function maxZoomFromTilejson(tilejson) {
    const minZoom = finiteNumber(tilejson.minzoom)
    const maxZoom = finiteNumber(tilejson.maxzoom)
    if (minZoom === undefined || maxZoom === undefined) return undefined
    if (minZoom === 0 && maxZoom === WEB_MERCATOR_QUAD_MAX_ZOOM) return undefined
    return maxZoom
}

/**
 * A tilejson document as the deck.gl tile props it dictates, or null when the
 * body is not a tilejson at all.
 *
 * Both props map onto deck.gl directly: `extent` is the area tiles are
 * requested within, and `maxZoom` the deepest level they are requested at.
 * There is no floor among them, by design.
 *
 * An empty object is a tilejson that reports nothing worth applying - a
 * collection with a world footprint and the matrix set's own zooms - and is not
 * a failure.
 *
 * @param {unknown} tilejson - A parsed tilejson document.
 * @returns {{extent?: number[], maxZoom?: number} | null}
 */
export function footprintFromTilejson(tilejson) {
    if (tilejson == null || typeof tilejson !== 'object') return null

    const footprint = {}
    const extent = extentFromBounds(tilejson.bounds)
    if (extent) footprint.extent = extent

    const maxZoom = maxZoomFromTilejson(tilejson)
    if (maxZoom !== undefined) footprint.maxZoom = maxZoom

    return footprint
}

/**
 * Read one tilejson, at most once per URL per page.
 *
 * Never rejects, and reports a failure rather than logging one: the result is
 * shared by every layer that reads the same URL, so what went wrong is told to
 * each of them in its own name instead of once in the name of whichever layer
 * happened to ask first.
 *
 * @param {string} tilejsonUrl - The URL to read.
 * @returns {Promise<{footprint?: {extent?: number[], maxZoom?: number}, failure?: string}>}
 */
function readTilejson(tilejsonUrl) {
    const pending = requestsByTilejsonUrl.get(tilejsonUrl)
    if (pending) return pending

    const request = (async () => {
        try {
            const response = await fetch(tilejsonUrl, {
                signal: AbortSignal.timeout(TILEJSON_TIMEOUT_MS),
            })
            if (!response.ok) {
                return { failure: `${response.status} ${response.statusText}` }
            }
            const footprint = footprintFromTilejson(await response.json())
            if (footprint == null) {
                return { failure: 'the response is not a tilejson' }
            }
            return { footprint }
        } catch (err) {
            return { failure: err?.message ?? String(err) }
        }
    })()

    requestsByTilejsonUrl.set(tilejsonUrl, request)
    return request
}

/**
 * Read the service's footprint for a layer just handed to the engine and apply
 * it to the layer the engine holds.
 *
 * The one line `Map_.makeLayer` runs, so the ordering it has to get right -
 * after the hand-off, before nothing - is all that lives there. Deliberately
 * not awaited there: a slow or unreachable tile service must not hold up
 * `allLayersLoaded`, and a layer with no footprint yet is the layer MMGIS has
 * always drawn.
 *
 * Never rejects. The caller does not await it, so a rejection would surface as
 * an unhandled one, and nothing about the layer as built depends on this
 * succeeding.
 *
 * @param {object} engine - The map engine holding the layer, always the main
 *   map's.
 * @param {string} layerName - The layer's name, the key the engine holds it by.
 * @param {object|null|undefined} source - As {@link tilejsonUrlFor} takes it,
 *   or nothing for a build that left the layer with no service to ask.
 * @param {boolean} isDefaultMapContext - Whether the build was the main map's.
 *   A build for any other context - the Animation tool's offscreen map rebuilds
 *   every layer under the same name - describes a layer `engine` does not hold,
 *   and says nothing at all here rather than drop the main map's footprint and
 *   strand the read in flight for it.
 * @returns {Promise<void>}
 */
export async function startServiceTileFootprint(
    engine,
    layerName,
    source,
    isDefaultMapContext
) {
    try {
        if (isDefaultMapContext !== true) return

        // Every build starts by forgetting what the last one learned, whether
        // or not this one has anything to ask: the layer the engine now holds
        // was built unbounded, and a footprint read for whatever it was before
        // describes data it no longer draws.
        footprintsByLayer.delete(layerName)

        // Taken before the read, so a read that settles after a later build's
        // can see that it has been superseded.
        const build = {}
        buildsByLayer.set(layerName, build)

        const tilejsonUrl = source ? tilejsonUrlFor(source) : null
        if (tilejsonUrl == null) return

        const { footprint, failure } = await readTilejson(tilejsonUrl)

        // A rebuild has happened since, and is the one that owns this layer
        // now - including the clear above, which this must not undo.
        if (buildsByLayer.get(layerName) !== build) return

        if (failure != null) {
            console.warn(
                `Tile footprint for layer '${layerName}' could not be read from ${tilejsonUrl}: ${failure}`
            )
            return
        }
        if (Object.keys(footprint).length === 0) return

        // The request outlives the build that started it, so the layer may
        // have been removed, or the map swapped to the other engine, in the
        // meantime. Held, not drawn, is the question: a layer the mission
        // starts switched off is held hidden and must be narrowed too, or it
        // asks for the whole world the moment it is switched on.
        if (!engine?.holdsLayer(layerName)) return

        // Remembered only once it is going onto a layer that exists, so that
        // zoom-to-layer cannot answer with a footprint nothing holds.
        footprintsByLayer.set(layerName, footprint)
        engine.updateLayer(layerName, { tileFootprint: footprint })
    } catch (err) {
        console.warn(
            `Tile footprint for layer '${layerName}' could not be applied: ${
                err?.message ?? String(err)
            }`
        )
    }
}

/**
 * Forget what a layer being taken off the map had been narrowed to.
 *
 * Both maps here are keyed by layer name and nothing else prunes them, so a
 * removed layer would leave its footprint behind for the life of the page -
 * ready to be answered to zoom-to-layer should the name come back on a layer
 * that is somewhere else entirely. Dropping the build token alongside it
 * discards a read still in flight, which has no layer left to narrow.
 *
 * @param {string} layerName - The layer's name.
 * @returns {void}
 */
export function forgetServiceTileFootprint(layerName) {
    footprintsByLayer.delete(layerName)
    buildsByLayer.delete(layerName)
}

/**
 * Forget every layer's footprint, for a teardown that drops the whole layer
 * set at once.
 *
 * `L_.clear` replaces `L_.layers` wholesale on a mission swap rather than
 * removing its layers one at a time, so nothing here would hear about any of
 * them. Both maps are keyed by layer name, and two missions routinely name
 * different layers the same thing.
 *
 * @returns {void}
 */
export function forgetAllServiceTileFootprints() {
    footprintsByLayer.clear()
    buildsByLayer.clear()
}

/**
 * The footprint a tile service reported for a layer, or undefined when none
 * has been read.
 *
 * @param {string} layerName - The layer's name.
 * @returns {{extent?: number[], maxZoom?: number} | undefined}
 */
export function serviceTileFootprintFor(layerName) {
    return footprintsByLayer.get(layerName)
}
