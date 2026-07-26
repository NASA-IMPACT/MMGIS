import { z } from 'zod'
import type { McpConfig } from '../config.js'
import { searchStac, searchCollections, stacItemToTileLayer } from '../stac.js'
import { MMGISError } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

// Some catalogs (e.g. VEDA) keep imagery in protected buckets only their own
// tile server can read — match the item's self link to a catalog origin and
// use that catalog's dedicated tiler when one is configured.
export function tilerForItem(
    cfg: McpConfig,
    selfHref: string | null
): { titilerUrl: string; urlStyle: 'stac-url' | 'item-path' } {
    if (selfHref) {
        for (const [name, catalogUrl] of Object.entries(cfg.stacCatalogs)) {
            try {
                if (new URL(selfHref).origin === new URL(catalogUrl).origin && cfg.stacTilers[name]) {
                    // Dedicated tilers are titiler-pgstac (eoAPI) deployments —
                    // they serve items by path, not by a ?url= parameter.
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
            handler: async ({ catalog, keyword }: { catalog: string; keyword?: string }) => {
                try {
                    const url = resolveCatalog(cfg, catalog)
                    const collections = await searchCollections(url, keyword, fetchFn)
                    if (keyword && collections.length === 0) {
                        const all = await searchCollections(url, undefined, fetchFn)
                        return toToolResult({
                            collections: [],
                            hint: `No collections matched "${keyword}". Dataset names are technical — scan availableCollections below for related measurements (e.g. air quality: no2, so2, pm, aerosol; fire: burn, thermal; flood: water, inundation) and re-search with a matching id fragment.`,
                            availableCollections: all.slice(0, 400).map((c) => c.id),
                            totalCollections: all.length,
                        })
                    }
                    return toToolResult({ collections })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
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
            handler: async ({ catalog, ...params }: any) => {
                try {
                    return toToolResult({ items: await searchStac(resolveCatalog(cfg, catalog), params) })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
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
            handler: async ({ item, name, asset, rescale, colormap }: any) => {
                try {
                    const tiler = tilerForItem(cfg, item?.selfHref ?? null)
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
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
