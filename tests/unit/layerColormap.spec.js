import { describe, test, expect } from 'vitest'
import {
    colormapKindOf,
    rasterColormapFields,
    readLayerColormap,
} from '../../src/essence/Basics/Layers_/layerColormap'

const raster = (fields = {}) => ({
    type: 'tile',
    url: 'COG:/data/a.tif',
    cogTransform: true,
    ...fields,
})

const vector = (colorBy, type = 'vector') => ({ type, style: { colorBy } })

describe('colormapKindOf', () => {
    test.each([['tile'], ['TileLayer'], ['BitmapLayer'], ['image']])(
        'a COG-transformed %s layer is a raster colormap',
        (type) => {
            expect(colormapKindOf(raster({ type }))).toBe('raster')
        }
    )

    test.each([['vector'], ['GeoJsonLayer'], ['vectortile'], ['MVTLayer']])(
        "a %s layer colouring by a colormap is a vector colormap",
        (type) => {
            expect(colormapKindOf(vector({ mode: 'colormap', property: 'v' }, type))).toBe(
                'vector'
            )
        }
    )

    test('anything else has no colormap', () => {
        expect(colormapKindOf({ type: 'tile' })).toBeNull()
        expect(colormapKindOf(vector({ mode: 'ranges', property: 'v' }))).toBeNull()
        expect(colormapKindOf({ type: 'vector' })).toBeNull()
        expect(colormapKindOf({ type: 'tile', style: { colorBy: { mode: 'colormap' } } })).toBeNull()
        expect(colormapKindOf(null)).toBeNull()
    })
})

// Existing raster configs carry their setting in cog* fields, and must read
// as they render today: no config change.
describe('readLayerColormap: rasters', () => {
    test('reads the configured ramp and range', () => {
        expect(
            readLayerColormap(
                raster({ cogColormap: 'RdBu', cogMin: '0', cogMax: 40, cogUnits: 'ppb' })
            )
        ).toEqual({
            name: 'RdBu',
            reversed: false,
            min: 0,
            max: 40,
            mode: 'continuous',
            unit: 'ppb',
            source: null,
        })
    })

    test('a `_r` name is the forward ramp reversed', () => {
        const setting = readLayerColormap(raster({ cogColormap: 'viridis_r' }))
        expect(setting.name).toBe('viridis')
        expect(setting.reversed).toBe(true)
    })

    test('what the running dashboard changed wins over the config', () => {
        expect(
            readLayerColormap(
                raster({
                    cogColormap: 'viridis',
                    currentCogColormap: 'magma_r',
                    cogMin: 0,
                    currentCogMin: 5,
                    cogMax: 10,
                    currentCogMax: 0,
                })
            )
        ).toMatchObject({ name: 'magma', reversed: true, min: 5, max: 0 })
    })

    test('no ramp configured is viridis; no range is null', () => {
        expect(readLayerColormap(raster())).toMatchObject({
            name: 'viridis',
            reversed: false,
            min: null,
            max: null,
        })
        expect(readLayerColormap(raster({ cogColormap: '' })).name).toBe('viridis')
    })

    test('reads an optional mode and source', () => {
        expect(
            readLayerColormap(
                raster({
                    cogColormap: 'nlcd_r',
                    cogColormapMode: 'categorical',
                    cogColormapSource: 'inline',
                })
            )
        ).toMatchObject({ name: 'nlcd', reversed: false, mode: 'categorical', source: 'inline' })
    })

    test('a layer with no colormap has no setting', () => {
        expect(readLayerColormap({ type: 'tile', cogColormap: 'viridis' })).toBeNull()
    })
})

describe('readLayerColormap: vectors', () => {
    test('reads style.colorBy', () => {
        expect(
            readLayerColormap(
                vector({
                    mode: 'colormap',
                    property: 'sample_measurement',
                    colormap: 'jet',
                    reversed: true,
                    min: 1,
                    max: 18,
                    unit: 'µg/m³',
                })
            )
        ).toEqual({
            name: 'jet',
            reversed: true,
            min: 1,
            max: 18,
            mode: 'continuous',
            unit: 'µg/m³',
            source: null,
        })
    })

    test('a categorical ramp is never reversed', () => {
        expect(
            readLayerColormap(
                vector({
                    mode: 'colormap',
                    property: 'ef',
                    colormap: 'tornado_ef_scale',
                    reversed: true,
                    colormapMode: 'categorical',
                })
            )
        ).toMatchObject({ reversed: false, mode: 'categorical' })
    })
})

describe('rasterColormapFields', () => {
    test('writes the runtime overrides, reversed as a `_r` name', () => {
        expect(
            rasterColormapFields({ name: 'viridis', reversed: true, min: 0, max: 5 })
        ).toEqual({ currentCogColormap: 'viridis_r', currentCogMin: 0, currentCogMax: 5 })
    })

    test('leaves an unset range alone', () => {
        expect(
            rasterColormapFields({ name: 'magma', reversed: false, min: null, max: null })
        ).toEqual({ currentCogColormap: 'magma' })
    })
})
