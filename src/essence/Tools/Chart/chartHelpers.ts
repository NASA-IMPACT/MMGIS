/**
 * Chart plugin — pure helpers.
 * No MMGIS imports, no DOM mutation, no network. Inputs in, values out.
 */

import type { ChartSpec } from './ChartComponent'

export const DEFAULT_BASE_URL = 'https://dev.openveda.cloud/api'
export const DEFAULT_STATISTIC = 'mean'

/**
 * Mirror of Layers_.js:377-386's dev-only corsproxy wrap. In production
 * this is a no-op; in dev, an absolute cross-origin URL is rewritten to
 * `<rootPath>/corsproxy/<url>` — the same path MMGIS already proxies
 * tile requests through.
 */
export function proxyifyForDev(url: string): string {
    if (typeof window === 'undefined') return url
    if (process.env.NODE_ENV !== 'development') return url
    try {
        const parsed = new URL(url)
        if (parsed.origin === window.location.origin) return url
    } catch {
        return url
    }
    const rootPath =
        ((window as unknown as { mmgisglobal?: { ROOT_PATH?: string } })
            .mmgisglobal?.ROOT_PATH) || ''
    return `${rootPath}/corsproxy/${url}`
}

export interface AnalysisLayerConfig {
    name: string
    title: string
    summary: string
    collection: string
    baseUrl: string
    assets: string[] | null     // null = auto-discover from first stats response
    statistic: string
}

/**
 * Pull `variables.analysis.collection`-driven config from a layer config blob
 * returned by `layers:getConfig`. Returns null if the layer has no analysis
 * block (the plugin filters it out).
 */
export function readAnalysisConfig(
    cfg: unknown,
    layerName: string
): AnalysisLayerConfig | null {
    if (!cfg || typeof cfg !== 'object') return null
    const variables = (cfg as { variables?: unknown }).variables
    if (!variables || typeof variables !== 'object') return null
    const analysis = (variables as { analysis?: unknown }).analysis
    if (!analysis || typeof analysis !== 'object') return null
    const a = analysis as Record<string, unknown>
    const collection = typeof a.collection === 'string' ? a.collection : ''
    if (!collection) return null
    return {
        name: layerName,
        title: typeof a.title === 'string' ? a.title : layerName,
        summary: typeof a.summary === 'string' ? a.summary : '',
        collection,
        baseUrl: typeof a.baseUrl === 'string' ? a.baseUrl : DEFAULT_BASE_URL,
        assets: Array.isArray(a.assets) ? (a.assets as string[]) : null,
        statistic:
            typeof a.statistic === 'string' ? a.statistic : DEFAULT_STATISTIC,
    }
}

/**
 * Compute axis-aligned bounding box of a GeoJSON geometry as
 * `[minx, miny, maxx, maxy]` (lng/lat). Returns null for empty / unsupported.
 */
export function bboxOf(geometry: unknown): [number, number, number, number] | null {
    if (!geometry || typeof geometry !== 'object') return null
    const g = geometry as { type?: string; coordinates?: unknown }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const visit = (point: number[]) => {
        const [x, y] = point
        if (Number.isFinite(x) && Number.isFinite(y)) {
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
        }
    }
    const walk = (coords: unknown, depth: number): void => {
        if (!Array.isArray(coords)) return
        if (depth === 0) {
            visit(coords as number[])
            return
        }
        for (const c of coords) walk(c, depth - 1)
    }
    switch (g.type) {
        case 'Point':
            walk(g.coordinates, 0)
            break
        case 'MultiPoint':
        case 'LineString':
            walk(g.coordinates, 1)
            break
        case 'MultiLineString':
        case 'Polygon':
            walk(g.coordinates, 2)
            break
        case 'MultiPolygon':
            walk(g.coordinates, 3)
            break
        default:
            return null
    }
    if (!Number.isFinite(minX)) return null
    return [minX, minY, maxX, maxY]
}

