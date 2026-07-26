import { describe, it, expect, vi } from 'vitest'
import { searchStac, searchCollections, stacItemToTileLayer } from '../src/stac.js'
import { MMGISError } from '../src/mmgisClient.js'

const ITEM = {
    id: 'i1',
    collection: 'no2-monthly',
    bbox: [-90, 30, -80, 40],
    properties: { datetime: '2026-06-01T00:00:00Z' },
    links: [{ rel: 'self', href: 'https://stac.test/collections/no2-monthly/items/i1' }],
    assets: { cog_default: { href: 'https://data.test/i1.tif', type: 'image/tiff', title: 'COG' } },
}

function fakeFetch(json: unknown) {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => json })) as unknown as typeof fetch
}

describe('searchStac', () => {
    it('POSTs to /search and summarizes items', async () => {
        const f = fakeFetch({ features: [ITEM] })
        const items = await searchStac('https://stac.test', { bbox: [-90, 30, -80, 40], collections: ['no2-monthly'], limit: 5 }, f)
        expect((f as any).mock.calls[0][0]).toBe('https://stac.test/search')
        expect(JSON.parse((f as any).mock.calls[0][1].body)).toEqual({
            bbox: [-90, 30, -80, 40],
            collections: ['no2-monthly'],
            limit: 5,
        })
        expect(items[0]).toEqual({
            id: 'i1',
            collection: 'no2-monthly',
            datetime: '2026-06-01T00:00:00Z',
            bbox: [-90, 30, -80, 40],
            selfHref: 'https://stac.test/collections/no2-monthly/items/i1',
            assets: [{ key: 'cog_default', title: 'COG', type: 'image/tiff', href: 'https://data.test/i1.tif' }],
        })
    })

    it('rejects with degradation hint when STAC responds with non-OK status', async () => {
        const f = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
        try {
            await searchStac('https://stac.test', {}, f)
            expect.fail('Should have thrown MMGISError')
        } catch (err) {
            expect(err).toBeInstanceOf(MMGISError)
            expect((err as MMGISError).hint).toMatch(/another configured catalog/)
        }
    })
})

describe('searchCollections', () => {
    it('filters collections by keyword across id/title/description', async () => {
        const f = fakeFetch({
            collections: [
                { id: 'no2-monthly', title: 'NO2 Monthly', description: 'Nitrogen dioxide' },
                { id: 'dem', title: 'Elevation', description: 'Terrain' },
            ],
        })
        const out = await searchCollections('https://stac.test', 'nitrogen', f)
        expect(out.map((c) => c.id)).toEqual(['no2-monthly'])
    })

    it('follows rel=next links to collect paginated collections before filtering', async () => {
        const page1Collections = Array.from({ length: 10 }, (_, i) => ({
            id: `other-${i}`,
            title: `Other ${i}`,
            description: 'Not it',
        }))
        const page1 = {
            collections: page1Collections,
            links: [{ rel: 'next', href: 'https://stac.test/collections?page=2' }],
        }
        const page2 = {
            collections: [{ id: 'no2-monthly', title: 'NO2 Monthly', description: 'Nitrogen dioxide' }],
            links: [],
        }
        const f = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 }) as unknown as typeof fetch
        const out = await searchCollections('https://stac.test', 'no2', f)
        expect(out.map((c) => c.id)).toEqual(['no2-monthly'])
        expect((f as any).mock.calls.length).toBe(2)
        expect((f as any).mock.calls[1][0]).toBe('https://stac.test/collections?page=2')
    })
})

describe('stacItemToTileLayer', () => {
    it('builds a TileLayer entry with a titiler stac tile URL', () => {
        const item = {
            id: 'i1',
            collection: 'no2-monthly',
            datetime: '2026-06-01T00:00:00Z',
            bbox: [-90, 30, -80, 40],
            selfHref: 'https://stac.test/collections/no2-monthly/items/i1',
            assets: [{ key: 'cog_default', href: 'https://data.test/i1.tif' }],
        }
        const layer = stacItemToTileLayer(item as any, { name: 'NO2 June', titilerUrl: 'https://titiler.xyz', asset: 'cog_default' })
        expect(layer.type).toBe('TileLayer')
        expect(layer.name).toBe('NO2 June')
        expect(layer.boundingBox).toEqual([-90, 30, -80, 40])
        expect(layer.url).toBe(
            'https://titiler.xyz/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=' +
                encodeURIComponent('https://stac.test/collections/no2-monthly/items/i1') +
                '&assets=cog_default'
        )
    })

    it('encodes rescale and colormap parameters correctly', () => {
        const item = {
            id: 'i1',
            collection: 'no2-monthly',
            datetime: '2026-06-01T00:00:00Z',
            bbox: [-90, 30, -80, 40],
            selfHref: 'https://stac.test/collections/no2-monthly/items/i1',
            assets: [{ key: 'cog_default', href: 'https://data.test/i1.tif' }],
        }
        const layer = stacItemToTileLayer(item as any, {
            name: 'NO2 June',
            titilerUrl: 'https://titiler.xyz',
            asset: 'cog_default',
            rescale: '0,255',
            colormap: 'viridis',
        })
        expect(layer.url).toBe(
            'https://titiler.xyz/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=' +
                encodeURIComponent('https://stac.test/collections/no2-monthly/items/i1') +
                '&assets=' +
                encodeURIComponent('cog_default') +
                '&rescale=' +
                encodeURIComponent('0,255') +
                '&colormap_name=' +
                encodeURIComponent('viridis')
        )
    })
})

describe('stacItemToTileLayer item-path style', () => {
    it('builds titiler-pgstac item-path URLs', () => {
        const item = {
            id: 'OMI_x.nc',
            collection: 'no2-monthly',
            datetime: null,
            bbox: [-180, -90, 180, 90],
            selfHref: 'https://openveda.cloud/api/stac/collections/no2-monthly/items/OMI_x.nc',
            assets: [{ key: 'cog_default', href: 'https://x/y.tif' }],
        }
        const layer = stacItemToTileLayer(item as any, {
            name: 'NO2', titilerUrl: 'https://openveda.cloud/api/raster', urlStyle: 'item-path', rescale: '0,3e15', colormap: 'reds',
        })
        expect(layer.url).toBe(
            'https://openveda.cloud/api/raster/collections/no2-monthly/items/OMI_x.nc/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=cog_default&rescale=0%2C3e15&colormap_name=reds'
        )
    })
})

describe('searchCollections coverage fields', () => {
    it('includes temporal and spatial extents when the catalog provides them', async () => {
        const f = (async () => ({
            ok: true, headers: { get: () => null },
            json: async () => ({
                collections: [{
                    id: 'tx-flood-imerg', title: 'IMERG 2025 Texas Flood',
                    extent: { temporal: { interval: [['2025-07-07', '2025-07-07']] }, spatial: { bbox: [[-106.7, 25.8, -93.5, 36.6]] } },
                }],
                links: [],
            }),
        })) as any
        const out = await searchCollections('https://stac.test', undefined, f)
        expect(out[0].temporalExtent).toEqual(['2025-07-07', '2025-07-07'])
        expect(out[0].spatialExtent).toEqual([-106.7, 25.8, -93.5, 36.6])
    })
})
