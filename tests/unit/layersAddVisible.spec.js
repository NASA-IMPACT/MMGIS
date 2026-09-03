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
 * L_.addVisible is the startup path for layers a mission configures visible. It
 * has to rank every one of them through the engine, the same set of layers
 * toggleLayerHelper ranks when a layer is turned back on: an unranked layer
 * sorts above the ranked stack in DeckGLAdapter, so a startup layer left
 * unranked jumps above its neighbours the first time one of them is re-ranked.
 *
 * deck.gl missions configure a layer by its deck.gl class name, so the ranking
 * must not be gated on the MMGIS type strings.
 */

// A deck.gl layer carries deck's `props` and never Leaflet's `options`.
const makeDeckLayer = (id) => ({ id, props: {} })

let setLayerZIndex

const setEngine = () => {
    setLayerZIndex = vi.fn()
    L_.Map_ = {
        engine: { addLayer: vi.fn(), setLayerZIndex },
        nativeLayer: (layer) =>
            layer && layer._deckLayer != null ? layer._deckLayer : layer,
    }
    // Layers configured by their MMGIS type also reach the globe.
    L_.Globe_ = { litho: { addLayer: vi.fn() } }
}

// `dataFlat` is ordered top-of-stack first, matching `_layersOrdered`.
const setLayers = (configs) => {
    L_.layers.dataFlat = configs
    L_.layers.layer = {}
    L_.layers.on = {}
    L_.layers.attachments = {}
    L_._layersOrdered = configs.map((c) => c.name)
    configs.forEach((c) => {
        L_.layers.on[c.name] = true
        L_.layers.layer[c.name] =
            c.built === false ? false : makeDeckLayer(c.name)
    })
}

const rankOf = (name) =>
    setLayerZIndex.mock.calls.find(([layer]) => layer.id === name)?.[1]

describe('L_.addVisible layer ranking', () => {
    beforeEach(() => {
        setEngine()
    })

    test('ranks a layer configured by its deck.gl class name', () => {
        setLayers([
            { name: 'Vec', type: 'GeoJsonLayer', url: 'vec.geojson' },
            { name: 'Base', type: 'TileLayer', url: '{z}/{x}/{y}.png' },
        ])

        L_.addVisible(null)

        expect(setLayerZIndex).toHaveBeenCalledTimes(2)
        expect(rankOf('Vec')).toBe(3)
        expect(rankOf('Base')).toBe(2)
    })

    test('ranks a layer configured by its MMGIS type', () => {
        setLayers([
            { name: 'Vec', type: 'vector', url: 'vec.geojson' },
            { name: 'Base', type: 'tile', url: '{z}/{x}/{y}.png' },
        ])

        L_.addVisible(null)

        expect(rankOf('Vec')).toBe(3)
        expect(rankOf('Base')).toBe(2)
    })

    test('ranks a layer above the layers under it in the ordering', () => {
        setLayers([
            { name: 'Vec', type: 'GeoJsonLayer', url: 'vec.geojson' },
            { name: 'Base', type: 'TileLayer', url: '{z}/{x}/{y}.png' },
        ])

        L_.addVisible(null)

        expect(rankOf('Vec')).toBeGreaterThan(rankOf('Base'))
    })

    test('skips a layer that failed to build', () => {
        setLayers([
            { name: 'Vec', type: 'GeoJsonLayer', url: 'vec.geojson' },
            {
                name: 'Broken',
                type: 'TileLayer',
                url: '{z}/{x}/{y}.png',
                built: false,
            },
        ])

        L_.addVisible(null)

        expect(setLayerZIndex).toHaveBeenCalledTimes(1)
        expect(rankOf('Vec')).toBe(3)
    })

    test('ranks only the named layer when given a subset', () => {
        setLayers([
            { name: 'Vec', type: 'GeoJsonLayer', url: 'vec.geojson' },
            { name: 'Base', type: 'TileLayer', url: '{z}/{x}/{y}.png' },
        ])

        L_.addVisible(null, ['Base'])

        expect(setLayerZIndex).toHaveBeenCalledTimes(1)
        expect(rankOf('Base')).toBe(2)
    })
})
