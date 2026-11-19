import { describe, test, expect, beforeAll, vi } from 'vitest'
import { color as parseColor } from 'd3'
import {
    compileColorBy,
    resolveColorBy,
    resolveFeatureColors,
    colorByColormapName,
    loadColormapRamp,
} from '../../src/essence/Basics/Layers_/ColorBy.ts'
import { resolveColormapColors } from '../../src/essence/Basics/Colormaps/resolveColormapColors.ts'
import { compileLegendStyle } from '../../src/essence/Basics/Layers_/LegendStyle.ts'

/**
 * `style.colorBy` colours a vector layer's features from one numeric property.
 * The `ranges` mode places each value in a band: the band with the greatest
 * lower bound at or below it, a boundary value taking the upper band, the last
 * band open above and the first optionally open below.
 */

// Fire radiative power in five published classes (ColorBrewer 5-class OrRd).
const FRP_RANGES = [
    { min: 0, color: '#FEF0D9', label: '<10 MW' },
    { min: 10, color: '#FDCC8A', label: '10-49 MW' },
    { min: 50, color: '#FC8D59', label: '50-149 MW' },
    { min: 150, color: '#E34A33', label: '150-349 MW' },
    { min: 350, color: '#B30000', label: '≥350 MW' },
]

const frp = (overrides = {}) => ({
    mode: 'ranges',
    property: 'frp',
    ranges: FRP_RANGES,
    ...overrides,
})

const fillFor = (config, properties) =>
    resolveColorBy(compileColorBy(config), properties)?.fillColor

describe('compileColorBy', () => {
    test('returns null when nothing is configured', () => {
        expect(compileColorBy(undefined)).toBe(null)
        expect(compileColorBy(null)).toBe(null)
        expect(compileColorBy('ranges')).toBe(null)
        expect(compileColorBy([])).toBe(null)
    })

    test('returns null for a mode it does not implement', () => {
        // A later mode configured against a build that lacks it leaves the
        // layer exactly as it would be with no colorBy at all.
        expect(compileColorBy(frp({ mode: 'categories' }))).toBe(null)
        expect(compileColorBy(frp({ mode: undefined }))).toBe(null)
    })

    test('returns null without a property to read', () => {
        expect(compileColorBy(frp({ property: undefined }))).toBe(null)
        expect(compileColorBy(frp({ property: '' }))).toBe(null)
    })

    test('returns null when no band is usable', () => {
        expect(compileColorBy(frp({ ranges: [] }))).toBe(null)
        expect(compileColorBy(frp({ ranges: undefined }))).toBe(null)
        expect(
            compileColorBy(
                frp({ ranges: [{ min: 'low', color: '#fff' }, { min: 3 }] })
            )
        ).toBe(null)
    })

    test('sorts bands by their lower bound', () => {
        const compiled = compileColorBy(
            frp({ ranges: [...FRP_RANGES].reverse() })
        )
        expect(compiled.bands.map((band) => band.min)).toEqual([
            0, 10, 50, 150, 350,
        ])
    })

    test('normalises a bare hex triplet the way legend rows do', () => {
        const compiled = compileColorBy(
            frp({ ranges: [{ min: 0, color: 'ff0000' }] })
        )
        expect(compiled.bands[0].color).toBe('#ff0000')
    })

    test('reads a numeric string bound', () => {
        const compiled = compileColorBy(
            frp({ ranges: [{ min: '10', color: '#000' }] })
        )
        expect(compiled.bands[0].min).toBe(10)
    })

    test('labels an unlabelled band from its bounds', () => {
        const compiled = compileColorBy(
            frp({
                ranges: [
                    { min: null, color: '#000' },
                    { min: 10, color: '#111' },
                    { min: 50, color: '#222' },
                ],
            })
        )
        expect(compiled.bands.map((band) => band.label)).toEqual([
            '< 10',
            '10 – 50',
            '≥ 50',
        ])
    })

    test('drops a band whose colour is not a colour', () => {
        const compiled = compileColorBy(
            frp({
                ranges: [
                    { min: 0, color: '#ff0000' },
                    { min: 10, color: '#ff00zz' },
                    { min: 20, color: 'notacolour' },
                    { min: 30, color: '' },
                ],
            })
        )
        expect(compiled.bands.map((band) => band.min)).toEqual([0])
        // The dropped bands' values fall in the band below them instead.
        expect(resolveColorBy(compiled, { frp: 25 })).toEqual({
            fillColor: '#ff0000',
        })
    })

    test('drops a band with a blank lower bound rather than opening it below', () => {
        const compiled = compileColorBy(
            frp({
                ranges: [
                    { min: 0, color: '#ff0000' },
                    { min: '', color: '#00ff00' },
                    { min: '   ', color: '#0000ff' },
                ],
            })
        )
        expect(compiled.bands).toEqual([
            { min: 0, color: '#ff0000', label: '≥ 0' },
        ])
        expect(resolveColorBy(compiled, { frp: -1 })).toBe(null)
    })

    test('labels a lone open band rather than leaving it blank', () => {
        const compiled = compileColorBy(
            frp({ ranges: [{ min: null, color: '#000' }] })
        )
        expect(compiled.bands[0].label).toBe('All values')
    })

    test('keeps the later band when two share a lower bound', () => {
        // One band per lower bound, so the legend lists exactly the colours
        // the map can draw.
        const compiled = compileColorBy(
            frp({
                ranges: [
                    { min: 10, color: '#111111' },
                    { min: 10, color: '#222222' },
                ],
            })
        )
        expect(compiled.bands).toHaveLength(1)
        expect(compiled.bands[0].color).toBe('#222222')
    })
})

