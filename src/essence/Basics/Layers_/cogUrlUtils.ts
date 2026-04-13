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
 * Merges COG layer field values into a URL as query params.
 * Params already present in the URL always win; fields only fill in what's missing.
 * Used for DeckGL layers with direct TiTiler URLs (not COG:-prefixed).
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
        // Expression takes precedence over bidx; remove band params and set expression.
        params.delete('bidx')
        params.set('expression', processExpression(expression))
    }

    if (layerObj.cogColormap && !params.has('colormap_name'))
        params.set('colormap_name', layerObj.cogColormap as string)

    const cogMin = layerObj.currentCogMin ?? layerObj.cogMin
    const cogMax = layerObj.currentCogMax ?? layerObj.cogMax
    if (cogMin != null && cogMax != null && !params.has('rescale'))
        params.set('rescale', `${cogMin},${cogMax}`)

    if (layerObj.cogResampling && !params.has('resampling'))
        params.set('resampling', layerObj.cogResampling as string)

    const qs = params.toString()
    return qs ? `${path}?${qs}` : path
}

/**
 * Appends dynamic COG query params to a TiTiler tile URL:
 *   - `rescale=[min,max]` when cogTransform is true and min/max are set
 *   - `colormap_name=...` when cogColormap is set (requires cogTransform)
 *   - `expression=...` when an expression is configured (takes precedence over bands)
 *
 * Reads runtime overrides (`currentCog*`) first, falling back to the configured
 * (`cog*`) values. The `layerObj` argument can be either a layer config object
 * or a Leaflet tile layer's `options` object; both use the same key names.
 *
 * @param {string} url - Base tile URL (already has `?` query string started)
 * @param {object} layerObj - Layer config or Leaflet tile layer options
 * @returns {string} URL with COG params appended
 */
export function appendCogDynamicParams(url, layerObj) {
    const sep = () => (url.includes('?') ? '&' : '?')

    const cogMin =
        layerObj.currentCogMin != null ? layerObj.currentCogMin : layerObj.cogMin
    const cogMax =
        layerObj.currentCogMax != null ? layerObj.currentCogMax : layerObj.cogMax

    if (layerObj.cogTransform === true && cogMin != null && cogMax != null) {
        url += `${sep()}rescale=[${cogMin},${cogMax}]`
        if (layerObj.cogColormap != null) {
            url += `${sep()}colormap_name=${layerObj.cogColormap}`
        }
    }

    const expression =
        layerObj.currentCogExpression || layerObj.cogExpression
    if (expression && expression.trim() !== '') {
        url += `${sep()}expression=${encodeURIComponent(processExpression(expression))}`
    }

    return url
}
