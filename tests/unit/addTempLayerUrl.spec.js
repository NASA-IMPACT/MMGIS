import { test, expect } from 'vitest'
import {
    validateUrl,
    detectLayerType,
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
            // {s} is NOT substituted — buildLayerObj always passes the URL
            // through verbatim; if it can't render, the engine reports it
            // via layers:loadStatusChanged.
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
