import { describe, test, expect, beforeEach, vi } from 'vitest'

// LayerConstructors reaches Map_ transitively (L_ -> Description -> TimeControl
// -> Map_), and Map_ pulls in the JSX viewers that Vite will not parse from a
// .js file. constructVectorLayer takes Map_ as an argument rather than
// importing it, so a bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// constructVectorLayer hands its options to L.geoJson and then walks the
// layer it gets back. Capture the options so the style callback can be driven
// feature by feature, which is the whole of what these tests exercise.
//
// The module reads `window.L` once at import, so the stub has to be added to
// the object vitest.setup.js already installed rather than replacing it.
let capturedOptions = null
const installLeafletStub = () => {
    window.L.geoJson = (geojson, options) => {
        capturedOptions = options
        return { options: {}, _layers: {}, on: () => {}, eachLayer: () => {} }
    }
    window.L.icon = function () {}
}

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)
const { constructVectorLayer, colorByVectorTileStyles } = await import(
    '../../src/essence/Basics/Layers_/LayerConstructors.js'
)

/**
 * constructVectorLayer resolves the Leaflet vector path's per-feature style.
 * Legend styling was lifted out of it into LegendStyle (issue #345), and the
 * ordering it applies is expressed only through the shape of the code: a style
 * carried on the feature beats legend styling, which beats the layer's
 * configured `*Prop` and flat fields.
 */

const ramp = [
    {
        styleMatching: true,
        propertyName: 'co2',
        propertyValue: '400',
        shape: 'continuous',
        color: '#000000',
        strokecolor: '#111111',
    },
    {
        styleMatching: true,
        propertyName: 'co2',
        propertyValue: '440',
        shape: 'continuous',
        color: '#ffffff',
        strokecolor: '#eeeeee',
    },
]

const build = (style = {}, legend = ramp) => {
    const layerObj = {
        name: 'co2',
        type: 'vector',
        style: { className: '', ...style },
    }
    L_.layers.data = { co2: { name: 'co2', _legend: legend } }
    capturedOptions = null
    constructVectorLayer(
        { type: 'FeatureCollection', features: [] },
        layerObj,
        () => {},
        { map: {} }
    )
    return capturedOptions
}

// style() returns the shared layerObj.style object and mutates it in place, so
// each result has to be snapshotted before the next call.
const styleOf = (options, properties, extra = {}) => ({
    ...options.style({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties,
        ...extra,
    }),
})

describe('constructVectorLayer legend styling', () => {
    beforeEach(() => {
        installLeafletStub()
    })

    test('colours a feature from the legend ramp', () => {
        const options = build({ color: '#00ff00', fillColor: '#00ff00' })
        const style = styleOf(options, { co2: 420 })
        expect(style.fillColor).toBe('rgb(128, 128, 128)')
        expect(style.color).toBe('rgb(128, 128, 128)')
    })

    test('legend styling beats the configured colorProp and fillColorProp', () => {
        const options = build({
            color: '#00ff00',
            fillColor: '#00ff00',
            colorProp: 'strokeProp',
            fillColorProp: 'fillProp',
        })
        const style = styleOf(options, {
            co2: 400,
            strokeProp: '#ff0000',
            fillProp: '#ff0000',
        })
        expect(style.fillColor).toBe('#000000')
        expect(style.color).toBe('#111111')
    })

    test('a *Prop colour still applies to a feature the legend does not cover', () => {
        const options = build({
            color: '#00ff00',
            fillColor: '#00ff00',
            fillColorProp: 'fillProp',
        })
        const style = styleOf(options, { fillProp: '#ff0000' })
        expect(style.fillColor).toBe('#ff0000')
    })

    test('a style carried on the feature beats legend styling', () => {
        const options = build({ color: '#00ff00', fillColor: '#00ff00' })
        const style = styleOf(options, {
            co2: 400,
            style: { color: '#ff0000', fillColor: '#ff00ff' },
        })
        expect(style.color).toBe('#ff0000')
        expect(style.fillColor).toBe('#ff00ff')
    })

    test('feature.style.stroke beats legend styling', () => {
        const options = build({ color: '#00ff00', fillColor: '#00ff00' })
        const style = styleOf(
            options,
            { co2: 400 },
            { style: { stroke: '#ff0000', fill: '#ff00ff' } }
        )
        expect(style.color).toBe('#ff0000')
        expect(style.fillColor).toBe('#ff00ff')
    })

    test('resolves each feature independently, with no carry-over', () => {
        const options = build({ color: '#00ff00', fillColor: '#00ff00' })
        const matched = styleOf(options, { co2: 400 })
        const unmatched = styleOf(options, { co2: 'n/a' })
        expect(matched.fillColor).toBe('#000000')
        // The legend colour used to be written to a slot shared by every
        // feature, so it leaked into the fallback of every later feature.
        expect(unmatched.fillColor).toBe('#00ff00')
        expect(unmatched.color).toBe('#00ff00')
    })

    test('picks up a legend that is replaced after the layer is built', () => {
        // The compile is memoised on the legend array's identity, and a
        // `legend:` CSV path assigns _legend after construction. Noticing that
        // replacement is the entire reason the memo compares rather than
        // caching once.
        const options = build({ color: '#00ff00', fillColor: '#00ff00' }, null)
        expect(styleOf(options, { co2: 400 }).fillColor).toBe('#00ff00')

        L_.layers.data.co2._legend = ramp
        expect(styleOf(options, { co2: 400 }).fillColor).toBe('#000000')

        L_.layers.data.co2._legend = [
            { ...ramp[0], color: '#0000ff' },
            ramp[1],
        ]
        expect(styleOf(options, { co2: 400 }).fillColor).toBe('#0000ff')
    })
})

