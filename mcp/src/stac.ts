import { MMGISError } from './mmgisClient.js'

export interface StacItemSummary {
    id: string
    collection: string
    datetime: string | null
    bbox: number[] | null
    selfHref: string | null
    assets: { key: string; title?: string; type?: string; href: string }[]
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
    if (!res.ok) throw new MMGISError(`STAC catalog responded ${res.status} for ${url}`)
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
    fetchFn: typeof fetch = fetch
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
    return (json.features || []).map(summarizeItem)
}

export async function searchCollections(
    catalogUrl: string,
    keyword?: string,
    fetchFn: typeof fetch = fetch
): Promise<{ id: string; title?: string; description?: string }[]> {
    const json = await stacFetch(`${catalogUrl.replace(/\/+$/, '')}/collections`, undefined, fetchFn)
    let collections = (json.collections || []).map((c: any) => ({
        id: c.id,
        ...(c.title ? { title: c.title } : {}),
        ...(c.description ? { description: c.description } : {}),
    }))
    if (keyword) {
        const k = keyword.toLowerCase()
        collections = collections.filter((c: any) =>
            [c.id, c.title, c.description].some((s) => s && s.toLowerCase().includes(k))
        )
    }
    return collections
}

export function stacItemToTileLayer(
    item: StacItemSummary,
    opts: { name: string; titilerUrl: string; asset?: string; rescale?: string; colormap?: string }
): any {
    if (!item.selfHref) {
        throw new MMGISError(`STAC item ${item.id} has no self link; cannot build a tile URL`)
    }
    const asset = opts.asset || item.assets[0]?.key
    if (!asset) throw new MMGISError(`STAC item ${item.id} has no assets`)
    let url =
        `${opts.titilerUrl}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png` +
        `?url=${encodeURIComponent(item.selfHref)}&assets=${asset}`
    if (opts.rescale) url += `&rescale=${opts.rescale}`
    if (opts.colormap) url += `&colormap_name=${opts.colormap}`
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
