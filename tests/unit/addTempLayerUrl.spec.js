import { test, expect } from '@playwright/test'
import {
    validateUrl,
    detectLayerType,
    validateForType,
} from '../../src/essence/Tools/AddTempLayer/lib/utils/url.ts'
import { buildLayerObj } from '../../src/essence/Tools/AddTempLayer/adapters/buildLayerObj.ts'

test.describe('AddTempLayer url utils', () => {
    test.describe('validateUrl', () => {
        for (const url of [
            'https://example.com/data.geojson',
            'http://example.com/wms?service=WMS',
        ]) {
            test(`accepts ${url}`, () => expect(validateUrl(url)).toBe(true))
        }
        for (const [label, url] of [
            ['empty', ''],
            ['two URLs pasted (whitespace)', 'https://a.com/x https://b.com/y'],
            ['not a url', 'notaurl'],
            ['non-http protocol', 'ftp://example.com/x'],
        ]) {
            test(`rejects ${label}`, () => expect(validateUrl(url)).toBe(false))
        }
    })

    test.describe('detectLayerType (stage 1)', () => {
        // [url, expected type | null]
        const cases = [
            // geojson — checked first
            ['https://h/data.geojson', 'geojson'],
            ['https://h/data.json', 'geojson'],
            ['https://h/q?f=geojson', 'geojson'],
            ['https://h/wfs?outputFormat=geojson', 'geojson'],
            // ordering: a .geojson with "wmts" in the path is still geojson
            ['https://h/wmts-archive/roads.geojson', 'geojson'],
            // wmts — OGC KVP markers
            ['https://h/wmts?service=WMTS&request=GetTile&layer=x', 'wmts'],
            ['https://h/x?REQUEST=GetTile', 'wmts'],
            // wmts wins over xyz when both markers present
            ['https://h/x?service=WMTS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', 'wmts'],
            // wms
            ['https://h/wms?service=WMS&request=GetMap&layers=a', 'wms'],
            ['https://h/x?request=GetMap', 'wms'],
            // xyz — templated tiles, no service markers
            ['https://h/tiles/{z}/{x}/{y}.png', 'xyz'],
            ['https://{s}.h/{z}/{x}/{y}.png', 'xyz'],
            // unsupported → null
            ['https://h/5/12/20.png', null],
            ['https://h/index.html', null],
            ['https://services.arcgisonline.com/arcgis/rest/services/World/MapServer', null],
            ['', null],
        ]
        for (const [url, expected] of cases) {
            test(`${url || '(empty)'} -> ${expected}`, () => {
                expect(detectLayerType(url)).toBe(expected)
            })
        }
    })

    test.describe('validateForType (stage 2)', () => {
        const outcome = (r) => (r.ok ? 'ok' : 'fail')

        // [type, url, expected outcome]
        const cases = [
            // geojson — nothing to check
            ['geojson', 'https://h/data.geojson', 'ok'],
            ['geojson', 'https://h/anything', 'ok'],
            // wms — needs LAYERS
            ['wms', 'https://h/wms?service=WMS&request=GetMap&layers=a', 'ok'],
            ['wms', 'https://h/wms?SERVICE=WMS&LAYERS=a', 'ok'], // case-insensitive
            ['wms', 'https://h/wms?service=WMS&request=GetMap', 'fail'],
            ['wms', 'https://h/wms?service=WMS&layers=', 'fail'], // empty value
            // xyz / wmts — need a {z}/{x}/{y} template
            ['xyz', 'https://h/{z}/{x}/{y}.png', 'ok'],
            ['xyz', 'https://h/5/12/20.png', 'fail'],
            ['wmts', 'https://h/x?service=WMTS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', 'ok'],
            ['wmts', 'https://h/x?service=WMTS&request=GetTile&tilematrix=5&tilerow=12&tilecol=20', 'fail'],
        ]
        for (const [type, url, expected] of cases) {
            test(`${type}: ${url} -> ${expected}`, () => {
                expect(outcome(validateForType(type, url))).toBe(expected)
            })
        }

        test('failures carry a message', () => {
            const r = validateForType('xyz', 'https://h/5/12/20.png')
            expect(r.ok).toBe(false)
            expect(typeof r.message).toBe('string')
            expect(r.message.length).toBeGreaterThan(0)
        })
    })

    test.describe('buildLayerObj passes the URL through verbatim', () => {
        test('geojson -> vector, url unchanged', () => {
            const url = 'https://h/data.geojson'
            const obj = buildLayerObj({ url, type: 'geojson' })
            expect(obj).toMatchObject({ type: 'vector', url })
        })

        test('wms -> tile/wms, url unchanged', () => {
            const url = 'https://h/wms?service=WMS&request=GetMap&layers=a'
            const obj = buildLayerObj({ url, type: 'wms' })
            expect(obj).toMatchObject({ type: 'tile', tileformat: 'wms', url })
        })

        test('xyz -> tile/wmts, url unchanged (incl. {s})', () => {
            const url = 'https://{s}.h/{z}/{x}/{y}.png'
            const obj = buildLayerObj({ url, type: 'xyz' })
            // {s} is NOT substituted — passed through exactly as given.
            expect(obj).toMatchObject({ type: 'tile', tileformat: 'wmts', url })
        })

        test('wmts -> tile/wmts, url unchanged', () => {
            const url = 'https://h/x?service=WMTS&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
            const obj = buildLayerObj({ url, type: 'wmts' })
            expect(obj).toMatchObject({ type: 'tile', tileformat: 'wmts', url })
        })

        test('invalid url -> null', () => {
            expect(buildLayerObj({ url: 'notaurl', type: 'geojson' })).toBeNull()
        })

        test('gives a unique, colon-free layer name', () => {
            const a = buildLayerObj({ url: 'https://h/a.geojson', type: 'geojson' })
            const b = buildLayerObj({ url: 'https://h/b.geojson', type: 'geojson' })
            expect(a.name).not.toBe(b.name)
            expect(a.name).not.toContain(':')
        })
    })
})
