import { test, expect } from 'vitest'
import {
    resolveLatLng,
    resolveBounds,
    resolvePoint,
    resolvePadding,
    resolveLayerId,
    pickInfoToResult,
    buildDeckLayer,
    hexToRgba,
    DECKGL_TYPE_ALIAS,
} from '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts'

test.describe('DeckGLHelpers', () => {
    test.describe('resolveLatLng', () => {
        test('accepts [lat, lng] tuple', () => {
            expect(resolveLatLng([40, -120])).toEqual({ lat: 40, lng: -120 })
        })

        test('accepts {lat, lng} object', () => {
            expect(resolveLatLng({ lat: 40, lng: -120 })).toEqual({ lat: 40, lng: -120 })
        })
    })

    test.describe('resolveBounds', () => {
        test('accepts [[sw], [ne]] tuple and converts to [[lng, lat], [lng, lat]]', () => {
            const result = resolveBounds([[10, -20], [30, -10]])
            expect(result).toEqual([[-20, 10], [-10, 30]])
        })

        test('accepts {southWest, northEast} object', () => {
            const result = resolveBounds({
                southWest: { lat: 10, lng: -20 },
                northEast: { lat: 30, lng: -10 },
            })
            expect(result).toEqual([[-20, 10], [-10, 30]])
        })
    })

    test.describe('resolvePoint', () => {
        test('accepts [x, y] tuple', () => {
            expect(resolvePoint([100, 200])).toEqual({ x: 100, y: 200 })
        })

        test('accepts {x, y} object', () => {
            expect(resolvePoint({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 })
        })
    })

    test.describe('resolvePadding', () => {
        test('returns 0 when undefined', () => {
            expect(resolvePadding(undefined)).toBe(0)
        })

        test('passes through a number', () => {
            expect(resolvePadding(20)).toBe(20)
        })

        test('converts [top, right, bottom, left] array to object', () => {
            expect(resolvePadding([10, 20, 30, 40])).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
        })

        test('passes through an object unchanged', () => {
            const pad = { top: 5, right: 10, bottom: 15, left: 20 }
            expect(resolvePadding(pad)).toEqual(pad)
        })
    })

    test.describe('resolveLayerId', () => {
        test('returns a string id as-is', () => {
            expect(resolveLayerId('my-layer')).toBe('my-layer')
        })

        test('extracts id from a layer object', () => {
            expect(resolveLayerId({ id: 'tile-layer-1' })).toBe('tile-layer-1')
        })
    })

    test.describe('pickInfoToResult', () => {
        test('returns {feature: null} when not picked', () => {
            expect(pickInfoToResult({ picked: false })).toEqual({ feature: null })
        })

        test('maps a picked PickingInfo to FeaturePickResult', () => {
            const info = {
                picked: true,
                coordinate: [-120, 40],
                object: { type: 'Feature', properties: { name: 'test' } },
                layer: { id: 'my-layer' },
                x: 100,
                y: 200,
            }
            const result = pickInfoToResult(info)
            expect(result.latlng).toEqual({ lat: 40, lng: -120 })
            expect(result.layerId).toBe('my-layer')
            expect(result.pixel).toEqual({ x: 100, y: 200 })
            expect(result.feature).toEqual(info.object)
        })

        test('handles missing layer id', () => {
            const info = {
                picked: true,
                coordinate: [0, 0],
                object: {},
                x: 0,
                y: 0,
            }
            const result = pickInfoToResult(info)
            expect(result.layerId).toBeUndefined()
        })
    })

    test.describe('buildDeckLayer', () => {
        test('throws for unsupported layer type', () => {
            expect(() => buildDeckLayer('id', { type: 'unsupported' })).toThrow(
                'buildDeckLayer: unsupported layer type "unsupported"'
            )
        })

        test('error message lists all supported canonical types', () => {
            let msg = ''
            try { buildDeckLayer('id', { type: 'bad' }) } catch (e) { msg = e.message }
            expect(msg).toContain('tile')
            expect(msg).toContain('vector')
            expect(msg).toContain('vectortile')
            expect(msg).toContain('scatterplot')
            expect(msg).toContain('tile3d')
            expect(msg).toContain('pointcloud')
        })

        test('creates a PointCloudLayer for pointcloud type', () => {
            const layer = buildDeckLayer('pc-1', { type: 'pointcloud', url: '/data/cloud.las' })
            expect(layer.id).toBe('pc-1')
        })

        test('creates a PointCloudLayer via PointCloudLayer alias', () => {
            const layer = buildDeckLayer('pc-2', { type: 'PointCloudLayer', url: '/data/cloud.las' })
            expect(layer.id).toBe('pc-2')
        })

        test('creates a TileLayer for tile type', () => {
            const layer = buildDeckLayer('tile-1', {
                type: 'tile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            })
            expect(layer.id).toBe('tile-1')
        })

        test('creates a TileLayer via TileLayer alias', () => {
            const layer = buildDeckLayer('tile-2', {
                type: 'TileLayer',
                url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            })
            expect(layer.id).toBe('tile-2')
        })

        test('creates a GeoJsonLayer for vector type', () => {
            const layer = buildDeckLayer('vec-1', {
                type: 'vector',
                geojson: { type: 'FeatureCollection', features: [] },
            })
            expect(layer.id).toBe('vec-1')
        })

        test('creates a GeoJsonLayer via GeoJsonLayer alias', () => {
            const layer = buildDeckLayer('vec-2', {
                type: 'GeoJsonLayer',
                geojson: { type: 'FeatureCollection', features: [] },
            })
            expect(layer.id).toBe('vec-2')
        })

        test('creates an MVTLayer for vectortile type', () => {
            const layer = buildDeckLayer('mvt-1', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
            })
            expect(layer.id).toBe('mvt-1')
        })

        test('creates an MVTLayer via MVTLayer alias', () => {
            const layer = buildDeckLayer('mvt-2', {
                type: 'MVTLayer',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
            })
            expect(layer.id).toBe('mvt-2')
        })

        test('creates a ScatterplotLayer for scatterplot type', () => {
            const layer = buildDeckLayer('scatter-1', {
                type: 'scatterplot',
                data: [{ position: [0, 0] }],
            })
            expect(layer.id).toBe('scatter-1')
        })

        test('creates a ScatterplotLayer via ScatterplotLayer alias', () => {
            const layer = buildDeckLayer('scatter-2', {
                type: 'ScatterplotLayer',
                data: [{ position: [0, 0] }],
            })
            expect(layer.id).toBe('scatter-2')
        })

        test('creates a Tile3DLayer for tile3d type', () => {
            const layer = buildDeckLayer('t3d-1', {
                type: 'tile3d',
                url: 'https://example.com/tileset.json',
            })
            expect(layer.id).toBe('t3d-1')
        })

        test('creates a Tile3DLayer via Tile3DLayer alias', () => {
            const layer = buildDeckLayer('t3d-2', {
                type: 'Tile3DLayer',
                url: 'https://example.com/tileset.json',
            })
            expect(layer.id).toBe('t3d-2')
        })
    })

    test.describe('hexToRgba', () => {
        test('parses #RRGGBB hex string', () => {
            expect(hexToRgba('#ff0000')).toEqual([255, 0, 0, 255])
        })

        test('parses #RGB shorthand hex string', () => {
            expect(hexToRgba('#f00')).toEqual([255, 0, 0, 255])
        })

        test('overrides alpha with opacity argument', () => {
            const [r, g, b, a] = hexToRgba('#ffffff', 0.5)
            expect(r).toBe(255)
            expect(g).toBe(255)
            expect(b).toBe(255)
            expect(a).toBeCloseTo(128, 0)
        })

        test('opacity 0 yields alpha 0', () => {
            const [, , , a] = hexToRgba('#ffffff', 0)
            expect(a).toBe(0)
        })

        test('opacity 1 yields alpha 255', () => {
            const [, , , a] = hexToRgba('#000000', 1)
            expect(a).toBe(255)
        })

        test('returns defaultColor for null input', () => {
            const fallback = [100, 150, 200, 255]
            expect(hexToRgba(null, undefined, fallback)).toEqual(fallback)
        })

        test('returns defaultColor for unparseable string', () => {
            const fallback = [1, 2, 3, 4]
            expect(hexToRgba('not-a-color', undefined, fallback)).toEqual(fallback)
        })

        test('uses default fallback [255,255,255,255] when none provided', () => {
            expect(hexToRgba(null)).toEqual([255, 255, 255, 255])
        })

        test('parses CSS named color "red"', () => {
            expect(hexToRgba('red')).toEqual([255, 0, 0, 255])
        })
    })

    test.describe('DECKGL_TYPE_ALIAS', () => {
        test('GeoJsonLayer maps to vector', () => {
            expect(DECKGL_TYPE_ALIAS['GeoJsonLayer']).toBe('vector')
        })

        test('ScatterplotLayer maps to scatterplot', () => {
            expect(DECKGL_TYPE_ALIAS['ScatterplotLayer']).toBe('scatterplot')
        })

        test('TileLayer maps to tile', () => {
            expect(DECKGL_TYPE_ALIAS['TileLayer']).toBe('tile')
        })

        test('BitmapLayer maps to tile', () => {
            expect(DECKGL_TYPE_ALIAS['BitmapLayer']).toBe('tile')
        })

        test('Tile3DLayer maps to tile3d', () => {
            expect(DECKGL_TYPE_ALIAS['Tile3DLayer']).toBe('tile3d')
        })

        test('PointCloudLayer maps to pointcloud', () => {
            expect(DECKGL_TYPE_ALIAS['PointCloudLayer']).toBe('pointcloud')
        })

        test('MVTLayer maps to vectortile', () => {
            expect(DECKGL_TYPE_ALIAS['MVTLayer']).toBe('vectortile')
        })

        test('all values are lowercase strings', () => {
            for (const [key, value] of Object.entries(DECKGL_TYPE_ALIAS)) {
                expect(value).toBe(value.toLowerCase(), `${key} alias value should be lowercase`)
            }
        })
    })
})
