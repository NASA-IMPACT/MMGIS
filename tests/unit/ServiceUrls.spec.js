import { test, expect } from 'vitest'

import ServiceUrls from '../../src/essence/Basics/ServiceUrls/ServiceUrls.js'

// In a static build with no external service configured, getServiceUrl
// returns null. The URL builders must propagate that null instead of
// interpolating it into a string like "null/cog/tiles/..." (a request to a
// bogus host). This mirrors the guard buildTipgUrl/buildVeloserverUrl have.
test.describe('ServiceUrls builders in a static build with no service configured', () => {
    test.beforeEach(() => {
        global.window = global.window || {}
        global.window.location = {
            origin: 'https://mmgis.test',
            pathname: '/site',
        }
        global.window.mmgisglobal = { SERVER: 'static' }
    })

    const nullCases = [
        ['buildTiTilerCogTilesUrl', () => ServiceUrls.buildTiTilerCogTilesUrl('s3://bucket/x.tif')],
        ['buildTiTilerPointUrl', () => ServiceUrls.buildTiTilerPointUrl(1, 2, 's3://bucket/x.tif')],
        ['buildStacCollectionTilesUrl', () => ServiceUrls.buildStacCollectionTilesUrl('collection')],
        ['buildStacCollectionPointUrl', () => ServiceUrls.buildStacCollectionPointUrl(1, 2, 'collection')],
        ['buildStacItemsUrl', () => ServiceUrls.buildStacItemsUrl('collection', null, { limit: 1 })],
        ['buildColormapImageUrl', () => ServiceUrls.buildColormapImageUrl('viridis')],
    ]

    for (const [name, build] of nullCases) {
        test(`${name} returns null (not a "null/..." string)`, () => {
            const url = build()
            expect(url).toBe(null)
        })
    }
})

test.describe('ServiceUrls builders in node mode still build real URLs', () => {
    test.beforeEach(() => {
        global.window = global.window || {}
        global.window.location = {
            origin: 'https://mmgis.test',
            pathname: '/site',
        }
        global.window.mmgisglobal = { SERVER: 'node' }
    })

    test('buildTiTilerCogTilesUrl builds the local titiler tiles URL', () => {
        const url = ServiceUrls.buildTiTilerCogTilesUrl('s3://bucket/x.tif')
        expect(url).toContain('https://mmgis.test/site/titiler/cog/tiles/')
        expect(url.startsWith('null')).toBe(false)
    })

    test('buildColormapImageUrl builds the local colormap URL', () => {
        const url = ServiceUrls.buildColormapImageUrl('viridis')
        expect(url).toContain('https://mmgis.test/site/titiler/colorMaps/viridis')
    })
})

test.describe('ServiceUrls resolution order: layer, then mission, then local proxy', () => {
    test.beforeEach(() => {
        global.window = global.window || {}
        global.window.location = {
            origin: 'https://mmgis.test',
            pathname: '/site',
        }
        global.window.mmgisglobal = { SERVER: 'node' }
        ServiceUrls.setMissionServices(null)
    })

    test('a layer without its own URL uses the mission one, trailing slash dropped', () => {
        ServiceUrls.setMissionServices({ titilerUrl: 'https://mission.test/raster/' })
        expect(ServiceUrls.getTiTilerUrl({})).toBe('https://mission.test/raster')
        expect(ServiceUrls.hasExternalServiceUrl('titiler', {})).toBe(true)
    })

    test("a layer's own URL wins over the mission one", () => {
        ServiceUrls.setMissionServices({ titilerUrl: 'https://mission.test/raster' })
        expect(
            ServiceUrls.getTiTilerUrl({ titilerUrl: 'https://layer.test/raster' })
        ).toBe('https://layer.test/raster')
    })

    test('with neither set, the local proxy is used and counts as not external', () => {
        expect(ServiceUrls.getTiTilerUrl({})).toBe('https://mmgis.test/site/titiler')
        expect(ServiceUrls.hasExternalServiceUrl('titiler', {})).toBe(false)
    })

    test('a deployment-wide options.services URL is not consulted', () => {
        global.window.mmgisglobal.options = {
            services: { titilerUrl: 'https://deployment.test/raster' },
        }
        expect(ServiceUrls.getTiTilerUrl({})).toBe('https://mmgis.test/site/titiler')
    })

    test("loading another mission's config replaces the previous mission's URLs", () => {
        ServiceUrls.setMissionServices({ titilerUrl: 'https://first.test' })
        ServiceUrls.setMissionServices(undefined)
        expect(ServiceUrls.getTiTilerUrl({})).toBe('https://mmgis.test/site/titiler')
    })
})
