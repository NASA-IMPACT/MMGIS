/**
 * Shared utilities for building Tile URLs.
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
        if (layerObj.cogColormap && !params.has('colormap_name'))
            params.set('colormap_name', layerObj.cogColormap as string)

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
 * Compiles a full tile URL based on time options and STAC parameters.
 * Replaces placeholders like {time}, {starttime}, {endtime}, and custom times.
 * Injects required query parameters based on layer type.
 *
 * @param {string} url - The base tile URL with placeholders
 * @param {object} options - Layer options/config object containing time and STAC properties
 * @returns {string} Fully compiled tile URL
 */
/**
 * Format a Date object to a string using standard strftime tokens.
 * Supports %Y, %m, %d, %H, %M, %S, %Z
 */
function formatTime(date: Date, format: string): string {
    const pad = (n: number) => n.toString().padStart(2, '0')
    return format
        .replace(/%Y/g, date.getUTCFullYear().toString())
        .replace(/%m/g, pad(date.getUTCMonth() + 1))
        .replace(/%d/g, pad(date.getUTCDate()))
        .replace(/%H/g, pad(date.getUTCHours()))
        .replace(/%M/g, pad(date.getUTCMinutes()))
        .replace(/%S/g, pad(date.getUTCSeconds()))
        .replace(/%Z/g, 'Z')
}

export function compileTileUrl(url: string, options: Record<string, any>): string {
    if (!url) return url

    let nextUrl = url

    // 1. Process STAC/COG datetime parameters
    let timeStr = options.time
    let startTimeStr = options.starttime
    let endTimeStr = options.endtime

    if (options.timeFormat) {
        if (timeStr) {
            const d = new Date(timeStr)
            if (!isNaN(d.getTime())) timeStr = formatTime(d, options.timeFormat)
        }
        if (startTimeStr) {
            const d = new Date(startTimeStr)
            if (!isNaN(d.getTime())) startTimeStr = formatTime(d, options.timeFormat)
        }
        if (endTimeStr) {
            const d = new Date(endTimeStr)
            if (!isNaN(d.getTime())) endTimeStr = formatTime(d, options.timeFormat)
        }
    }

    if (
        options.splitColonType === 'stac-collection' ||
        options.splitColonType === 'COG' ||
        options.splitColonType === 'titiler-url'
    ) {
        let datetime
        if (endTimeStr != null) {
            if (startTimeStr != null) {
                datetime = `${startTimeStr}/${endTimeStr}`
            } else {
                datetime = `../${endTimeStr}`
            }
        }
        if (datetime != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}datetime=${datetime}`
        }

        if (options.splitColonType === 'stac-collection') {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}exitwhenfull=false&skipcovered=false`
        }

        nextUrl = applyCogFieldsToUrl(nextUrl, options)

        // @ts-ignore - mmgisglobal is a global variable injected at runtime
        const globalStacOptions = window.mmgisglobal?.options?.stac

        if (globalStacOptions?.mosaicItemLimit != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}items_limit=${globalStacOptions.mosaicItemLimit}`
        }
        if (globalStacOptions?.mosaicScanLimit != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}scan_limit=${globalStacOptions.mosaicScanLimit}`
        }
        if (globalStacOptions?.mosaicTimeLimit != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}time_limit=${globalStacOptions.mosaicTimeLimit}`
        }
    }

    // 2. Perform placeholder replacements
    if (timeStr) nextUrl = nextUrl.replace(/{time}/g, timeStr)
    if (startTimeStr) nextUrl = nextUrl.replace(/{starttime}/g, startTimeStr)
    if (endTimeStr) nextUrl = nextUrl.replace(/{endtime}/g, endTimeStr)

    // 3. Custom time replacements
    if (options.customTimes?.times && options.customTimes.times.length > 0) {
        for (let i = 0; i < options.customTimes.times.length; i++) {
            nextUrl = nextUrl.replace(
                new RegExp(`{customtime.${i}}`, 'g'),
                options.customTimes.times[i]
            )
        }
    }

    // 4. TMS specific options
    if (timeStr && options.tileFormat === 'tms') {
        let paramDelimiter = nextUrl.indexOf('?') === -1 ? '?' : '&'
        const urlParams = nextUrl.indexOf('?') !== -1 ? new URLSearchParams(nextUrl.split('?')[1]) : null

        if (!urlParams || !urlParams.has('starttime')) {
            nextUrl += `${paramDelimiter}starttime=${startTimeStr}`
            paramDelimiter = '&'
        }
        if (!urlParams || !urlParams.has('time')) {
            nextUrl += `${paramDelimiter}time=${endTimeStr}`
            paramDelimiter = '&'
        }
        if ((!urlParams || !urlParams.has('composite')) && options.compositeTile === true) {
            nextUrl += `${paramDelimiter}composite=true`
        }
    }

    return nextUrl
}