describe('resolveColorBy in ranges mode', () => {
    test.each([
        [0, '#FEF0D9'],
        [5, '#FEF0D9'],
        [9.999, '#FEF0D9'],
        [10, '#FDCC8A'],
        [49, '#FDCC8A'],
        [50, '#FC8D59'],
        [149.99, '#FC8D59'],
        [150, '#E34A33'],
        [349, '#E34A33'],
        [350, '#B30000'],
        [5000, '#B30000'],
        [Infinity, '#B30000'],
    ])('places %s in its band', (value, expected) => {
        expect(fillFor(frp(), { frp: value })).toBe(expected)
    })

    test('gives a value exactly on a boundary the upper band', () => {
        for (const [i, band] of FRP_RANGES.entries()) {
            expect(fillFor(frp(), { frp: band.min })).toBe(FRP_RANGES[i].color)
        }
    })

    test('places values the same whatever order the bands were written in', () => {
        const shuffled = frp({
            ranges: [
                FRP_RANGES[3],
                FRP_RANGES[0],
                FRP_RANGES[4],
                FRP_RANGES[2],
                FRP_RANGES[1],
            ],
        })
        for (const value of [0, 9, 10, 75, 200, 1000]) {
            expect(fillFor(shuffled, { frp: value })).toBe(
                fillFor(frp(), { frp: value })
            )
        }
    })

    test('leaves a value below a closed first band to the fixed style', () => {
        expect(resolveColorBy(compileColorBy(frp()), { frp: -1 })).toBe(null)
        expect(
            resolveColorBy(compileColorBy(frp()), { frp: -Infinity })
        ).toBe(null)
    })

    test('catches everything below with an open first band', () => {
        const open = frp({
            ranges: [{ ...FRP_RANGES[0], min: null }, ...FRP_RANGES.slice(1)],
        })
        expect(fillFor(open, { frp: -1e9 })).toBe('#FEF0D9')
        expect(fillFor(open, { frp: -Infinity })).toBe('#FEF0D9')
        expect(fillFor(open, { frp: 10 })).toBe('#FDCC8A')
    })

    test.each([
        ['missing', {}],
        ['null', { frp: null }],
        ['undefined', { frp: undefined }],
        ['NaN', { frp: NaN }],
        ['a word', { frp: 'high' }],
        ['a numeric string', { frp: '20' }],
        ['a boolean', { frp: true }],
        ['an object', { frp: { value: 20 } }],
    ])('leaves a %s value to the fixed style', (_label, properties) => {
        expect(resolveColorBy(compileColorBy(frp()), properties)).toBe(null)
    })

    test('matches the property name case-sensitively', () => {
        // Sources that spell the property differently each name their own.
        expect(resolveColorBy(compileColorBy(frp()), { FRP: 20 })).toBe(null)
        expect(
            fillFor(frp({ property: 'FRP' }), { FRP: 20 })
        ).toBe('#FDCC8A')
    })

    test('colours the fill alone by default', () => {
        expect(resolveColorBy(compileColorBy(frp()), { frp: 20 })).toEqual({
            fillColor: '#FDCC8A',
        })
    })

    test('colours the stroke too when applyToStroke is set', () => {
        expect(
            resolveColorBy(compileColorBy(frp({ applyToStroke: true })), {
                frp: 20,
            })
        ).toEqual({ fillColor: '#FDCC8A', color: '#FDCC8A' })
    })

    test('returns null for absent inputs', () => {
        expect(resolveColorBy(null, { frp: 20 })).toBe(null)
        expect(resolveColorBy(compileColorBy(frp()), null)).toBe(null)
        expect(resolveColorBy(compileColorBy(frp()), undefined)).toBe(null)
    })
})

