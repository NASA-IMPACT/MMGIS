import { describe, test, expect, beforeEach, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_`, which each
// test assigns — so a bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * A legend given as a `legend:` CSV path is fetched after its layer is built.
 * Leaflet re-reads the legend for every feature it styles, but deck.gl bakes it
 * into the layer's style accessors at build time, so such a layer would render
 * flat colour forever while Leaflet rendered the ramp from identical config.
 * L_.applyLateLegendStyling closes that gap by rebuilding the layer.
 */

const stylingLegend = [
    {
        styleMatching: 'true',
        propertyName: 'co2',
        propertyValue: '400',
        shape: 'continuous',
        color: '#000000',
    },
    {
        styleMatching: 'true',
        propertyName: 'co2',
        propertyValue: '440',
        shape: 'continuous',
        color: '#ffffff',
    },
]

// A legend with rows to draw but no styling instructions — the common case.
const displayLegend = [{ shape: 'circle', color: '#ff0000', value: 'Station' }]

let refreshLayer

const setup = ({
    engineType = 'deckgl',
    type = 'vectortile',
    legend = stylingLegend,
    built = true,
    on = true,
} = {}) => {
    refreshLayer = vi.fn()
    L_.Map_ = { engine: { engineType }, refreshLayer }
    L_.layers.data = { co2: { name: 'co2', type, _legend: legend } }
    L_.layers.layer = { co2: built ? { id: 'co2', props: {} } : false }
    L_.layers.on = { co2: on }
}

describe('L_.applyLateLegendStyling', () => {
    beforeEach(() => {
        setup()
    })

    test('rebuilds a deck.gl layer whose legend arrived late', () => {
        L_.applyLateLegendStyling('co2')
        expect(refreshLayer).toHaveBeenCalledTimes(1)
        expect(refreshLayer.mock.calls[0][0].name).toBe('co2')
    })

    test.each([['vector'], ['query'], ['vectortile'], ['GeoJsonLayer'], ['MVTLayer']])(
        'rebuilds a %s layer',
        (type) => {
            setup({ type })
            L_.applyLateLegendStyling('co2')
            expect(refreshLayer).toHaveBeenCalledTimes(1)
        }
    )

    test('leaves Leaflet alone, which re-reads the legend per feature', () => {
        setup({ engineType: 'leaflet' })
        L_.applyLateLegendStyling('co2')
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('does not rebuild for a legend that only displays rows', () => {
        // Most legends are display-only. Rebuilding every layer carrying one
        // would be a lot of needless work on every mission load.
        setup({ legend: displayLegend })
        L_.applyLateLegendStyling('co2')
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('does not rebuild a layer type that ignores the legend', () => {
        setup({ type: 'tile' })
        L_.applyLateLegendStyling('co2')
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('does not rebuild a layer that was never built', () => {
        // It reads the legend itself whenever it is built.
        setup({ built: false })
        L_.applyLateLegendStyling('co2')
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('does not rebuild a layer that is toggled off', () => {
        // refreshLayer turns a layer on as a side effect.
        setup({ on: false })
        L_.applyLateLegendStyling('co2')
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('ignores a layer name it does not know', () => {
        expect(() => L_.applyLateLegendStyling('nope')).not.toThrow()
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    test('does nothing before the map engine exists', () => {
        L_.Map_ = null
        expect(() => L_.applyLateLegendStyling('co2')).not.toThrow()
    })
})
