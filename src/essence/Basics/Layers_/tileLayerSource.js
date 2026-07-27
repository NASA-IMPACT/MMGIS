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
 * Note: a `stac-collection:` layer has its `tileformat` forced to `wmts` here,
 * matching what layer creation has always done. The write is idempotent.
 *
 * @param {object} layerObj - Layer config from the mission JSON.
 * @returns {{url: string, sourceUrl: string, splitColonType: (string|undefined), tileElevation: (number|undefined)}}
 */
export function resolveTileLayerSource(layerObj) {
    const tileLevel = getActiveTileLevel(layerObj)
    const sourceUrl = getTileLevelUrl(tileLevel) || layerObj.url
    const tileElevation = getTileLevelElevation(tileLevel)

    let url = L_.getUrl(layerObj.type, sourceUrl, layerObj)
    let splitColonType

    const splitColonLayerUrl = (sourceUrl || '').split(':')
    if (splitColonLayerUrl[1] != null) {
        switch (splitColonLayerUrl[0]) {
            case 'stac-collection':
                splitColonType = splitColonLayerUrl[0]
                url = L_.transformStacUrl(layerObj.url, layerObj, 'tile')
                layerObj.tileformat = 'wmts'
                break
            case 'COG':
                splitColonType = splitColonLayerUrl[0]
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
                splitColonType = splitColonLayerUrl[0]
                url = splitColonLayerUrl.slice(1).join(':')
                if (!F_.isUrlAbsolute(url)) url = L_.missionPath + url
                break
            default:
                break
        }
    }

    return { url, sourceUrl, splitColonType, tileElevation }
}
