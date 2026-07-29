/**
 * Shared utilities for building Tile URLs.
 * Used by both the Leaflet per-tile middleware (getTileUrl) and the DeckGL
 * static URL builder (makeTileLayer), so the same params are applied
 * regardless of which engine is active.
 */

import { utcFormat } from 'd3-time-format'

const DEFAULT_TIME_FORMAT = '%Y-%m-%dT%H:%M:%SZ'

/**
 * Resolves a layer's tile format, honouring the legacy `tms` boolean.
 * Mirrors the logic in Map_.makeTileLayer so both engines agree.
 */
export function resolveTileFormat(layerObj: Record<string, any>): string {
    if (typeof layerObj.tileFormat === 'undefined') {
        const tms = typeof layerObj.tms === 'undefined' ? true : layerObj.tms
        return tms ? 'tms' : 'wmts'
    }
    return layerObj.tileFormat
}

/**
 * Returns a formatter for a layer's configured time format.
 *
 * `format` is a documented public config contract using d3 time-format
 * specifiers (see docs/pages/Configure/Layers/Tile/Tile.md), so d3 is used
 * here rather than a hand-rolled strftime — d3 covers the full token set,
 * including %j (day-of-year), which missions rely on.
 *
 * Unparseable input yields '' rather than d3's raw "0NaN-NaN-..." output.
 */
export function formatLayerTime(format?: string): (time: unknown) => string {
    const formatTime = utcFormat(
        format == null || format === '' ? DEFAULT_TIME_FORMAT : format
    )
    return (time: unknown): string => {
        if (time == null || time === '') return ''
        const epochMs = Date.parse(time as string)
        if (Number.isNaN(epochMs)) return ''
        return formatTime(new Date(epochMs))
    }
}

/**
 * Builds the options object consumed by compileTileUrl.
 *
 * Invariant: the time strings on the returned object are ALREADY FORMATTED.
 * compileTileUrl substitutes them verbatim and never re-formats.
 *
 * Invariant: the result is a closed set of tile-URL keys — nothing from the
 * layer config is spread in. It is copied wholesale onto a Leaflet tile layer's
 * `options`, where it sits alongside Leaflet's own creation options, so a stray
 * config key would silently overwrite one of those (see docs/tile-url-pipeline.md).
 *
 * Add a tile-URL option here and only here: Map_.makeTileLayer spreads the
 * result into the layer's creation options and TimeControl passes the same
 * object to refresh(), so both paths pick it up.
 */
export function buildTileUrlOptions(
    layerObj: Record<string, any>,
    tileSourceType?: string,
    tileFormat?: string
): Record<string, any> {
    const timeConfig = layerObj.time || {}
    const formatter = formatLayerTime(timeConfig.format)
    const formattedStart = formatter(timeConfig.start)
    const formattedEnd = formatter(timeConfig.end)

    // mmgisglobal is injected at page load and static thereafter. Captured
    // here so compileTileUrl stays a closed function of its arguments.
    const globalStacOptions = (window as any).mmgisglobal?.options?.stac
    const stacMosaicLimits =
        globalStacOptions == null
            ? null
            : {
                  itemLimit: globalStacOptions.mosaicItemLimit ?? null,
                  scanLimit: globalStacOptions.mosaicScanLimit ?? null,
                  timeLimit: globalStacOptions.mosaicTimeLimit ?? null,
              }

    return {
        tileSourceType,
        time: formattedEnd,
        starttime: formattedStart,
        endtime: formattedEnd,
        compositeTile: timeConfig.compositeTile ?? false,
        customTimes: timeConfig.customTimes ?? null,
        // Prefer the format resolveTileLayerSource resolved (it forces `wmts`
        // for stac-collection sources); fall back to the layer config.
        tileFormat: tileFormat ?? resolveTileFormat(layerObj),
        stacMosaicLimits,
        // COG/TiTiler fields read by applyCogFieldsToUrl
        cogTransform: layerObj.cogTransform,
        cogColormap: layerObj.cogColormap,
        cogExpression: layerObj.cogExpression,
        currentCogExpression: layerObj.currentCogExpression,
        cogMin: layerObj.cogMin,
        currentCogMin: layerObj.currentCogMin,
        cogMax: layerObj.cogMax,
        currentCogMax: layerObj.currentCogMax,
        cogResampling: layerObj.cogResampling,
    }
}

