import { describe, it, expect } from 'vitest'
import { makeCatalogTools } from '../src/tools/catalog.js'

const cfg = { stacCatalogs: { test: 'https://stac.test' }, titilerUrl: 'https://titiler.xyz' } as any

describe('catalog tools', () => {
    const tools = Object.fromEntries(makeCatalogTools(cfg).map((t) => [t.name, t]))
    it('exposes the three catalog tools', () => {
        expect(Object.keys(tools).sort()).toEqual(['catalog_collections', 'catalog_item_to_layer', 'catalog_search'])
    })
    it('rejects unknown catalog names with the configured list in the hint', async () => {
        const res = await tools.catalog_search.handler({ catalog: 'nope' })
        expect(res.isError).toBe(true)
        expect(JSON.parse(res.content[0].text).hint).toContain('test')
    })
})

describe('catalog_collections empty-match fallback', () => {
    it('returns a sample of available collections when the keyword matches nothing', async () => {
        const fetcher = (async () => ({
            ok: true,
            headers: { get: () => null },
            json: async () => ({
                collections: [
                    { id: 'no2-monthly', title: 'NO2' },
                    { id: 'lis-global-da-evap', title: 'Evapotranspiration' },
                ],
                links: [],
            }),
        })) as any
        const cfg2 = { stacCatalogs: { test: 'https://stac.test' }, titilerUrl: 'https://titiler.xyz' } as any
        const t = Object.fromEntries(makeCatalogTools(cfg2, fetcher).map((x) => [x.name, x]))
        const out = JSON.parse((await t.catalog_collections.handler({ catalog: 'test', keyword: 'air quality' })).content[0].text)
        expect(out.collections).toEqual([])
        expect(out.hint).toMatch(/synonyms/)
        expect(out.availableSample).toContain('no2-monthly')
        expect(out.totalCollections).toBe(2)
    })
})

describe('tilerForItem', () => {
    const cfg3 = {
        stacCatalogs: { veda: 'https://openveda.cloud/api/stac', 'earth-search': 'https://earth-search.aws.element84.com/v1' },
        stacTilers: { veda: 'https://openveda.cloud/api/raster' },
        titilerUrl: 'https://titiler.xyz',
    } as any
    it('uses the catalog-dedicated tiler when the item origin matches', async () => {
        const { tilerForItem } = await import('../src/tools/catalog.js')
        expect(tilerForItem(cfg3, 'https://openveda.cloud/api/stac/collections/no2-monthly/items/x')).toEqual({ titilerUrl: 'https://openveda.cloud/api/raster', urlStyle: 'item-path' })
    })
    it('falls back to the generic tiler otherwise', async () => {
        const { tilerForItem } = await import('../src/tools/catalog.js')
        expect(tilerForItem(cfg3, 'https://earth-search.aws.element84.com/v1/collections/c/items/i')).toEqual({ titilerUrl: 'https://titiler.xyz', urlStyle: 'stac-url' })
        expect(tilerForItem(cfg3, null)).toEqual({ titilerUrl: 'https://titiler.xyz', urlStyle: 'stac-url' })
        expect(tilerForItem(cfg3, 'not a url')).toEqual({ titilerUrl: 'https://titiler.xyz', urlStyle: 'stac-url' })
    })
})