/**
 * `style.colorBy` (see ColorBy) rides the same per-feature resolution, ahead
 * of legend rows: a style carried on the feature beats it, and it beats legend
 * rows and the configured `*Prop` and flat fields.
 */
describe('constructVectorLayer colorBy styling', () => {
    beforeEach(() => {
        installLeafletStub()
    })

    const FRP_RANGES = [
        { min: 0, color: '#FEF0D9', label: '<10 MW' },
        { min: 10, color: '#FDCC8A', label: '10-49 MW' },
        { min: 50, color: '#FC8D59', label: '50-149 MW' },
        { min: 150, color: '#E34A33', label: '150-349 MW' },
        { min: 350, color: '#B30000', label: '≥350 MW' },
    ]
    const colorBy = (extra = {}) => ({
        mode: 'ranges',
        property: 'frp',
        ranges: FRP_RANGES,
        ...extra,
    })
    const fixed = { color: '#00ff00', fillColor: '#00ff00' }

    test('colours the fill by band and leaves the stroke fixed', () => {
        const options = build({ ...fixed, colorBy: colorBy() }, null)
        const style = styleOf(options, { frp: 10 })
        expect(style.fillColor).toBe('#FDCC8A')
        expect(style.color).toBe('#00ff00')
    })

    test('colours the stroke too when applyToStroke is set', () => {
        const options = build(
            { ...fixed, colorBy: colorBy({ applyToStroke: true }) },
            null
        )
        const style = styleOf(options, { frp: 400 })
        expect(style.fillColor).toBe('#B30000')
        expect(style.color).toBe('#B30000')
    })

    test('keeps the fixed colours for a value no band holds', () => {
        const options = build({ ...fixed, colorBy: colorBy() }, null)
        for (const properties of [{}, { frp: 'n/a' }, { frp: null }, { frp: -5 }]) {
            const style = styleOf(options, properties)
            expect(style.fillColor).toBe('#00ff00')
            expect(style.color).toBe('#00ff00')
        }
    })

    test('beats legend rows and fillColorProp', () => {
        const options = build({
            ...fixed,
            fillColorProp: 'fillProp',
            colorBy: colorBy({ property: 'co2' }),
        })
        const style = styleOf(options, { co2: 400, fillProp: '#ff0000' })
        expect(style.fillColor).toBe('#B30000')
        // Legend rows are not consulted for the stroke either.
        expect(style.color).toBe('#00ff00')
    })

    test('a style carried on the feature beats colorBy', () => {
        const options = build({ ...fixed, colorBy: colorBy() }, null)
        expect(
            styleOf(options, { frp: 400, style: { fillColor: '#ff00ff' } })
                .fillColor
        ).toBe('#ff00ff')
        expect(
            styleOf(options, { frp: 400 }, { style: { fill: '#ff00ff' } })
                .fillColor
        ).toBe('#ff00ff')
    })

    test('keeps the configured colours as the fallback across rebuilds', () => {
        // The style callback writes each feature's colours onto the layer's
        // own style object, and a refresh constructs the layer again from it.
        const layerObj = {
            name: 'co2',
            type: 'vector',
            style: { className: '', ...fixed, colorBy: colorBy() },
        }
        L_.layers.data = { co2: { name: 'co2' } }
        const construct = () => {
            capturedOptions = null
            constructVectorLayer(
                { type: 'FeatureCollection', features: [] },
                layerObj,
                () => {},
                { map: {} }
            )
            return capturedOptions
        }

        expect(styleOf(construct(), { frp: 400 }).fillColor).toBe('#B30000')
        const rebuilt = construct()
        const missing = styleOf(rebuilt, {})
        expect(missing.fillColor).toBe('#00ff00')
        expect(missing.color).toBe('#00ff00')

        // Nor does a feature carrying its own style leak into the next build.
        styleOf(rebuilt, { style: { fillColor: '#ff00ff', color: '#ff00ff' } })
        const again = styleOf(construct(), {})
        expect(again.fillColor).toBe('#00ff00')
        expect(again.color).toBe('#00ff00')
    })

    // The deck.gl vector accessors read a feature's own colours in the order
    // this path does. Each case is styled on a freshly built layer, because a
    // feature carrying its own style is merged over whatever the layer's style
    // object holds at the time.
    test.each([
        ['band only', { frp: 20 }, undefined, {}],
        ['no band, no own colour', {}, undefined, {}],
        [
            'properties.style colours',
            { frp: 20, style: { fillColor: '#ffff00', color: '#ff00ff' } },
            undefined,
            {},
        ],
        ['properties.style without colours', { frp: 20, style: { weight: 3 } }, undefined, {}],
        ['feature-level colours', { frp: 20 }, { fill: '#ffff00', stroke: '#ff00ff' }, {}],
        ['feature-level colours alone', {}, { fill: '#ffff00', stroke: '#ff00ff' }, {}],
        [
            'feature-level colours against *Prop',
            { c: '#ff0000' },
            { fill: '#ffff00', stroke: '#ff00ff' },
            { fillColorProp: 'c', colorProp: 'c' },
        ],
        [
            'band against *Prop and feature-level colours',
            { frp: 20, c: '#ff0000' },
            { fill: '#ffff00', stroke: '#ff00ff' },
            { fillColorProp: 'c', colorProp: 'c' },
        ],
    ])('colours a feature with %s the same as deck.gl', async (_label, properties, featureStyle, extra) => {
        const { buildDeckLayer, hexToRgba } = await import(
            '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts'
        )
        const style = {
            ...fixed,
            opacity: 1,
            fillOpacity: 1,
            colorBy: colorBy({ applyToStroke: true }),
            ...extra,
        }
        const feature = featureStyle ? { style: featureStyle } : {}
        const leaflet = styleOf(build(style, null), properties, feature)
        const deck = buildDeckLayer('parity-own', {
            type: 'vector',
            geojson: { type: 'FeatureCollection', features: [] },
            style,
        })
        const deckFeature = { properties, ...feature }
        expect(deck.props.getFillColor(deckFeature)).toEqual(
            hexToRgba(leaflet.fillColor, 1)
        )
        expect(deck.props.getLineColor(deckFeature)).toEqual(
            hexToRgba(leaflet.color, 1)
        )
    })

    test('ignores a colorBy mode this build does not implement', () => {
        const options = build({
            ...fixed,
            colorBy: colorBy({ mode: 'categories', property: 'co2' }),
        })
        // Legend rows style the layer exactly as with no colorBy at all.
        expect(styleOf(options, { co2: 400 }).fillColor).toBe('#000000')
    })

    test.each([0, 5, 9.999, 10, 49, 50, 149.99, 150, 349, 350, 5000])(
        'colours frp=%s the same as the deck.gl engine',
        async (value) => {
            const { buildDeckLayer, hexToRgba } = await import(
                '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts'
            )
            const style = { ...fixed, fillOpacity: 1, colorBy: colorBy() }
            const leaflet = styleOf(build(style, null), { frp: value })
            for (const type of ['vector', 'vectortile']) {
                const deck = buildDeckLayer(`parity-${type}`, {
                    type,
                    url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                    geojson: { type: 'FeatureCollection', features: [] },
                    style,
                })
                expect(
                    deck.props.getFillColor({ properties: { frp: value } })
                ).toEqual(hexToRgba(leaflet.fillColor, 1))
            }
        }
    )
})

