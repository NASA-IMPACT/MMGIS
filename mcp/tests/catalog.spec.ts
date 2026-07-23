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
