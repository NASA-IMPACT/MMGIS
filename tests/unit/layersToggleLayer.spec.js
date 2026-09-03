import { describe, test, expect, beforeEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_`, which each
// test assigns — so a bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// Hiding the hover tooltip on toggle-off reaches into a div Map_ creates at
// init. Not the behaviour under test, and absent in this context.
vi.mock('../../src/essence/Ancillary/CursorInfo', () => ({
    default: { hide: vi.fn(), update: vi.fn() },
}))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * Turning a layer on and off.
 *
 * The engine holds every layer from creation, ranked and hidden, so a toggle
 * is one thing: tell the engine what to show. It is the same call on either
 * engine — how "off" is implemented (off the map, or a prop) belongs to the
 * adapter — and it re-applies nothing, because a held layer was told about
 * every opacity and config change while it was hidden.
 *
 * Time is the exception, and it is not the engine's fault: TimeControl skips
 * a layer that is switched off, so a layer shown after the time bar moved has
 * to ask for the current range itself.
 */

// An engine that holds what it is given and hides rather than removes.
const makeEngine = (engineType = MAP_ENGINE.DECKGL) => {
    const shown = new Set()
    return {
        engineType,
        registerLayer: vi.fn(),
        setLayerVisibility: vi.fn((id, visible) =>
            visible ? shown.add(id) : shown.delete(id)
        ),
        hasLayer: vi.fn((layer) => shown.has(layer?.id ?? layer)),
        addLayer: vi.fn(),
        updateLayer: vi.fn(),
        setLayerOpacity: vi.fn(),
        setLayerZIndex: vi.fn(),
        refreshLayer: vi.fn(() => true),
    }
}

const FLOOD = {
    name: 'Flood Extent',
    type: 'TileLayer',
    url: 'https://example.com/flood/{z}/{x}/{y}.png',
    tileformat: 'wmts',
    time: { enabled: false },
}

let engine
let reloadLayer

beforeEach(() => {
    engine = makeEngine()
    // Faithful to TimeControl.reloadLayer, which stamps the time it refreshed
    // the layer at. The toggle reaches two show paths for some layer types and
    // relies on that stamp to ask only once.
    reloadLayer = vi.fn(async (layer) => {
        layer.time.current = L_.TimeControl_.currentTime
        return true
    })
    L_.Map_ = {
        engine,
        map: { hasLayer: (layer) => engine.hasLayer(layer) },
        nativeLayer: (layer) =>
            layer && layer._deckLayer != null ? layer._deckLayer : layer,
        rmNotNull: vi.fn(),
    }
    // Toggling a layer off always tells the globe, whether or not one is
    // showing, so the stub has to answer.
    L_.Globe_ = { litho: { removeLayer: vi.fn(), toggleLayer: vi.fn() } }
    L_.activeFeature = null
    L_.missionPath = ''
    L_.TimeControl_ = {
        currentTime: '2026-06-01T00:00:00Z',
        performTimeUrlReplacements: async (url) => url,
        reloadLayer,
    }
    L_._layersOrdered = [FLOOD.name]
    L_.layers.data = { [FLOOD.name]: { ...FLOOD } }
    L_.layers.layer = { [FLOOD.name]: { id: FLOOD.name, props: { opacity: 1 } } }
    L_.layers.attachments = {}
    L_.layers.on = { [FLOOD.name]: false }
    L_.layers.opacity = { [FLOOD.name]: 1 }
})

describe('L_.layerZIndex', () => {
    // One derivation, because creation and re-ordering both rank layers and a
    // stack that disagrees with itself draws in the wrong order.
    test('ranks the top of the configured stack highest', () => {
        L_._layersOrdered = ['top', 'middle', 'bottom']

        expect(L_.layerZIndex('top')).toBeGreaterThan(L_.layerZIndex('middle'))
        expect(L_.layerZIndex('middle')).toBeGreaterThan(
            L_.layerZIndex('bottom')
        )
    })
})

describe('turning a layer on', () => {
    test('asks the engine to show it', async () => {
        await L_.toggleLayerHelper(L_.layers.data[FLOOD.name], false)

        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            FLOOD.name,
            true
        )
    })

    // The engine held and ranked the layer at creation, and was told every
    // opacity change while it was hidden. Re-applying either here is work
    // that buys nothing, and a re-rank re-sorts and re-pushes the whole stack.
    test('re-applies neither opacity nor rank', async () => {
        L_.layers.opacity[FLOOD.name] = 0.4

        await L_.toggleLayerHelper(L_.layers.data[FLOOD.name], false)

        expect(engine.setLayerOpacity).not.toHaveBeenCalled()
        expect(engine.setLayerZIndex).not.toHaveBeenCalled()
    })

    // The engine owns what "off" means, so the caller has one path for both.
    test('makes the same call under the Leaflet engine', async () => {
        engine.engineType = MAP_ENGINE.LEAFLET

        await L_.toggleLayerHelper(L_.layers.data[FLOOD.name], false)

        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            FLOOD.name,
            true
        )
        expect(engine.addLayer).not.toHaveBeenCalled()
        expect(engine.setLayerZIndex).not.toHaveBeenCalled()
    })
})

describe('turning a layer off', () => {
    test('asks the engine to hide it, on either engine', async () => {
        const layer = L_.layers.data[FLOOD.name]
        await L_.toggleLayerHelper(layer, false)
        engine.setLayerVisibility.mockClear()

        await L_.toggleLayerHelper(layer, true)

        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            FLOOD.name,
            false
        )
    })
})

/**
 * TimeControl.reloadLayer refreshes a layer only when it is switched on, so
 * every time step that happens while a layer is off passes it by. Whatever
 * the engine holds is then the range the layer was last shown with — or, for
 * a layer that has never been shown, the range it was built with.
 */
describe('catching a layer up on the time it missed', () => {
    const timeLayer = (over = {}) => ({
        ...FLOOD,
        time: { enabled: true, type: 'global', current: null },
        ...over,
    })

    test('asks for the current range when the layer is behind', async () => {
        const layer = timeLayer()
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer).toHaveBeenCalledTimes(1)
        expect(reloadLayer.mock.calls[0][0]).toBe(layer)
    })

    // The layer is still recorded as off while the toggle runs, and
    // reloadLayer refuses an off layer unless told otherwise.
    test('tells reloadLayer to act on a layer still recorded as off', async () => {
        const layer = timeLayer()
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer.mock.calls[0][1]).toBe(true)
    })

    // Every layer type, not just raster tiles: a vectortile layer resolves
    // its time the same way, through reloadLayer rewriting the URL the
    // rebuild reads.
    test('covers a vectortile layer too', async () => {
        const layer = timeLayer({ type: 'MVTLayer' })
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer).toHaveBeenCalledTimes(1)
    })

    // Some layer types pass two show paths in one toggle. reloadLayer stamps
    // the layer with the time it refreshed at, which is what keeps the second
    // pass from asking for a range the layer already has.
    test('asks once even when the toggle reaches two show paths', async () => {
        const layer = timeLayer()
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer).toHaveBeenCalledTimes(1)
    })

    test('does not ask when the layer is already at the current time', async () => {
        const layer = timeLayer({
            time: {
                enabled: true,
                type: 'global',
                current: L_.TimeControl_.currentTime,
            },
        })
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer).not.toHaveBeenCalled()
    })

    test('does not ask for a layer with no time enabled', async () => {
        await L_.toggleLayerHelper(L_.layers.data[FLOOD.name], false)

        expect(reloadLayer).not.toHaveBeenCalled()
    })

    // Caught up before being shown, not after. A layer that is behind still
    // holds the URL it was built with — placeholders and all — so showing it
    // first spends a burst of tile requests on a URL that was never going to
    // resolve, and only then rebuilds it. A layer that is already current
    // skips the catch-up entirely and appears at once.
    test('catches the layer up before showing it', async () => {
        const layer = timeLayer()
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer.mock.invocationCallOrder[0]).toBeLessThan(
            engine.setLayerVisibility.mock.invocationCallOrder[0]
        )
    })

    test('shows a layer that is already current without waiting', async () => {
        const layer = timeLayer({
            time: {
                enabled: true,
                type: 'global',
                current: L_.TimeControl_.currentTime,
            },
        })
        L_.layers.data[FLOOD.name] = layer

        await L_.toggleLayerHelper(layer, false)

        expect(reloadLayer).not.toHaveBeenCalled()
        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            FLOOD.name,
            true
        )
    })

    test('does not ask when the layer is being turned off', async () => {
        const layer = timeLayer()
        L_.layers.data[FLOOD.name] = layer
        await L_.toggleLayerHelper(layer, false)
        reloadLayer.mockClear()

        await L_.toggleLayerHelper(layer, true)

        expect(reloadLayer).not.toHaveBeenCalled()
    })
})
