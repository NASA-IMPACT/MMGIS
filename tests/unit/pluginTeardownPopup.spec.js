import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep Map_'s import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// The controller resolves tool ids against the real tool registry. One inert
// module is all a teardown needs: these specs are about what core releases
// when a tool goes, not about anything the tool itself does.
vi.mock('../../src/pre/tools', () => ({
    toolModules: { FakeTool: { make: () => {}, destroy: () => {} } },
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
 * Tearing a tool down is announced on the bus and answered by whoever holds a
 * resource the tool could have taken — today the map popup, which core closes
 * on any teardown at all. Neither side names the other, so pinning them apart
 * would prove nothing: this spec runs the real controller into the real bus
 * into the real popup service, and lets only the map engine be a stand-in.
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

const metadata = { id: 'FakeTool', name: 'Fake Tool' }

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

describe('a tool being torn down', () => {
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

    afterEach(() => {
        // loadedTools and the lifecycle registries are module-level singletons,
        // so a tool one test leaves loaded is a tool the next test inherits.
        ToolControllerModern_.destroyAllTools()
        const target = document.getElementById('fake-target')
        if (target) target.remove()
    })

    afterAll(() => {
        delete window.mmgisAPI
    })

    function loadFakeTool() {
        const target = document.createElement('div')
        target.id = 'fake-target'
        document.body.appendChild(target)
        ToolControllerModern_.loadTool(metadata, 'fake-target')
    }

    test('takes its own popup with it when it is unloaded on command', async () => {
        loadFakeTool()
        const { outcome, settled } = await showPopupAs('FakeTool')
        expect(cardCount()).toBe(1)

        // Unloading one plugin empties its container but never touches the
        // map, so a popup left behind would hang over a plugin that is gone.
        expect(ToolControllerModern_.unloadPlugin('FakeTool')).toBe(true)

        expect(cardCount()).toBe(0)
        await settled
        expect(outcome.result).toEqual({ action: 'closed' })
    })

    // A layout re-render destroys every tool without going near `Map_.init`,
    // which is the only other place a popup was ever dropped.
    test('takes the popup with it when the whole layout is destroyed', async () => {
        loadFakeTool()

        // Deliberately someone else's popup. There is one popup slot and no
        // ownership to consult at teardown, so a bystander's popup closes
        // too — told 'closed', which already means the popup went away
        // without the user acting on it.
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
        expect(ToolControllerModern_.unloadPlugin('FakeTool')).toBe(false)

        await flush()
        expect(cardCount()).toBe(1)
        expect(outcome.result).toBeNull()

        // The slot is a singleton shared with every other spec in this file.
        await mmgisAPI.forPlugin('crater-info').request('map:hidePopup')
    })
})