/**
 * Adds `asset_` prefix to bare band references (b1, B2, etc.) in a TiTiler
 * expression string. No-ops if the expression is empty or already prefixed.
 *
 * @param {string} [expression]
 * @returns {string|null|undefined}
 */
export function processExpression(
    expression: string | null | undefined
): string | null | undefined {
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
 * Compiles a full tile URL from a template plus layer options.
 *
 * Substitutes {time}, {starttime}, {endtime} and {customtime.N}, and injects
 * STAC/COG/TMS query params.
 *
 * IMPORTANT: time values on `options` MUST already be formatted (use
 * buildTileUrlOptions). This function never parses or re-formats them —
 * doing so double-formats the Leaflet path and shifts dates across timezones.
 *
 * @param {string} url - The base tile URL with placeholders
 * @param {object} options - Options from buildTileUrlOptions
 * @returns {string} Fully compiled tile URL
 */
export function compileTileUrl(url: string, options: Record<string, any>): string {
    if (!url) return url

    let nextUrl = url

    const timeStr = options.time
    const startTimeStr = options.starttime
    const endTimeStr = options.endtime

    // 1. Placeholder replacements.
    //
    // These run first because the param injection below round-trips the query
    // through URLSearchParams, which percent-encodes the braces — `{time}`
    // becomes `%7Btime%7D` and stops looking like a placeholder. Leaflet masks
    // that ordering for the three standard tokens (L.Util.template substitutes
    // them from `options` before this function is ever called); DeckGL has no
    // such step, so a placeholder inside a query string reached the server raw.
    nextUrl = nextUrl.replace(/{time}/g, timeStr || '')
    nextUrl = nextUrl.replace(/{starttime}/g, startTimeStr || '')
    nextUrl = nextUrl.replace(/{endtime}/g, endTimeStr || '')

    if (options.customTimes?.times && options.customTimes.times.length > 0) {
        for (let i = 0; i < options.customTimes.times.length; i++) {
            nextUrl = nextUrl.replace(
                new RegExp(`{customtime.${i}}`, 'g'),
                options.customTimes.times[i]
            )
        }
    }

    // 2. STAC/COG datetime parameters
    if (
        options.tileSourceType === 'stac-collection' ||
        options.tileSourceType === 'COG' ||
        options.tileSourceType === 'titiler-url'
    ) {
        // Times arrive already formatted (see buildTileUrlOptions). Empty string
        // means "no time configured" — `!= null` would treat '' as a real value
        // and emit a bogus `datetime=/`.
        let datetime
        if (endTimeStr) {
            datetime = startTimeStr ? `${startTimeStr}/${endTimeStr}` : `../${endTimeStr}`
        }
        if (datetime != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}datetime=${datetime}`
        }

        if (options.tileSourceType === 'stac-collection') {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}exitwhenfull=false&skipcovered=false`
        }

        nextUrl = applyCogFieldsToUrl(nextUrl, options)

        // STAC mosaic limits arrive via buildTileUrlOptions, not globals.
        const limits = options.stacMosaicLimits

        if (limits?.itemLimit != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}items_limit=${limits.itemLimit}`
        }
        if (limits?.scanLimit != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}scan_limit=${limits.scanLimit}`
        }
        if (limits?.timeLimit != null) {
            nextUrl += `${nextUrl.indexOf('?') === -1 ? '?' : '&'}time_limit=${limits.timeLimit}`
        }
    }

    // 3. TMS specific options
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
