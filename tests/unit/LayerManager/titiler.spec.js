import { test, expect } from 'vitest'
import { getTiTilerBaseUrl, getTiTilerUrl } from '../../../src/essence/Tools/LayerManager/lib/utils/titiler.ts'

test.describe('titiler', () => {
    test.beforeEach(({ }, testInfo) => {
        // Provide a stable window.location for Node test env
        if (typeof global !== 'undefined') {
            global.window = global.window || {}
            global.window.location = { origin: 'https://mmgis.test', pathname: '/site' }
            // index.html sets SERVER before the bundle loads; default to node mode
            global.window.mmgisglobal = { SERVER: 'node' }
        }
    })

    test('getTiTilerBaseUrl builds origin + pathname + /titiler', () => {
        expect(getTiTilerBaseUrl()).toBe('https://mmgis.test/site/titiler')
    })

    test('getTiTilerUrl prepends leading slash when missing', () => {
        expect(getTiTilerUrl('colorMaps/viridis')).toBe('https://mmgis.test/site/titiler/colorMaps/viridis')
        expect(getTiTilerUrl('/colorMaps')).toBe('https://mmgis.test/site/titiler/colorMaps')
    })

    test('static mode never falls back to the same-origin /titiler path', () => {
        global.window.mmgisglobal = { SERVER: 'static' }
        expect(getTiTilerBaseUrl()).toBe(null)
        expect(getTiTilerUrl('colorMaps/viridis')).toBe(null)
    })

    test('static mode resolves the configured external TiTiler URL', () => {
        global.window.mmgisglobal = {
            SERVER: 'static',
            options: { services: { titilerUrl: 'https://titiler.test/' } },
        }
        expect(getTiTilerBaseUrl()).toBe('https://titiler.test')
        expect(getTiTilerUrl('colorMaps/viridis')).toBe('https://titiler.test/colorMaps/viridis')
    })
})
