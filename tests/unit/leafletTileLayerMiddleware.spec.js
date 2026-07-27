import { test, expect, describe, beforeAll } from 'vitest'

/**
 * leaflet-tilelayer-middleware unit tests.
 *
 * Exercises the real middleware against a minimal `window.L` stub — enough of
 * Leaflet's Class.extend / TileLayer / Util surface for the module to build its
 * classes and serve tile URLs, with no real Leaflet build.
 *
 * The focus is `refresh(newUrl, ...)`: it assigns `_url`, and the URL it is
 * handed has not been through the transformations `L.tileLayer.colorFilter`
 * applies at creation. Both transformations regressed once.
 */

// ─── Minimal Leaflet stub ─────────────────────────────────────────────────────

// Mirrors L.Util.template: throws on a token it cannot resolve, which is what
// makes an unrewritten `{t}` fatal.
function template(str, data) {
    return str.replace(/\{ *([\w_ -]+) *\}/g, (match, key) => {
        let value = data[key]
        if (value === undefined)
            throw new Error(`No value provided for variable ${match}`)
        if (typeof value === 'function') value = value(data)
        return value
    })
}

function makeClass(base, props) {
    const NewClass = function (...args) {
        if (this.initialize) this.initialize.apply(this, args)
    }
    NewClass.prototype = Object.create(base.prototype)
    Object.assign(NewClass.prototype, props)
    NewClass.prototype.constructor = NewClass
    NewClass.extend = (p) => makeClass(NewClass, p)
    return NewClass
}

function installLeafletStub() {
    const TileLayer = function (...args) {
        if (this.initialize) this.initialize.apply(this, args)
    }
    TileLayer.prototype = {
        initialize(url, options) {
            this._url = url
            this.options = Object.assign({ tileSize: 256 }, options)
        },
        getTileUrl(coords) {
            return template(this._url, Object.assign({}, this.options, coords))
        },
        onAdd() {},
    }
    TileLayer.extend = (p) => makeClass(TileLayer, p)

    const L = {
        TileLayer,
        tileLayer: {},
        Browser: { retina: false },
        extend: (dest, src) => Object.assign(dest, src),
        setOptions(obj, options) {
            obj.options = Object.assign({ tileSize: 256 }, options)
            return obj.options
        },
        Util: {
            template,
            requestAnimFrame: (fn) => fn(),
            getParamString(obj, existingUrl, uppercase) {
                const params = Object.keys(obj).map(
                    (k) =>
                        `${uppercase ? k.toUpperCase() : k.toLowerCase()}=${obj[k]}`
                )
                return (
                    (existingUrl && existingUrl.indexOf('?') !== -1 ? '&' : '?') +
                    params.join('&')
                )
            },
        },
        CRS: { EPSG4326: { code: 'EPSG:4326' } },
        Bounds: function () {},
    }

    window.L = L
    globalThis.L = L
    return L
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('leaflet-tilelayer-middleware', () => {
    let L

    beforeAll(async () => {
        L = installLeafletStub()
        await import(
            '../../src/essence/Basics/Layers_/leaflet-tilelayer-middleware.js'
        )
    })

    const timeOptions = {
        time: '2024-03-04T00:00:00Z',
        starttime: '2024-03-01T00:00:00Z',
        endtime: '2024-03-04T00:00:00Z',
    }

    describe('the {t} shorthand placeholder', () => {
        test('is rewritten at creation', () => {
            const layer = L.tileLayer.colorFilter('https://t/{t}/{z}/{x}/{y}.png', {
                ...timeOptions,
            })
            expect(layer._url).toBe('https://t/_time_/{z}/{x}/{y}.png')
        })

        test('is rewritten by refresh too', () => {
            // Regression: refresh assigned the raw URL, so the next getTileUrl
            // threw "No value provided for variable {t}" — swallowed, because
            // the caller does not await refresh. The layer stopped refreshing
            // for good after one time change.
            const layer = L.tileLayer.colorFilter('https://t/{t}/{z}/{x}/{y}.png', {
                ...timeOptions,
            })
            layer.refresh('https://t2/{t}/{z}/{x}/{y}.png', false, timeOptions)

            expect(layer._url).toBe('https://t2/_time_/{z}/{x}/{y}.png')
            expect(() => layer.getTileUrl({ x: 1, y: 2, z: 3 })).not.toThrow()
            expect(layer.getTileUrl({ x: 1, y: 2, z: 3 })).toBe(
                'https://t2/_time_/3/1/2.png'
            )
        })

        test('leaves a URL without {t} alone', () => {
            const layer = L.tileLayer.colorFilter('https://t/{z}/{x}/{y}.png', {
                ...timeOptions,
            })
            layer.refresh('https://t2/{z}/{x}/{y}.png', false, timeOptions)
            expect(layer._url).toBe('https://t2/{z}/{x}/{y}.png')
        })
    })

    describe('WMS layers', () => {
        const wmsUrl =
            'https://w/wms?layers=mylayer&format=image/png&time={time}'

        const makeWmsLayer = () =>
            L.tileLayer.colorFilter(wmsUrl, {
                tileFormat: 'wms',
                ...timeOptions,
            })

        test('creation keeps only the base address in _url', () => {
            const layer = makeWmsLayer()
            expect(layer._url).toBe('https://w/wms')
            expect(layer.wmsParams.LAYERS).toBe('mylayer')
            expect(layer.wmsParams.TIME).toBe('{time}')
        })

        test('refresh keeps only the base address in _url', () => {
            // Regression: refresh assigned the whole query-bearing URL to
            // _url, and getTileUrl then appended the entire wmsParams set on
            // top — every param sent twice, in mixed casing.
            const layer = makeWmsLayer()
            layer.refresh(wmsUrl, false, timeOptions)

            expect(layer._url).toBe('https://w/wms')
            expect(layer.wmsParams.LAYERS).toBe('mylayer')
        })

        test('refresh picks up a changed param', () => {
            const layer = makeWmsLayer()
            layer.refresh(
                'https://w/wms?layers=otherlayer&format=image/png&time={time}',
                false,
                timeOptions
            )
            expect(layer.wmsParams.LAYERS).toBe('otherlayer')
        })

        test('refresh does not resize existing tiles', () => {
            const layer = makeWmsLayer()
            const before = layer.options.tileSize
            layer.refresh(`${wmsUrl}&tilesize=512`, false, timeOptions)
            expect(layer.options.tileSize).toBe(before)
            expect(layer.wmsParams.TILESIZE).toBeUndefined()
        })
    })

    describe('refresh option merging', () => {
        test('copies handed-in options onto this.options', () => {
            const layer = L.tileLayer.colorFilter('https://t/{z}/{x}/{y}.png', {
                ...timeOptions,
            })
            layer.refresh(null, false, { time: '2025-01-01T00:00:00Z' })
            expect(layer.options.time).toBe('2025-01-01T00:00:00Z')
        })

        test('leaves _url alone when handed no URL', () => {
            const layer = L.tileLayer.colorFilter('https://t/{z}/{x}/{y}.png', {
                ...timeOptions,
            })
            layer.refresh(null, false, timeOptions)
            expect(layer._url).toBe('https://t/{z}/{x}/{y}.png')
        })
    })
})
