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
const { constructVectorLayer } = await import(
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