/**
 * Build the items-list URL for a STAC collection.
 * Adds `bbox` and (optionally) a `datetime` range.
 */
export function buildItemsUrl(input: {
    baseUrl: string
    collection: string
    bbox: [number, number, number, number]
    start?: string
    end?: string
    limit?: number
}): string {
    const params = new URLSearchParams()
    params.set('bbox', input.bbox.join(','))
    if (input.start && input.end) {
        params.set('datetime', `${input.start}/${input.end}`)
    }
    params.set('limit', String(input.limit ?? 200))
    return `${input.baseUrl}/stac/collections/${encodeURIComponent(
        input.collection
    )}/items?${params.toString()}`
}

/**
 * Build the per-item statistics URL for a STAC item in a collection.
 * `assets` is appended as repeated `assets=<name>` query params — titiler-pgstac
 * needs to know which asset(s) to compute pixel statistics for.
 */
export function buildStatsUrl(input: {
    baseUrl: string
    collection: string
    itemId: string
    assets: string[]
}): string {
    const params = new URLSearchParams()
    for (const asset of input.assets) {
        if (asset) params.append('assets', asset)
    }
    const qs = params.toString()
    return `${input.baseUrl}/raster/collections/${encodeURIComponent(
        input.collection
    )}/items/${encodeURIComponent(input.itemId)}/statistics${qs ? `?${qs}` : ''}`
}

/**
 * From an array of (item, stats-response) pairs, build one ChartSpec per
 * asset. If `assetNames` is null, auto-discover assets from the keys of the
 * first stats response's `properties.statistics`.
 */
export function buildChartSpecs(
    pairs: Array<{ item: StacItem; stats: StatsResponse | null }>,
    assetNames: string[] | null,
    statistic: string
): ChartSpec[] {
    if (!pairs.length) return []

    const firstStats = pairs.find((p) => !!p.stats)?.stats ?? null
    const discovered = firstStats
        ? Object.keys(firstStats.properties?.statistics ?? {})
        : []
    const assets =
        assetNames && assetNames.length ? assetNames : discovered

    const out: ChartSpec[] = []
    for (const asset of assets) {
        const data: ChartSpec['data'] = []
        for (const { item, stats } of pairs) {
            const props = item.properties ?? {}
            const time = props.datetime ?? props.start_datetime ?? props.end_datetime
            if (!time) continue
            const value = readStat(stats, asset, statistic)
            if (value == null || !Number.isFinite(value)) continue
            data.push({ time, value })
        }
        if (!data.length) continue
        // STAC items aren't always ordered — sort by time ascending.
        data.sort((a, b) =>
            String(a.time) < String(b.time) ? -1 : String(a.time) > String(b.time) ? 1 : 0
        )
        // Strip titiler's `_b<N>` band-index suffix and uppercase for display.
        const title = asset.replace(/_b\d+$/i, '').toUpperCase()
        out.push({ title, data, type: 'bar' })
    }
    return out
}

interface StacItem {
    id: string
    properties?: {
        datetime?: string
        start_datetime?: string
        end_datetime?: string
        [key: string]: unknown
    }
}

interface StatsResponse {
    properties?: {
        statistics?: Record<string, Record<string, number>>
        [key: string]: unknown
    }
}

/**
 * Read `properties.statistics[asset][statistic]` from a stats response.
 * VEDA sometimes suffixes asset names with `_b1` (band index) or `_1` —
 * if the exact match is missing, try the first key that starts with `asset`.
 */
function readStat(
    stats: StatsResponse | null,
    asset: string,
    statistic: string
): number | null {
    const all = stats?.properties?.statistics
    if (!all || typeof all !== 'object') return null
    let entry = all[asset]
    if (!entry) {
        const match = Object.keys(all).find(
            (k) => k === asset || k.startsWith(`${asset}_`)
        )
        if (match) entry = all[match]
    }
    if (!entry) return null
    const v = entry[statistic]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
}
