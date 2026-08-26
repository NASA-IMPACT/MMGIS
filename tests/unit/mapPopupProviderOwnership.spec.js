import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep Map_'s import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

const { default: Map_ } = await import('../../src/essence/Basics/Map_/Map_')
const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_')
const { mapEngineRegistry } = await import(
    '../../src/essence/Basics/MapEngines/index'
)
const { mmgisAPI } = await import('../../src/essence/mmgisAPI/mmgisAPI')

/**
 * Popup ownership is decided in `MapPopup_` and stamped by `mmgisAPI`, but it
 * only works because `Map_.init` hands the caller from one to the other. Each
 * side is pinned against its own fake elsewhere; this spec is the join, so it
 * runs the real bus into the real providers into the real popup service and
 * lets only the map engine be a stand-in.
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

describe('the popup providers Map_ registers', () => {
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
