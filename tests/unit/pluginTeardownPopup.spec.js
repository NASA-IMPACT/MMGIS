import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep Map_'s import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// The controller reaches a tool's class through its module binding in the real
// tool registry. Two inert modules cover what a teardown can meet: a tool that
// hands back nothing, and a tool that retracts its own popup in destroy(), the
// way a well-behaved plugin does — through the handle the controller injected,
// which is still its to use while destroy() runs.
vi.mock('../../src/pre/tools', () => ({
    toolIds: {},
    toolModules: {
        FakeTool: { make: () => {}, destroy: () => {} },
        RetractingTool: {
            make: () => {},
            destroy() {
                this.api.request('map:hidePopup').catch(() => {})
            },
        },
    },
}))

const { default: Map_ } = await import('../../src/essence/Basics/Map_/Map_')
const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_')
const { mapEngineRegistry } = await import(
    '../../src/essence/Basics/MapEngines/index'
)
const { mmgisAPI } = await import('../../src/essence/mmgisAPI/mmgisAPI')
const { default: ToolControllerModern_ } = await import(
    '../../src/essence/Basics/ToolController_/ToolControllerModern_'
)

/**
 * The popup service run the way the app runs it: the real controller and the
 * real bus into the real providers `Map_.init` registers, with only the map
 * engine a stand-in. Ownership is decided in `MapPopup_` and stamped by
 * `mmgisAPI`, but it only works because `Map_.init` hands the caller from one
 * to the other — and teardown is announced on the bus with neither side naming
 * the other — so the joins are what these specs pin.
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

const popupRequest = {
    latlng: { lat: 45, lng: -120 },
    html: '<p>Crater A</p>',
}

const cardCount = () =>
    document.body.querySelectorAll('.mmgis-map-popup').length

/** Let the bus promises settle and the popup's deferred wiring run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Open a popup as `pluginId` and hand back how its request settles. */
async function showPopupAs(pluginId) {
    const outcome = { result: null }
    const settled = mmgisAPI
        .forPlugin(pluginId)
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

describe('a tool being torn down', () => {
    afterEach(() => {
        // loadedTools and the lifecycle registries are module-level singletons,
        // so a tool one test leaves loaded is a tool the next test inherits.
        ToolControllerModern_.destroyAllTools()
        document.getElementById('fake-target')?.remove()
        document.getElementById('retracting-target')?.remove()
    })

    function loadTool(toolId, toolModule, targetId) {
        const target = document.createElement('div')
        target.id = targetId
        document.body.appendChild(target)
        ToolControllerModern_.loadTool(
            { id: toolId, module: toolModule, name: toolModule }, targetId
        )
    }

    test('takes its own card with it and answers its request', async () => {
        loadTool('fake', 'FakeTool', 'fake-target')
        const { outcome, settled } = await showPopupAs('fake')
        expect(cardCount()).toBe(1)

        // FakeTool's destroy() hands nothing back, so the card only goes if
        // core reads the teardown announcement: it names the id the popup is
        // owned by, which is all a close needs to be aimed rather than blanket.
        expect(ToolControllerModern_.unloadPlugin('fake')).toBe(true)

        await flush()
        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })

    test("leaves another plugin's card standing", async () => {
        loadTool('fake', 'FakeTool', 'fake-target')

        // Deliberately someone else's popup: 'crater-info' is not the plugin
        // being unloaded, and it is alive to stand behind its card. The close
        // is owner-gated, so the id the announcement carries reaches only the
        // departing plugin's own popup.
        const { outcome } = await showPopupAs('crater-info')
        expect(cardCount()).toBe(1)

        expect(ToolControllerModern_.unloadPlugin('fake')).toBe(true)

        await flush()
        expect(cardCount()).toBe(1)
        expect(outcome.result).toBeNull()

        // The slot is a singleton shared with every other spec in this file.
        await mmgisAPI.forPlugin('crater-info').request('map:hidePopup')
    })

    test('may retract its own card in destroy() before core does', async () => {
        loadTool('retracting', 'RetractingTool', 'retracting-target')
        const { outcome, settled } = await showPopupAs('retracting')
        expect(cardCount()).toBe(1)

        // Unloading one plugin runs its destroy() first, where this plugin
        // hands the popup slot back itself — safely, because core retracts a
        // popup only for the caller that opened it. The teardown announcement
        // that follows finds an empty slot and leaves it empty.
        expect(ToolControllerModern_.unloadPlugin('retracting')).toBe(true)

        await flush()
        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })

    // A layout re-render destroys every tool without going near `Map_.init`,
    // which is the only other place a popup is ever dropped. With every plugin
    // gone the popup's owner is among the departed whether or not the slot is
    // held by one of them, so the collective signal empties it outright.
    test('a full teardown takes a popup no plugin claims with it', async () => {
        loadTool('fake', 'FakeTool', 'fake-target')

        // 'crater-info' is nobody the sweep names, so only the collective
        // signal can account for this card going away.
        const { outcome, settled } = await showPopupAs('crater-info')
        expect(cardCount()).toBe(1)

        ToolControllerModern_.destroyAllTools()

        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })

    test('leaves the map alone when there was no tool to destroy', async () => {
        const { outcome } = await showPopupAs('crater-info')
        expect(cardCount()).toBe(1)

        // Nothing is loaded, so nothing is announced and the popup stands.
        ToolControllerModern_.destroyAllTools()
        expect(ToolControllerModern_.unloadPlugin('fake')).toBe(false)

        await flush()
        expect(cardCount()).toBe(1)
        expect(outcome.result).toBeNull()

        await mmgisAPI.forPlugin('crater-info').request('map:hidePopup')
    })
})

describe('the popup providers Map_ registers', () => {
    test('answer a retract only for the plugin whose popup is showing', async () => {
        const aoi = mmgisAPI.forPlugin('aoi')
        const draw = mmgisAPI.forPlugin('draw')

        let outcome = null
        const shown = aoi
            .request('map:showPopup', popupRequest)
            .then((result) => {
                outcome = result
            })
        await flush()
        expect(cardCount()).toBe(1)

        // Someone else's retract finds a popup that is not theirs.
        await expect(draw.request('map:hidePopup')).resolves.toBe(false)
        await flush()
        expect(cardCount()).toBe(1)
        expect(outcome).toBeNull()

        // The plugin that opened it gets its popup back, and its still-pending
        // show request is told how the popup went away.
        await expect(aoi.request('map:hidePopup')).resolves.toBe(true)
        await shown
        expect(cardCount()).toBe(0)
        expect(outcome).toEqual({ action: 'closed' })
    })

    test('drop the popup when the map it is anchored to is re-initialised', async () => {
        const inspect = mmgisAPI.forPlugin('inspect')

        let outcome = null
        inspect.request('map:showPopup', popupRequest).then((result) => {
            outcome = result
        })
        await flush()
        expect(cardCount()).toBe(1)

        // Switching missions re-runs `Map_.init`, which destroys the engine the
        // card is anchored to and its subscriptions along with it. The card is
        // hosted on `document.body`, so nothing else takes it down: it has to
        // leave with the map rather than hang over the new one, and the plugin
        // still waiting on its show request has to hear that it is gone.
        Map_.init(() => {})
        expect(cardCount()).toBe(0)

        await flush()
        expect(outcome).toEqual({ action: 'closed' })
    })
})
