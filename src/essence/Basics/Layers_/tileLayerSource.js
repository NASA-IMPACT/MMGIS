/**
 * Resolves a tile layer config into the concrete URL its tiles are fetched from.
 *
 * Layer creation (Map_.makeTileLayer) and time-driven reloads
 * (TimeControl.reloadLayer) both need this resolution, and they must agree:
 * a reload that resolves differently silently swaps the layer onto another
 * source. This module is the single implementation both call.
 *
 * Resolution is: pick the active tile level's URL (falling back to the layer's
 * own url) -> run it through L_.getUrl -> apply the service-prefix handling
 * (`stac-collection:`, `COG:`, `titiler-url:`).
 */

import F_ from '../Formulae_/Formulae_'
import L_ from './Layers_'
import ServiceUrls from '../ServiceUrls/ServiceUrls'
import { cogSourceType, resolveTileFormat } from './tileUrlUtils'

/**
 * Returns the tile level a layer is currently displaying, or null when the
 * layer has no tile levels configured.
 * @param {object} layerObj - Layer config from the mission JSON.
 * @returns {object|null}
 */
export function getActiveTileLevel(layerObj) {
    const levels = layerObj.variables?.tileLevels
    if (!Array.isArray(levels) || levels.length === 0) return null

    const selected =
        layerObj.currentTileLevel ??
        layerObj.variables?.defaultTileLevel ??
        getTileLevelKey(levels[0], 0)

    return (
        levels.find(
            (level, index) => getTileLevelKey(level, index) == selected
        ) || levels[0]
    )
}

export function getTileLevelKey(level, index) {
    if (level == null || typeof level !== 'object') return String(level ?? index)
    return String(level.value ?? level.id ?? level.name ?? level.label ?? index)
}

export function getTileLevelUrl(level) {
    if (level == null || typeof level !== 'object') return null
    return typeof level.url === 'string' && level.url.length > 0
        ? level.url
        : null
}

export function getTileLevelElevation(level) {
    if (level == null || typeof level !== 'object') return undefined
    const elevation = Number(level.height ?? level.elevation ?? level.z)
    return Number.isFinite(elevation) ? elevation : undefined
}

/**
 * Resolves a tile layer's source URL, honouring the active tile level and the
 * `stac-collection:` / `COG:` / `titiler-url:` service prefixes.
 *
 * Pure: never writes to `layerObj` — config writes are
 * syncTileFormatToConfig's job.
 *
 * @param {object} layerObj - Layer config from the mission JSON.
 * @returns {{url: string, sourceUrl: string, splitColonType: (string|undefined), tileElevation: (number|undefined), tileFormat: string}}
 */
export function resolveTileLayerSource(layerObj) {
    const tileLevel = getActiveTileLevel(layerObj)
    const sourceUrl = getTileLevelUrl(tileLevel) || layerObj.url
    const tileElevation = getTileLevelElevation(tileLevel)

    let url = L_.getUrl(layerObj.type, sourceUrl, layerObj)
    const splitColonType = cogSourceType(sourceUrl)

    switch (splitColonType) {
        case 'stac-collection':
            url = L_.transformStacUrl(sourceUrl, layerObj, 'tile')
            break
        case 'COG':
            // L_.getUrl resolved the COG file's URL; TiTiler wraps it.
            // An expression takes precedence over bands, so bands are only
            // passed along when no expression is configured.
            url = ServiceUrls.buildTiTilerCogTilesUrl(url, layerObj, {
                tileMatrixSet: layerObj.tileMatrixSet,
                bands:
                    !layerObj.cogExpression ||
                    layerObj.cogExpression.trim() === ''
                        ? layerObj.cogBands
                        : null,
                resampling: layerObj.cogResampling,
            })
            break
        case 'titiler-url':
            // A pre-existing TiTiler endpoint: strip the prefix and use as
            // is. Deliberately not routed through L_.getUrl — that would
            // wrap cross-origin URLs in the dev corsproxy, which tile
            // <img> requests neither need nor work through.
            url = (sourceUrl || '').split(':').slice(1).join(':')
            if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
            break
        default:
            break
    }

    // A STAC mosaic is only served as wmts tiles; everything else keeps the
    // layer's configured format.
    const tileFormat =
        splitColonType === 'stac-collection'
            ? 'wmts'
            : resolveTileFormat(layerObj)

    return { url, sourceUrl, splitColonType, tileElevation, tileFormat }
}

/**
 * Writes a source-dictated tile format (stac-collection → wmts) onto the layer
 * config for its direct readers (globe setup, IdentifierTool). The tile-URL
 * pipeline never reads this write. Called at layer creation.
 * @param {object} layerObj - Layer config from the mission JSON.
 * @param {object} tileSource - Result of resolveTileLayerSource.
 */
export function syncTileFormatToConfig(layerObj, { splitColonType, tileFormat }) {
    if (splitColonType === 'stac-collection') layerObj.tileformat = tileFormat
}
