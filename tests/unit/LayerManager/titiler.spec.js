import { test, expect } from '@playwright/test'
import { getTiTilerBaseUrl, getTiTilerUrl } from '../../../src/essence/Tools/LayerManager/lib/utils/titiler.ts'

test.describe('titiler', () => {
    test.beforeEach(({ }, testInfo) => {
        // Provide a stable window.location for Node test env
        if (typeof global !== 'undefined') {
            global.window = global.window || {}
            global.window.location = { origin: 'https://mmgis.test', pathname: '/site' }
        }
    })

    test('getTiTilerBaseUrl builds origin + pathname + /titiler', () => {
        expect(getTiTilerBaseUrl()).toBe('https://mmgis.test/site/titiler')
    })

    test('getTiTilerUrl prepends leading slash when missing', () => {
        expect(getTiTilerUrl('colorMaps/viridis')).toBe('https://mmgis.test/site/titiler/colorMaps/viridis')
        expect(getTiTilerUrl('/colorMaps')).toBe('https://mmgis.test/site/titiler/colorMaps')
    })
})
