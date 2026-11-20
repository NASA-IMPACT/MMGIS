import { describe, test, expect } from 'vitest'
import {
    compileColorBy,
    resolveColorBy,
    resolveFeatureColors,
    readsColorBy,
} from '../../src/essence/Basics/Layers_/ColorBy'
import { compileLegendStyle } from '../../src/essence/Basics/Layers_/LegendStyle'
import { bundledColormapColors } from '../../src/essence/Basics/Colormaps/resolveColormapColors'
import { buildLayerLegend } from '../../src/essence/Basics/Layers_/legend/buildLayerLegend'

// The HMS fire classes, as Air4US needs them.
const FRP = {
    mode: 'ranges',
    property: 'frp',
    ranges: [
        { min: 0, color: '#FEF0D9', label: '<10 MW' },
        { min: 10, color: '#FDCC8A', label: '10-49 MW' },
        { min: 50, color: '#FC8D59', label: '50-149 MW' },
        { min: 150, color: '#E34A33', label: '150-349 MW' },
        { min: 350, color: '#B30000', label: '≥350 MW' },
    ],
}

// The AQS PM2.5 setting.
const PM25 = {
    mode: 'colormap',
    property: 'pm25',
    colormap: 'jet',
    min: 1,
    max: 18,
    unit: 'µg/m³',
}

const fill = (config, value) =>
    resolveColorBy(compileColorBy(config), { [config.property]: value })?.fillColor ?? null

describe('compileColorBy', () => {
    test.each([
        ['nothing', undefined],
        ['an unknown mode', { mode: 'categories', property: 'x' }],
        ['no property', { ...FRP, property: '' }],
        ['no usable band', { ...FRP, ranges: [{ min: 0, color: 'not-a-colour' }] }],
        ['a ramp the bundle lacks', { ...PM25, colormap: 'naqfc_pm25' }],
        ['max not above min', { ...PM25, min: 5, max: 5 }],
        ['a missing bound', { ...PM25, max: undefined }],
    ])('is null for %s', (_, config) => {
        expect(compileColorBy(config)).toBeNull()
    })

    test('sorts bands, keeps the later of two sharing a bound, and labels unlabelled ones', () => {
        const { bands } = compileColorBy({
            mode: 'ranges',
            property: 'v',
            ranges: [
                { min: 10, color: '#000' },
                { min: null, color: '#111' },
                { min: 10, color: '#222' },
                { min: '', color: '#333' },
            ],
        })
        expect(bands).toEqual([
            { min: null, color: '#111', label: '< 10' },
            { min: 10, color: '#222', label: '≥ 10' },
        ])
    })
})

describe('ranges', () => {
    test.each([
        [0, '#FEF0D9'],
        [9.99, '#FEF0D9'],
        [10, '#FDCC8A'],
        [349, '#E34A33'],
        [5000, '#B30000'],
    ])('places %s in its band, a boundary in the upper one', (value, color) => {
        expect(fill(FRP, value)).toBe(color)
    })

    test('leaves a value below a closed first band, or no number at all, unplaced', () => {
        expect(fill(FRP, -1)).toBeNull()
        expect(fill(FRP, '12')).toBeNull()
        expect(fill(FRP, null)).toBeNull()
        expect(resolveColorBy(compileColorBy(FRP), {})).toBeNull()
    })
})

describe('colormap', () => {
    const jet = bundledColormapColors('jet')

    test('scales a value across the ramp and clamps outside min and max', () => {
        expect(fill(PM25, 1)).toBe(jet[0])
        expect(fill(PM25, 9.5)).toBe(jet[Math.floor(0.5 * 255)])
        expect(fill(PM25, 18)).toBe(jet[255])
        expect(fill(PM25, -100)).toBe(jet[0])
        expect(fill(PM25, 100)).toBe(jet[255])
    })

    test('reverses with `reversed` or an `_r` name', () => {
        expect(fill({ ...PM25, reversed: true }, 1)).toBe(jet[255])
        expect(fill({ ...PM25, colormap: 'jet_r' }, 1)).toBe(jet[255])
    })

    test('leaves a missing value unplaced', () => {
        expect(fill(PM25, undefined)).toBeNull()
    })
})

describe('resolveColorBy and resolveFeatureColors', () => {
    test('colours the stroke only with applyToStroke', () => {
        const props = { frp: 400 }
        expect(resolveColorBy(compileColorBy(FRP), props)).toEqual({ fillColor: '#B30000' })
        expect(resolveColorBy(compileColorBy({ ...FRP, applyToStroke: true }), props)).toEqual({
            fillColor: '#B30000',
            color: '#B30000',
        })
    })

    test('lets colorBy replace legend rows outright, and uses rows without it', () => {
        const row = (value, color) => ({
            styleMatching: true,
            propertyName: 'frp',
            propertyValue: value,
            shape: 'continuous',
            color,
        })
        const legend = compileLegendStyle([row('0', '#000000'), row('100', '#ffffff')])
        expect(resolveFeatureColors(compileColorBy(FRP), legend, { frp: 0 })).toEqual({
            fillColor: '#FEF0D9',
        })
        // Not placed by colorBy, and the rows are not consulted.
        expect(resolveFeatureColors(compileColorBy(FRP), legend, { frp: -1 })).toBeNull()
        expect(resolveFeatureColors(null, legend, { frp: -1 })?.fillColor).toBeTruthy()
    })
})

describe('readsColorBy', () => {
    test('applies to vector layers, except vector tiles on Leaflet', () => {
        expect(readsColorBy('MVTLayer', 'deckgl')).toBe(true)
        expect(readsColorBy('vector', 'leaflet')).toBe(true)
        expect(readsColorBy('vectortile', 'leaflet')).toBe(false)
        expect(readsColorBy('tile', 'deckgl')).toBe(false)
    })
})

describe('buildLayerLegend for colorBy', () => {
    test('draws one swatch per band', async () => {
        const legend = await buildLayerLegend({ type: 'MVTLayer', style: { colorBy: FRP } })
        expect(legend.type).toBe('categorical')
        expect(legend.swatches).toHaveLength(5)
        expect(legend.swatches[4]).toEqual({ color: '#B30000', label: '≥350 MW' })
    })

    test('draws the ramp from min to max, with its unit', async () => {
        const legend = await buildLayerLegend({
            type: 'MVTLayer',
            style: { colorBy: PM25 },
            _legend: [{ shape: 'circle', color: '#000', value: 'ignored' }],
        })
        expect(legend).toMatchObject({
            type: 'gradient',
            min: 1,
            max: 18,
            unit: { label: 'µg/m³' },
            colormap: 'jet',
        })
        expect(legend.stops).toEqual(bundledColormapColors('jet'))
    })

    test('ignores colorBy where the engine does not paint it', async () => {
        const legend = await buildLayerLegend(
            { type: 'vectortile', style: { colorBy: FRP } },
            null,
            'leaflet'
        )
        expect(legend.type).toBe('none')
    })
})
