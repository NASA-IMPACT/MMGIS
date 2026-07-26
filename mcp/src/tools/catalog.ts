import { z } from 'zod'
import type { McpConfig } from '../config.js'
import { searchStac, searchCollections, stacItemToTileLayer } from '../stac.js'
import { MMGISError } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

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
                'List/search dataset collections in a STAC catalog. Use to find data for a dashboard. Dataset ids are technical (e.g. no2-monthly, not "air quality") — try measurement-specific keywords, and on zero matches use the returned availableSample to pick real names.',
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
                            hint: `No collections matched "${keyword}". Dataset names are technical — try synonyms (e.g. air quality: no2, so2, pm, aerosol; fire: fire, burn, thermal; flood: flood, water, inundation) or pick from availableSample.`,
                            availableSample: all.slice(0, 40).map((c) => c.id),
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
                    return toToolResult({
                        layer: stacItemToTileLayer(item, { name, titilerUrl: cfg.titilerUrl, asset, rescale, colormap }),
                    })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
