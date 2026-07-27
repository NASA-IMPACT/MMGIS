import { MMGISError } from './mmgisClient.js'

export interface StacItemSummary {
    id: string
    collection: string
    datetime: string | null
    bbox: number[] | null
    selfHref: string | null
    assets: { key: string; title?: string; type?: string; href: string }[]
    // Name of the configured catalog (see McpConfig.stacCatalogs) this item
    // came from, when searchStac was called with one — lets tilerForItem
    // pick a dedicated tiler without re-deriving it from selfHref's origin.
    catalogName?: string
}

async function stacFetch(url: string, init: RequestInit | undefined, fetchFn: typeof fetch): Promise<any> {
    let res
    try {
        res = await fetchFn(url, init)
    } catch (err) {
        throw new MMGISError(
            `Could not reach STAC catalog at ${url}: ${(err as Error).message}`,
            'The catalog may be down — try another configured catalog, or use layers already in the deployment.'
        )
    }
    if (!res.ok) throw new MMGISError(
        `STAC catalog responded ${res.status} for ${url}`,
        'The catalog may be down — try another configured catalog, or use layers already in the deployment.'
    )
    return await res.json()
}

function summarizeItem(feature: any): StacItemSummary {
    return {
        id: feature.id,
        collection: feature.collection,
        datetime: feature.properties?.datetime ?? null,
        bbox: feature.bbox ?? null,
        selfHref: (feature.links || []).find((l: any) => l.rel === 'self')?.href ?? null,
        assets: Object.entries(feature.assets || {}).map(([key, a]: [string, any]) => ({
            key,
            ...(a.title ? { title: a.title } : {}),
            ...(a.type ? { type: a.type } : {}),
            href: a.href,
        })),
    }
}

export async function searchStac(
    catalogUrl: string,
    params: { bbox?: number[]; datetime?: string; collections?: string[]; limit?: number },
    fetchFn: typeof fetch = fetch,
    catalogName?: string
): Promise<StacItemSummary[]> {
    const body: Record<string, unknown> = { limit: params.limit ?? 10 }
    if (params.bbox) body.bbox = params.bbox
    if (params.datetime) body.datetime = params.datetime
    if (params.collections) body.collections = params.collections
    const json = await stacFetch(
        `${catalogUrl.replace(/\/+$/, '')}/search`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        fetchFn
    )
    const items = (json.features || []).map(summarizeItem)
    if (catalogName) {
        for (const item of items) item.catalogName = catalogName
    }
    return items
}

// VEDA alone spans 25 pages at 10 collections/page (verified live 2026-07-25)
const MAX_COLLECTION_PAGES = 50

type StacCollection = { id: string; title?: string; description?: string; temporalExtent?: unknown; spatialExtent?: unknown }

// Per-process cache of each catalog's unfiltered collection list — repeated
// catalog_collections calls (e.g. a keyword miss re-scanning availableCollections)
// shouldn't re-page through a 25-page catalog every time.
const COLLECTIONS_CACHE_TTL_MS = 5 * 60 * 1000
const collectionsCache = new Map<string, { at: number; collections: StacCollection[] }>()

async function fetchAllCollections(catalogUrl: string, fetchFn: typeof fetch): Promise<StacCollection[]> {
    const cached = collectionsCache.get(catalogUrl)
    if (cached && Date.now() - cached.at < COLLECTIONS_CACHE_TTL_MS) {
        return cached.collections
    }
    const rawCollections: any[] = []
    let url = `${catalogUrl.replace(/\/+$/, '')}/collections`
    for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
        const json = await stacFetch(url, undefined, fetchFn)
        rawCollections.push(...(json.collections || []))
        const nextHref = (json.links || []).find((l: any) => l.rel === 'next')?.href
        if (!nextHref) break
        url = new URL(nextHref, url).toString()
    }
    const collections = rawCollections.map((c: any) => {
        const temporal = c.extent?.temporal?.interval?.[0]
        const spatial = c.extent?.spatial?.bbox?.[0]
        return {
            id: c.id,
            ...(c.title ? { title: c.title } : {}),
            ...(c.description ? { description: c.description } : {}),
            // Coverage helps distinguish event-specific snapshots (one day,
            // small bbox) from ongoing/global datasets when presenting options.
            ...(temporal ? { temporalExtent: temporal } : {}),
            ...(spatial ? { spatialExtent: spatial } : {}),
        }
    })
    collectionsCache.set(catalogUrl, { at: Date.now(), collections })
    return collections
}

// Test-only escape hatch — the cache is otherwise process-lifetime.
export function clearCollectionsCache(): void {
    collectionsCache.clear()
}

export function filterCollections(collections: StacCollection[], keyword: string): StacCollection[] {
    const k = keyword.toLowerCase()
    return collections.filter((c) => [c.id, c.title, c.description].some((s) => s && s.toLowerCase().includes(k)))
}

export async function searchCollections(
    catalogUrl: string,
    keyword?: string,
    fetchFn: typeof fetch = fetch
): Promise<StacCollection[]> {
    const collections = await fetchAllCollections(catalogUrl, fetchFn)
    return keyword ? filterCollections(collections, keyword) : collections
}

export function stacItemToTileLayer(
    item: StacItemSummary,
    opts: {
        name: string
        titilerUrl: string
        asset?: string
        rescale?: string
        colormap?: string
        // 'item-path' targets titiler-pgstac deployments (eoAPI, e.g. VEDA's
        // /api/raster) which have no /stac/tiles?url= route; 'stac-url' is
        // plain TiTiler's generic endpoint.
        urlStyle?: 'stac-url' | 'item-path'
    }
): any {
    if (!item.selfHref) {
        throw new MMGISError(`STAC item ${item.id} has no self link; cannot build a tile URL`)
    }
    const asset = opts.asset || item.assets[0]?.key
    if (!asset) throw new MMGISError(`STAC item ${item.id} has no assets`)
    let url: string
    if (opts.urlStyle === 'item-path') {
        if (!item.collection) {
            throw new MMGISError(`STAC item ${item.id} has no collection; cannot build an item-path tile URL`)
        }
        url =
            `${opts.titilerUrl}/collections/${encodeURIComponent(item.collection)}` +
            `/items/${encodeURIComponent(item.id)}/tiles/WebMercatorQuad/{z}/{x}/{y}.png` +
            `?assets=${encodeURIComponent(asset)}`
    } else {
        url =
            `${opts.titilerUrl}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png` +
            `?url=${encodeURIComponent(item.selfHref)}&assets=${encodeURIComponent(asset)}`
    }
    if (opts.rescale) url += `&rescale=${encodeURIComponent(opts.rescale)}`
    if (opts.colormap) url += `&colormap_name=${encodeURIComponent(opts.colormap)}`
    return {
        name: opts.name,
        type: 'TileLayer',
        sourceType: 'url',
        url,
        tileformat: 'wmts',
        controlled: false,
        visibility: true,
        initialOpacity: 1,
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
        ...(item.bbox ? { boundingBox: item.bbox } : {}),
        style: { brightness: 1, contrast: 1, saturation: 1, blend: 'none' },
        time: { enabled: false },
        variables: {},
    }
}