describe('resolveFeatureColors', () => {
    const kindLegend = compileLegendStyle([
        {
            styleMatching: true,
            propertyName: 'kind',
            propertyValue: 'station',
            color: '#00ff00',
        },
    ])

    test('uses legend rows when the layer has no colorBy', () => {
        expect(
            resolveFeatureColors(null, kindLegend, { kind: 'station' })
        ).toEqual({ fillColor: '#00ff00', color: '#00ff00' })
    })

    test('lets colorBy outrank legend rows', () => {
        expect(
            resolveFeatureColors(compileColorBy(frp()), kindLegend, {
                kind: 'station',
                frp: 20,
            })
        ).toEqual({ fillColor: '#FDCC8A' })
    })

    test('does not fall back to legend rows for a value colorBy leaves alone', () => {
        // The legend shown for a colorBy layer is its bands, so a colour the
        // rows would supply could appear on the map with nothing explaining it.
        expect(
            resolveFeatureColors(compileColorBy(frp()), kindLegend, {
                kind: 'station',
            })
        ).toBe(null)
    })

    test('returns null when neither applies', () => {
        expect(resolveFeatureColors(null, null, { frp: 20 })).toBe(null)
    })
})

describe('HMS fire: ranges against the legend-row configuration', () => {
    // The legend-row form of the same five classes: each colour written at
    // its class's lower edge and again just below the next class, the repeat
    // hidden from the legend, so linear interpolation stays flat inside each
    // class.
    const legendRows = FRP_RANGES.flatMap((band, i) => {
        const row = (value, extra = {}) => ({
            styleMatching: true,
            propertyName: 'frp',
            propertyValue: String(value),
            shape: 'continuous',
            color: band.color,
            ...extra,
        })
        const next = FRP_RANGES[i + 1]
        return next
            ? [row(band.min), row(next.min - 0.001, { hideFromLegend: true })]
            : [row(band.min)]
    })

    const rgb = (css) => {
        const { r, g, b } = parseColor(css).rgb()
        return [Math.round(r), Math.round(g), Math.round(b)]
    }

    test('writes the legend-row form the way the mission does', () => {
        expect(legendRows.map((row) => Number(row.propertyValue))).toEqual([
            0, 9.999, 10, 49.999, 50, 149.999, 150, 349.999, 350,
        ])
    })

    test.each([0, 5, 9.999, 10, 49, 50, 149.99, 150, 349, 350, 5000])(
        'colours frp=%s the same both ways',
        (value) => {
            const fromRows = resolveFeatureColors(
                null,
                compileLegendStyle(legendRows),
                { frp: value }
            )
            const fromRanges = resolveFeatureColors(
                compileColorBy(frp()),
                null,
                { frp: value }
            )
            expect(rgb(fromRanges.fillColor)).toEqual(rgb(fromRows.fillColor))
        }
    )
})

/**
 * The `colormap` mode scales a numeric value linearly between `min` and `max`
 * across a named ramp's 256 colours, clamping at both ends.
 */
