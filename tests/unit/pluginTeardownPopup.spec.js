import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep Map_'s import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// The controller resolves a tool's module binding against the real registry.
// Two inert tools are enough to tell a card's owner from a bystander.
vi.mock('../../src/pre/tools', () => ({
    toolModules: {
        CraterTool: { make: () => {}, destroy: () => {} },
        DrawTool: { make: () => {}, destroy: () => {} },
    },
}))

const { default: Map_ } = await import('../../src/essence/Basics/Map_/Map_')
const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_')
const { mapEngineRegistry } = await import(
    '../../src/essence/Basics/MapEngines/index'
)
const { mmgisAPI } = await import('../../src/essence/mmgisAPI/mmgisAPI')
const { toolModules } = await import('../../src/pre/tools')
const { default: ToolControllerModern_ } = await import(
    '../../src/essence/Basics/ToolController_/ToolControllerModern_'
)

/**
 * The popup service run the way the app runs it: the real controller and the
 * real bus into the real providers `Map_.init` registers, with only the map
 * engine a stand-in. Ownership is decided in `MapPopup_` and stamped by the
 * handle the controller injects, and teardown is announced on the bus with
 * neither side naming the other — so the joins are what these specs pin.
 */

/** Enough of an IMapEngine for `Map_.init` to finish and a popup to mount. */
function makeStubEngine() {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({
        top: 0,
        left: 0,
        width: 800,
        height: 600,
    })
    return {
        engineType: 'stub',
        init() {},
        destroy() {},
        getNativeMap: () => ({}),
        on() {},
        off() {},
        setView() {},
        invalidateSize() {},
        getZoom: () => 5,
        getCenter: () => ({ lat: 0, lng: 0 }),
        getBounds: () => null,
        getLayers: () => [],
        getContainer: () => container,
        latLngToContainerPoint: () => ({ x: 400, y: 300 }),
    }
}

const popupRequest = { latlng: { lat: 45, lng: -120 }, html: '<p>Crater A</p>' }

const cardCount = () => document.body.querySelectorAll('.mmgis-map-popup').length

/** Let the bus promises settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Load a tool through the controller, which mints and injects its handle. */
function loadTool(module, address) {
    const target = document.createElement('div')
    target.id = `${address}-target`
    document.body.appendChild(target)
    ToolControllerModern_.loadTool(
        { id: address, name: address, module },
        target.id
    )
}

/** Open a popup as a loaded tool would: through the handle core gave it. */
async function showPopupAs(module) {
    const outcome = { result: null }
    const settled = toolModules[module].api
        .request('map:showPopup', popupRequest)
        .then((result) => {
            outcome.result = result
        })
    await flush()
    return { outcome, settled }
}

beforeAll(() => {
    // Map_ captured `window.L` at import; init writes onto it.
    window.L.DomEvent = { fakeStop: () => {} }
    window.mmgisAPI = mmgisAPI

    L_.configData = { msv: { mapEngine: 'stub' }, look: {} }
    L_.layers = { data: {}, layer: {}, dataFlat: [], nameToUUID: {} }
    L_.view = [0, 0, 5]
    L_.FUTURES = { mapView: null }
    L_.UserInterface_ = { isMobile: true }

    class StubAdapter {
        constructor() {
            return makeStubEngine()
        }
    }
    mapEngineRegistry.register('stub', StubAdapter)

    Map_.init(() => {})
})

afterAll(() => {
    delete window.mmgisAPI
})

describe('a plugin being torn down', () => {
    afterEach(() => {
        // loadedTools and the lifecycle registries are module-level
        // singletons, so a tool one test leaves loaded is a tool the next
        // inherits — and so is the popup slot.
        ToolControllerModern_.destroyAllTools()
        document.querySelectorAll('[id$="-target"]').forEach((el) => el.remove())
    })

    test("takes the destroyed plugin's card with it and answers its request", async () => {
        loadTool('CraterTool', 'crater')
        const { outcome, settled } = await showPopupAs('CraterTool')
        expect(cardCount()).toBe(1)

        // The plugin is gone before it could retract the card itself, so core
        // empties the slot on the teardown it hears announced.
        expect(ToolControllerModern_.unloadPlugin('crater')).toBe(true)

        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })

    test("leaves another plugin's card standing", async () => {
        loadTool('CraterTool', 'crater')
        loadTool('DrawTool', 'draw')
        const { outcome } = await showPopupAs('DrawTool')
        expect(cardCount()).toBe(1)

        // The card belongs to a plugin that is still alive to stand behind it,
        // and the owner check is what tells the two apart.
        expect(ToolControllerModern_.unloadPlugin('crater')).toBe(true)

        await flush()
        expect(cardCount()).toBe(1)
        expect(outcome.result).toBeNull()
    })

    test('a full teardown empties the slot whoever owned it', async () => {
        loadTool('CraterTool', 'crater')
        // Opened without a handle, the way an embedding page or one of the
        // React tools opens one, so no per-plugin teardown can be matched to
        // it. A layout re-render destroys every tool without going near
        // `Map_`, and the collective signal is what empties the slot.
        const outcome = { result: null }
        const settled = mmgisAPI
            .request('map:showPopup', popupRequest)
            .then((result) => {
                outcome.result = result
            })
        await flush()
        expect(cardCount()).toBe(1)

        ToolControllerModern_.destroyAllTools()

        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })

    test('drops the popup when the map it is anchored to is re-initialised', async () => {
        loadTool('CraterTool', 'crater')
        const { outcome, settled } = await showPopupAs('CraterTool')
        expect(cardCount()).toBe(1)

        // Switching missions re-runs `Map_.init`, which destroys the engine the
        // card is anchored to and its subscriptions along with it. The card is
        // hosted beside the map container, so nothing else takes it down: it
        // has to leave with the map rather than hang over the new one.
        Map_.init(() => {})

        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })
})
