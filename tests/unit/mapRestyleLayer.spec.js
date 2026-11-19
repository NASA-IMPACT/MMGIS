import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

const { default: Map_ } = await import('../../src/essence/Basics/Map_/Map_.js')
const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_.js')
const { buildDeckLayer } = await import(
    '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts'
)

/**
 * Map_.restyleLayer repaints a built vector layer from its current style
 * configuration, on whichever engine built it, keeping the data it holds.
 */
describe('Map_.restyleLayer', () => {
    const style = {
        fillColor: '#00ff00',
        colorBy: { mode: 'colormap', property: 'v', colormap: 'magma', min: 0, max: 1 },
    }
    const layerObj = { name: 'aqs', type: 'vector', style }
    let engine

    beforeEach(() => {
        engine = Map_.engine
        Map_.engine = { updateLayer: vi.fn() }
    })
    afterEach(() => {
        Map_.engine = engine
        L_.layers.layer = {}
    })

    test('clones a deck.gl layer and has the engine restyle its copy', () => {
        const built = buildDeckLayer('aqs', {
            type: 'vector',
            geojson: { type: 'FeatureCollection', features: [] },
            style: { fillColor: '#00ff00' },
        })
        L_.layers.layer = { aqs: built }

        expect(Map_.restyleLayer(layerObj)).toBe(true)

        const restyled = L_.layers.layer.aqs
        expect(restyled).not.toBe(built)
        expect(restyled.props.data).toBe(built.props.data)
        expect(Map_.engine.updateLayer).toHaveBeenCalledWith('aqs', {
            style,
            legend: undefined,
        })
    })

    test('re-runs a Leaflet GeoJSON layer\'s style function', () => {
        const styleFn = () => ({})
        const built = { options: { style: styleFn }, setStyle: vi.fn() }
        L_.layers.layer = { aqs: built }

        expect(Map_.restyleLayer(layerObj)).toBe(true)
        expect(built.setStyle).toHaveBeenCalledWith(styleFn)
    })

    test('gives a Leaflet vector tile layer fresh styles and redraws it', () => {
        const configured = {}
        const built = {
            options: { vectorTileLayerStyles: configured },
            redraw: vi.fn(),
        }
        L_.layers.layer = { aqs: built }

        expect(
            Map_.restyleLayer({ ...layerObj, type: 'vectortile' })
        ).toBe(true)
        expect(built.options.vectorTileLayerStyles).not.toBe(configured)
        expect(typeof built.options.vectorTileLayerStyles.anySourceLayer).toBe(
            'function'
        )
        expect(built.redraw).toHaveBeenCalledTimes(1)
    })

    test('does nothing for a layer not built', () => {
        L_.layers.layer = { aqs: false }
        expect(Map_.restyleLayer(layerObj)).toBe(false)
        expect(Map_.engine.updateLayer).not.toHaveBeenCalled()
    })
})
