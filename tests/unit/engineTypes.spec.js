import { test, expect } from 'vitest'
import {
    MAP_ENGINE,
    ENGINE_LAYER_SUPPORT,
    engineSupportsLayer,
    DECKGL_TYPE_ALIAS,
    toCanonicalLayerType,
    isRasterTileLayerType,
} from '../../src/essence/Basics/MapEngines/types/engine.ts'

test.describe('engine types', () => {
    test.describe('engineSupportsLayer', () => {
        test('leaflet supports the MMGIS renderable types', () => {
            expect(engineSupportsLayer(MAP_ENGINE.LEAFLET, 'tile')).toBe(true)
            expect(engineSupportsLayer(MAP_ENGINE.LEAFLET, 'vector')).toBe(true)
        })

        test('deck.gl supports the deck.gl class names', () => {
            expect(engineSupportsLayer(MAP_ENGINE.DECKGL, 'TileLayer')).toBe(true)
            expect(engineSupportsLayer(MAP_ENGINE.DECKGL, 'GeoJsonLayer')).toBe(true)
        })

        test('an engine does not support the other engine spelling', () => {
            expect(engineSupportsLayer(MAP_ENGINE.LEAFLET, 'TileLayer')).toBe(false)
            expect(engineSupportsLayer(MAP_ENGINE.DECKGL, 'tile')).toBe(false)
        })

        test('every configured engine has a support list', () => {
            for (const engine of Object.values(MAP_ENGINE)) {
                expect(Array.isArray(ENGINE_LAYER_SUPPORT[engine])).toBe(true)
            }
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

    test.describe('toCanonicalLayerType', () => {
        test('maps a deck.gl class name to its MMGIS type', () => {
            expect(toCanonicalLayerType('BitmapLayer')).toBe('tile')
            expect(toCanonicalLayerType('MVTLayer')).toBe('vectortile')
        })

        test('passes an MMGIS type through unchanged', () => {
            expect(toCanonicalLayerType('tile')).toBe('tile')
            expect(toCanonicalLayerType('vector')).toBe('vector')
        })

        test('passes an unaliased value through unchanged', () => {
            expect(toCanonicalLayerType('SomeFutureLayer')).toBe('SomeFutureLayer')
        })

        test('returns undefined for a missing type', () => {
            expect(toCanonicalLayerType(undefined)).toBeUndefined()
            expect(toCanonicalLayerType(null)).toBeUndefined()
        })
    })

    test.describe('isRasterTileLayerType', () => {
        test('accepts tile layers however the config spells them', () => {
            expect(isRasterTileLayerType({ type: 'tile' })).toBe(true)
            expect(isRasterTileLayerType({ type: 'TileLayer' })).toBe(true)
            expect(isRasterTileLayerType({ type: 'BitmapLayer' })).toBe(true)
        })

        test('rejects non-raster layers, including other deck.gl tile-ish types', () => {
            expect(isRasterTileLayerType({ type: 'vector' })).toBe(false)
            expect(isRasterTileLayerType({ type: 'vectortile' })).toBe(false)
            expect(isRasterTileLayerType({ type: 'MVTLayer' })).toBe(false)
            expect(isRasterTileLayerType({ type: 'Tile3DLayer' })).toBe(false)
        })

        test('tolerates missing layers and missing types', () => {
            expect(isRasterTileLayerType(null)).toBe(false)
            expect(isRasterTileLayerType(undefined)).toBe(false)
            expect(isRasterTileLayerType({})).toBe(false)
        })
    })
})