describe('colorBy colormap', () => {
    const colormap = (fields = {}) => ({
        mode: 'colormap',
        property: 'pm25',
        colormap: 'viridis',
        min: 0,
        max: 255,
        ...fields,
    })
    const fill = (compiled, value) =>
        resolveColorBy(compiled, { pm25: value })?.fillColor ?? null

    let viridis
    beforeAll(async () => {
        viridis = await resolveColormapColors('viridis', null)
        await loadColormapRamp('viridis', null)
        await loadColormapRamp('viridis_r', null)
    })

    test('maps a value to floor(t * 255) of the ramp', () => {
        const compiled = compileColorBy(colormap({ min: 0, max: 10 }))
        expect(fill(compiled, 0)).toBe(viridis[0])
        expect(fill(compiled, 5)).toBe(viridis[127])
        expect(fill(compiled, 10)).toBe(viridis[255])
    })

    test('clamps values outside min and max to the end colours', () => {
        const compiled = compileColorBy(colormap({ min: 1, max: 18 }))
        expect(fill(compiled, -40)).toBe(viridis[0])
        expect(fill(compiled, 1e9)).toBe(viridis[255])
        expect(fill(compiled, Infinity)).toBe(viridis[255])
    })

    test.each([
        ['an _r name', { colormap: 'viridis_r' }],
        ['reversed: true', { reversed: true }],
        ['both together', { colormap: 'viridis_r', reversed: true }],
    ])('%s reverses the ramp', (_, fields) => {
        const compiled = compileColorBy(colormap(fields))
        expect(compiled.colormap).toBe('viridis_r')
        expect(fill(compiled, 0)).toBe(viridis[255])
        expect(fill(compiled, 255)).toBe(viridis[0])
    })

    test.each([
        ['missing', undefined],
        ['null', null],
        ['a numeric string', '7'],
        ['NaN', NaN],
    ])('places no feature whose value is %s', (_, value) => {
        expect(fill(compileColorBy(colormap()), value)).toBeNull()
    })

    test('colours only the fill unless applyToStroke is set', () => {
        expect(resolveColorBy(compileColorBy(colormap()), { pm25: 0 })).toEqual({
            fillColor: viridis[0],
        })
        expect(
            resolveColorBy(compileColorBy(colormap({ applyToStroke: true })), {
                pm25: 0,
            })
        ).toEqual({ fillColor: viridis[0], color: viridis[0] })
    })

    test('places nothing until its ramp has been loaded', async () => {
        const compiled = compileColorBy(colormap({ colormap: 'magma' }))
        expect(compiled.colors).toBeNull()
        expect(fill(compiled, 3)).toBeNull()

        await loadColormapRamp('magma', null)
        expect(fill(compileColorBy(colormap({ colormap: 'magma' })), 0)).toBe(
            (await resolveColormapColors('magma', null))[0]
        )
    })

    test('keeps no custom ramp the service failed to supply', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockRejectedValueOnce(new Error('service down'))
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ 0: [255, 0, 0, 255], 1: [0, 0, 255, 255] }),
                })
        )
        const custom = colormap({ colormap: 'site_ramp' })
        try {
            // The fallback paints meanwhile, but is not taken for the ramp.
            expect(await loadColormapRamp('site_ramp', 'https://titiler.test')).toEqual(viridis)
            expect(compileColorBy(custom).colors).toBeNull()

            // Past the service's failure window the ramp is asked for again.
            vi.setSystemTime(Date.now() + 61000)
            const ramp = ['rgba(255, 0, 0, 1)', 'rgba(0, 0, 255, 1)']
            expect(await loadColormapRamp('site_ramp', 'https://titiler.test')).toEqual(ramp)
            expect(compileColorBy(custom).colors).toEqual(ramp)
        } finally {
            vi.useRealTimers()
            vi.unstubAllGlobals()
        }
    })

    test.each([
        ['no ramp', { colormap: '' }],
        ['no min', { min: undefined }],
        ['a blank max', { max: '' }],
        ['max equal to min', { min: 5, max: 5 }],
        ['max below min', { min: 5, max: 1 }],
    ])('compiles to null with %s', (_, fields) => {
        expect(compileColorBy(colormap(fields))).toBeNull()
    })

    test('names the ramp it paints with, for colormap settings only', () => {
        expect(colorByColormapName(colormap({ colormap: 'Jet' }))).toBe('Jet')
        expect(colorByColormapName(colormap({ reversed: true }))).toBe(
            'viridis_r'
        )
        expect(colorByColormapName({ mode: 'ranges', colormap: 'jet' })).toBeNull()
        expect(colorByColormapName(null)).toBeNull()
    })
})