/**
 * Leaflet.VectorGrid styles each feature from `vectorTileLayerStyles`, keyed
 * by the tile's source-layer name, falling back to Leaflet's path defaults for
 * a source layer the map names no style for.
 */
describe('colorByVectorTileStyles', () => {
    beforeEach(() => {
        window.L.Path = window.L.Path || {
            prototype: {
                options: { stroke: true, color: '#3388ff', weight: 3, fill: false },
            },
        }
    })

    const colorBy = (extra = {}) => ({
        mode: 'ranges',
        property: 'frp',
        ranges: [
            { min: 0, color: '#ff0000' },
            { min: 10, color: '#0000ff' },
        ],
        ...extra,
    })
    const base = { fill: true, fillColor: '#00ff00', color: '#00ff00', weight: 2 }

    test('hands the configured styles back untouched without colorBy', () => {
        const vtLayer = { fires: base }
        expect(colorByVectorTileStyles(vtLayer, undefined)).toBe(vtLayer)
        expect(
            colorByVectorTileStyles(vtLayer, colorBy({ mode: 'categories' }))
        ).toBe(vtLayer)
    })

    test('colours the fill of a configured style object by band', () => {
        const styles = colorByVectorTileStyles({ fires: base }, colorBy())
        expect(styles.fires({ frp: 12 }, 4)).toEqual({
            ...base,
            fillColor: '#0000ff',
        })
    })

    test('reads properties a geodataset tile packs into one string', () => {
        const styles = colorByVectorTileStyles({ fires: base }, colorBy())
        expect(
            styles.fires({ id: 1, properties: '{"frp":12}' }, 4).fillColor
        ).toBe('#0000ff')
    })

    test('keeps the configured style for a value no band holds', () => {
        const styles = colorByVectorTileStyles({ fires: base }, colorBy())
        expect(styles.fires({}, 4)).toEqual(base)
        expect(styles.fires({ frp: '12' }, 4)).toEqual(base)
        expect(styles.fires({ frp: -1 }, 4)).toEqual(base)
    })

    test('colours the stroke too when applyToStroke is set', () => {
        const styles = colorByVectorTileStyles(
            { fires: base },
            colorBy({ applyToStroke: true })
        )
        expect(styles.fires({ frp: 1 }, 4)).toMatchObject({
            fillColor: '#ff0000',
            color: '#ff0000',
        })
    })

    test('wraps a style function and every style of a style array', () => {
        const styles = colorByVectorTileStyles(
            {
                fn: (properties, zoom) => ({ ...base, weight: zoom }),
                many: [base, { ...base, weight: 5 }],
                hidden: [],
            },
            colorBy()
        )
        expect(styles.fn({ frp: 1 }, 7)).toEqual({
            ...base,
            weight: 7,
            fillColor: '#ff0000',
        })
        expect(styles.many({ frp: 1 }, 7).map((s) => s.fillColor)).toEqual([
            '#ff0000',
            '#ff0000',
        ])
        // An empty array hides the feature, and stays hidden.
        expect(styles.hidden({ frp: 1 }, 7)).toEqual([])
    })

    test('styles a source layer the configuration does not name', () => {
        const styles = colorByVectorTileStyles({}, colorBy())
        const style = styles.anything({ frp: 1 }, 4)
        expect(style.fillColor).toBe('#ff0000')
        // Leaflet's own path defaults stand in for the missing style, with
        // the fill they leave off turned on so the band colour shows.
        expect(style.weight).toBe(window.L.Path.prototype.options.weight)
        expect(style.fill).toBe(true)
        // A feature no band holds keeps the defaults, fill off included.
        expect(styles.anything({}, 4).fill).toBe(false)
    })

    test('fills a placed feature unless its configured style turns fill off', () => {
        const styles = colorByVectorTileStyles(
            {
                silent: { color: '#00ff00' },
                outlined: { color: '#00ff00', fill: false },
            },
            colorBy()
        )
        expect(styles.silent({ frp: 1 }, 4).fill).toBe(true)
        expect(styles.outlined({ frp: 1 }, 4).fill).toBe(false)
        expect(styles.silent({}, 4).fill).toBe(undefined)
    })

    test('does not change the configured styles object', () => {
        const vtLayer = { fires: base }
        colorByVectorTileStyles(vtLayer, colorBy()).fires({ frp: 1 }, 4)
        expect(vtLayer).toEqual({ fires: base })
        expect(base.fillColor).toBe('#00ff00')
    })

    test('hands VectorGrid the same function for a source layer every time', () => {
        // resetFeatureStyle looks the style up again after a highlight.
        const styles = colorByVectorTileStyles({ fires: base }, colorBy())
        expect(styles.fires).toBe(styles.fires)
    })
})
