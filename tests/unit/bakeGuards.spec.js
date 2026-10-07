import { test, expect } from 'vitest'

// Tests for the static-bake config guards (scripts/lib/bake-guards.js):
// a published dashboard has no backend, so config.time.enabled is baked
// off unless an externally-served time-enabled layer remains.

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
    isExternallyServedUrl,
    hasResolvableTimeLayer,
    applyTimeBakeGuard,
    assertThemeCssPresent,
} = require('../../scripts/lib/bake-guards')

const timeLayer = (url) => ({
    name: 'tl',
    type: 'tile',
    url,
    time: { enabled: true },
})

test.describe('isExternallyServedUrl', () => {
    test('absolute and protocol-relative urls are external', () => {
        expect(isExternallyServedUrl('https://example.com/{z}/{x}/{y}.png')).toBe(true)
        expect(isExternallyServedUrl('http://example.com/tiles')).toBe(true)
        expect(isExternallyServedUrl('//example.com/tiles')).toBe(true)
    })

    test('backend-relative urls and non-strings are not', () => {
        expect(isExternallyServedUrl('Missions/Test/Layers/tiles/{z}/{x}/{y}.png')).toBe(false)
        expect(isExternallyServedUrl('/api/tiles/{z}/{x}/{y}.png')).toBe(false)
        expect(isExternallyServedUrl('')).toBe(false)
        expect(isExternallyServedUrl(null)).toBe(false)
        expect(isExternallyServedUrl(undefined)).toBe(false)
    })
})

test.describe('hasResolvableTimeLayer', () => {
    test('false with no layers or no time layers', () => {
        expect(hasResolvableTimeLayer({})).toBe(false)
        expect(hasResolvableTimeLayer({ layers: [] })).toBe(false)
        expect(
            hasResolvableTimeLayer({
                layers: [{ name: 'plain', url: 'https://example.com/t' }],
            })
        ).toBe(false)
    })

    test('false when the only time layer is backend-served', () => {
        expect(
            hasResolvableTimeLayer({
                layers: [timeLayer('Missions/Test/tiles/{z}/{x}/{y}.png')],
            })
        ).toBe(false)
    })

    test('true when an external time layer exists', () => {
        expect(
            hasResolvableTimeLayer({
                layers: [timeLayer('https://example.com/{time}/{z}/{x}/{y}.png')],
            })
        ).toBe(true)
    })

    test('finds time layers nested in sublayers', () => {
        expect(
            hasResolvableTimeLayer({
                layers: [
                    {
                        name: 'header',
                        sublayers: [timeLayer('https://example.com/t')],
                    },
                ],
            })
        ).toBe(true)
    })

    test('ignores layers with time.enabled false', () => {
        expect(
            hasResolvableTimeLayer({
                layers: [
                    {
                        name: 'tl',
                        url: 'https://example.com/t',
                        time: { enabled: false },
                    },
                ],
            })
        ).toBe(false)
    })
})

test.describe('applyTimeBakeGuard', () => {
    test('disables time.enabled when no resolvable time layer remains', () => {
        const config = {
            time: { enabled: true },
            layers: [timeLayer('Missions/Test/tiles/{z}/{x}/{y}.png')],
        }
        applyTimeBakeGuard(config)
        expect(config.time.enabled).toBe(false)
    })

    test('disables time.enabled when there are no time layers at all', () => {
        const config = { time: { enabled: true }, layers: [] }
        applyTimeBakeGuard(config)
        expect(config.time.enabled).toBe(false)
    })

    test('keeps time.enabled when an external time layer remains', () => {
        const config = {
            time: { enabled: true },
            layers: [timeLayer('https://example.com/{time}/{z}/{x}/{y}.png')],
        }
        applyTimeBakeGuard(config)
        expect(config.time.enabled).toBe(true)
    })

    test('leaves configs without time untouched and tolerates null', () => {
        expect(applyTimeBakeGuard(null)).toBe(null)
        const config = { layers: [] }
        applyTimeBakeGuard(config)
        expect(config.time).toBeUndefined()
        const disabled = { time: { enabled: false }, layers: [] }
        applyTimeBakeGuard(disabled)
        expect(disabled.time.enabled).toBe(false)
    })
})

test.describe('assertThemeCssPresent', () => {
    // A fake build/ with only default.css and horizon.css compiled
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgis-build-'))
    fs.mkdirSync(path.join(buildDir, 'dist'))
    fs.writeFileSync(path.join(buildDir, 'dist', 'default.css'), ':root{}')
    fs.writeFileSync(path.join(buildDir, 'dist', 'horizon.css'), ':root{}')

    test('passes when build/dist/<msv.theme>.css exists', () => {
        const config = { msv: { theme: 'horizon' } }
        expect(assertThemeCssPresent(config, buildDir)).toBe(config)
    })

    test('falls back to default.css when no theme is configured', () => {
        expect(() => assertThemeCssPresent({}, buildDir)).not.toThrow()
        expect(() => assertThemeCssPresent({ msv: {} }, buildDir)).not.toThrow()
    })

    test('throws naming the theme when its stylesheet is missing', () => {
        expect(() => assertThemeCssPresent({ msv: { theme: 'air4us' } }, buildDir)).toThrow(
            /Theme 'air4us' stylesheet not found .*build:themes/
        )
    })
})
