import { z } from 'zod'
import type { McpConfig } from '../config.js'
import { searchStac, searchCollections, filterCollections, stacItemToTileLayer } from '../stac.js'
import { MMGISError } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult, wrap } from './result.js'

// Some catalogs (e.g. VEDA) keep imagery in protected buckets only their own
// tile server can read — prefer a direct catalogName -> tiler lookup (set
// when the item came from a search against a configured catalog name), then
// fall back to matching the item's self link against a catalog origin.
export function tilerForItem(
    cfg: McpConfig,
    selfHref: string | null,
    catalogName?: string
): { titilerUrl: string; urlStyle: 'stac-url' | 'item-path' } {
    if (catalogName && cfg.stacTilers[catalogName]) {
        // Dedicated tilers are titiler-pgstac (eoAPI) deployments — they
        // serve items by path, not by a ?url= parameter.
        return { titilerUrl: cfg.stacTilers[catalogName].replace(/\/+$/, ''), urlStyle: 'item-path' }
    }
    if (selfHref) {
        for (const [name, catalogUrl] of Object.entries(cfg.stacCatalogs)) {
            try {
                if (new URL(selfHref).origin === new URL(catalogUrl).origin && cfg.stacTilers[name]) {
                    return { titilerUrl: cfg.stacTilers[name].replace(/\/+$/, ''), urlStyle: 'item-path' }
                }
            } catch {
                // unparseable URL — fall through to the generic tiler
            }
        }
    }
    return { titilerUrl: cfg.titilerUrl, urlStyle: 'stac-url' }
}

function resolveCatalog(cfg: McpConfig, catalog: string): string {
    if (/^https?:\/\//.test(catalog)) return catalog
    const url = cfg.stacCatalogs[catalog]
    if (!url) {
        throw new MMGISError(
            `Unknown catalog "${catalog}"`,
            `Configured catalogs: ${Object.keys(cfg.stacCatalogs).join(', ')} — or pass a full STAC API URL.`
        )
    }
    return url
}

// The `catalog` input names a configured catalog (dashboard_profile_schema-
// style short name) unless it's already a full STAC API URL.
function resolveCatalogName(catalog: string): string | undefined {
    return /^https?:\/\//.test(catalog) ? undefined : catalog
}

export function makeCatalogTools(cfg: McpConfig, fetchFn: typeof fetch = fetch): ToolDef[] {
    return [
        {
            name: 'catalog_collections',
            description:
                'List/search dataset collections in a STAC catalog. Use to find data for a dashboard. Dataset ids are technical (e.g. no2-monthly, not "air quality") — try measurement-specific keywords, and on zero matches scan the returned availableCollections list for real names.',
            schema: {
                catalog: z.string().describe(`Catalog name (${Object.keys(cfg.stacCatalogs).join(', ')}) or a STAC API URL`),
                keyword: z.string().optional().describe('Filter by keyword, e.g. "no2", "fire", "flood"'),
            },
            handler: ({ catalog, keyword }: { catalog: string; keyword?: string }) =>
                wrap(async () => {
                    const url = resolveCatalog(cfg, catalog)
                    const all = await searchCollections(url, undefined, fetchFn)
                    const collections = keyword ? filterCollections(all, keyword) : all
                    if (keyword && collections.length === 0) {
                        return toToolResult({
                            collections: [],
                            hint: `No collections matched "${keyword}". Dataset names are technical — scan availableCollections below for related measurements (e.g. air quality: no2, so2, pm, aerosol; fire: burn, thermal; flood: water, inundation) and re-search with a matching id fragment.`,
                            availableCollections: all.slice(0, 400).map((c) => c.id),
                            totalCollections: all.length,
                        })
                    }
                    return toToolResult({ collections })
                }),
        },
        {
            name: 'catalog_search',
            description: 'Search a STAC catalog for items (scenes/granules) by collection, bbox, and datetime.',
            schema: {
                catalog: z.string().describe('Catalog name or STAC API URL'),
                collections: z.array(z.string()).optional(),
                bbox: z.array(z.number()).length(4).optional().describe('[west, south, east, north]'),
                datetime: z.string().optional().describe('RFC3339 interval, e.g. "2026-01-01T00:00:00Z/2026-06-30T23:59:59Z"'),
                limit: z.number().optional(),
            },
            handler: ({ catalog, ...params }: any) =>
                wrap(async () => {
                    const catalogName = resolveCatalogName(catalog)
                    const items = await searchStac(resolveCatalog(cfg, catalog), params, undefined, catalogName)
                    return toToolResult({ items })
                }),
        },
        {
            name: 'catalog_item_to_layer',
            description:
                'Convert a STAC item (from catalog_search) into an MMGIS TileLayer entry for dashboard_generate, rendered through TiTiler.',
            schema: {
                item: z.record(z.any()).describe('A StacItemSummary object exactly as returned by catalog_search'),
                name: z.string().describe('Display name for the layer'),
                asset: z.string().optional().describe('Asset key to render (defaults to the first asset)'),
                rescale: z.string().optional().describe('e.g. "0,255"'),
                colormap: z.string().optional().describe('e.g. "viridis"'),
            },
            handler: ({ item, name, asset, rescale, colormap }: any) =>
                wrap(async () => {
                    const tiler = tilerForItem(cfg, item?.selfHref ?? null, item?.catalogName)
                    return toToolResult({
                        layer: stacItemToTileLayer(item, {
                            name,
                            titilerUrl: tiler.titilerUrl,
                            urlStyle: tiler.urlStyle,
                            asset,
                            rescale,
                            colormap,
                        }),
                    })
                }),
        },
    ]
}
