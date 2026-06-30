/**
 * Shared utilities for building COG tile URLs.
 * Used by both the Leaflet per-tile middleware (getTileUrl) and the DeckGL
 * static URL builder (makeTileLayer), so the same params are applied
 * regardless of which engine is active.
 */

/**
 * Adds `asset_` prefix to bare band references (b1, B2, etc.) in a TiTiler
 * expression string. No-ops if the expression is empty or already prefixed.
 *
 * @param {string} expression
 * @returns {string}
 */
export function processExpression(expression) {
    if (!expression || expression.trim() === '') return expression
    return expression.replace(/(?<!\w)([bB])(\d+)/g, 'asset_$1$2')
}

/**
 * Merges COG/TiTiler query params into a tile URL.
 * Params already present in the URL always win; layer config only fills in what's missing.
 *
 *
 * Works for both the Leaflet per-tile middleware (getTileUrl) and the DeckGL
 * static URL builder, so the same params are applied regardless of which engine
 * is active.
 *
 * @param {string} url - The tile URL (may already have query params)
 * @param {object} layerObj - Layer config object
 * @returns {string} URL with COG params merged in
 */
export function applyCogFieldsToUrl(url: string, layerObj: Record<string, unknown>): string {
    if (!url) return url
    const qIdx = url.indexOf('?')
    const path = qIdx === -1 ? url : url.slice(0, qIdx)
    const params = new URLSearchParams(qIdx === -1 ? '' : url.slice(qIdx + 1))

    const expression = (layerObj.currentCogExpression || layerObj.cogExpression) as string | undefined
    if (expression && expression.trim() !== '') {
        params.delete('bidx')
        params.set('expression', processExpression(expression))
    }

    if (layerObj.cogTransform === true) {
        const colormap = (layerObj.currentCogColormap ?? layerObj.cogColormap) as string | undefined
        if (colormap && !params.has('colormap_name')) params.set('colormap_name', colormap)

        const cogMin = layerObj.currentCogMin ?? layerObj.cogMin
        const cogMax = layerObj.currentCogMax ?? layerObj.cogMax
        if (cogMin != null && cogMax != null && !params.has('rescale'))
            params.set('rescale', `${cogMin},${cogMax}`)
    }

    if (layerObj.cogResampling && !params.has('resampling'))
        params.set('resampling', layerObj.cogResampling as string)

    const qs = params.toString()
    return qs ? `${path}?${qs}` : path
}

/**
 * Returns true when the layer should be treated as a COG layer:
 * - splitColonType is 'COG' or 'stac-collection', OR
 * - layerObj.cogTransform === true
 */
export function isCogLayer(
    splitColonType: string | undefined,
    layerObj: Record<string, unknown>
): boolean {
    return (
        splitColonType === 'COG' ||
        splitColonType === 'stac-collection' ||
        layerObj.cogTransform === true
    )
}

/**
 * Returns true when the deck.gl raster path should be used:
 * engineType must be 'deckgl', the layer must be a COG layer,
 * and cogRendererMode must be 'deckRaster'.
 */
export function shouldUseDeckRaster(
    engineType: string,
    splitColonType: string | undefined,
    layerObj: Record<string, unknown>
): boolean {
    return (
        engineType === 'deckgl' &&
        isCogLayer(splitColonType, layerObj) &&
        splitColonType !== 'stac-collection' &&
        layerObj.cogRendererMode === 'deckRaster'
    )
}
