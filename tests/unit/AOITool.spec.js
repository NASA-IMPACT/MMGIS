import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// The panel component pulls in @trussworks/react-uswds and a SCSS entry point;
// nothing here renders it.
vi.mock('../../src/essence/Tools/AOI/AOIComponent', () => ({ default: () => null }))
vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render() { }, unmount() { } }),
}))

import AOITool from '../../src/essence/Tools/AOI/AOITool'

const polygon = (ring) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
})

// Centroid (5, 5), bounds [0, 0, 10, 10].
const SQUARE = polygon([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]])
// Centroid (25, 25), so a superseding selection is distinguishable.
const FAR_SQUARE = polygon([[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]])

// The view `map:getBounds` reports. It holds neither square, so every
// selection here overflows it and the popup waits on a camera move — the
// path this file is about.
const VIEW = {
    southWest: { lat: -40, lng: -40 },
    northEast: { lat: -30, lng: -30 },
}

/**
 * Stand-ins for the global bus (`window.mmgisAPI`) and the handle the
 * controller injects as `AOITool.api` — which is what the plugin subscribes,
 * requests and emits through. Calls are recorded; the popup impls model core's
 * one-slot contract, every show being answered on its own promise with how its
 * popup closed.
 */
function makeFakeApi() {
    const listeners = new Map()
    const requests = []
    const emits = []
    const provided = new Map()
    const requestImpl = new Map()

    let openPopup = null
    const settleOpen = (action) => {
        if (!openPopup) return
        const { resolve } = openPopup
        openPopup = null
        resolve({ action })
    }

    const api = {
        on(event, handler) {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event).add(handler)
            return () => api.off(event, handler)
        },
        off(event, handler) {
            const set = listeners.get(event)
            if (set) set.delete(handler)
        },
        emit(event, data) {
            emits.push({ event, data })
            // Snapshot: a handler may unsubscribe itself while dispatching.
            Array.from(listeners.get(event) || []).forEach((h) => h(data))
        },
        // The provider runs inside the call, before the promise is handed
        // back, as core's does. It is handed the caller's address the way core
        // hands it over, in a context argument; a bare bus request has none.
        request(name, payload, options) {
            const caller = options?.caller ?? null
            requests.push({ name, payload, caller })
            const impl = requestImpl.get(name)
            try {
                return Promise.resolve(impl ? impl(payload, { caller }) : true)
            } catch (err) {
                return Promise.reject(err)
            }
        },
        provide(name, handler) {
            provided.set(name, handler)
            return () => provided.delete(name)
        },

        // A plugin's bus handle, as `mintHandle` builds it: emits and provides
        // are prefixed with the plugin's address, requests keep their full name
        // and are stamped with it, and `on` hands back the disposer for the
        // subscription it made.
        handleFor(address) {
            const prefix = `plugin:${address}:`
            return {
                address,
                on: (event, handler) => api.on(event, handler),
                emit: (event, data) => api.emit(prefix + event, data),
                provide: (name, handler) => api.provide(prefix + name, handler),
                request: (name, data) => api.request(name, data, { caller: address }),
                release: () => { },
            }
        },

        // Test-only accessors.
        requestImpl,
        listenerCount: (event) => listeners.get(event)?.size || 0,
        namesOf: (name) => requests.filter((r) => r.name === name),
        emitsOf: (event) => emits.filter((e) => e.event === event),
        getSelection: () => provided.get('plugin:aoi:getCurrentSelection')?.(),
        /** Close the open popup the way core would, answering its request. */
        closePopup: (action) => settleOpen(action),
        hasOpenPopup: () => openPopup !== null,
        reset() {
            requests.length = 0
            emits.length = 0
        },
    }

    requestImpl.set('map:getBounds', () => VIEW)
    // Showing takes the slot and records whose popup it now is.
    requestImpl.set('map:showPopup', (payload, { caller }) => {
        settleOpen('closed')
        return new Promise((resolve) => {
            openPopup = { payload, resolve, owner: caller }
        })
    })
    // Hiding reaches only the caller's own popup, as core's does.
    requestImpl.set('map:hidePopup', (payload, { caller }) => {
        if (!openPopup || openPopup.owner !== caller) return false
        settleOpen('closed')
        return true
    })

    return api
}

let api

/**
 * Let queued microtasks (bus request promises) run. A selection chains several
 * of them — reading the camera, then deciding the fit — so one tick is not
 * enough to reach the state a test is about to assert on.
 */
const flush = async () => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0)
}

/** Make a selection and let its deferred popup open. */
async function selectAndOpen(feature, label) {
    AOITool._applySelection(feature, 'search', label)
    // The camera is read before the popup is armed to wait on `map:moveend`.
    await flush()
    api.emit('map:moveend')
    await flush()
}

beforeEach(async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    container.id = 'toolPanel'
    document.body.appendChild(container)

    api = makeFakeApi()
    window.mmgisAPI = api
    // The controller mints this handle and injects it before make() runs.
    AOITool.api = api.handleFor('aoi')

    AOITool.make('toolPanel')
    await flush()
    api.reset()
})

afterEach(() => {
    AOITool.destroy()
    const container = document.getElementById('toolPanel')
    if (container) container.remove()
    delete AOITool.api
    delete window.mmgisAPI
    vi.useRealTimers()
})

describe('AOITool popup requests', () => {
    test('asks core for the analyze/cancel popup at the feature centroid, once the camera settles', async () => {
        // A label holding markup goes to core as it was written: core renders
        // a title as text, so escaping one here would put the escapes
        // themselves on the card.
        AOITool._applySelection(SQUARE, 'search', 'Smith & <b>Sons</b>')
        await flush()
        expect(api.namesOf('map:showPopup')).toHaveLength(0)

        api.emit('map:moveend')

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        const payload = shows[0].payload
        expect(payload.latlng).toEqual({ lat: 5, lng: 5 })
        expect(payload.title).toBe('Smith & <b>Sons</b>')
        // Labels only: the outcome comes back on the request's promise, so the
        // plugin names no events for core to broadcast — and no body at all,
        // the card being the title over its two buttons.
        expect(payload.primaryAction).toEqual({ label: 'Analyze area' })
        expect(payload.secondaryAction).toEqual({ label: 'Cancel' })
        expect('html' in payload).toBe(false)

        // The request must survive a postMessage boundary: data only, no
        // functions crossing into core.
        expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
    })

    test('lets the next selection replace the open card, keeping the new selection', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        expect(api.hasOpenPopup()).toBe(true)
        api.reset()

        // The replacement answers the first request with 'closed', which must
        // not be read as the user abandoning the selection just made. Nothing
        // is retracted on the way: only a click on empty map dismisses a card,
        // and the click that picks a boundary is a click on a feature.
        await selectAndOpen(FAR_SQUARE, 'Alaska')

        expect(api.namesOf('map:hidePopup')).toHaveLength(0)
        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.title).toBe('Alaska')
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(0)
        expect(api.getSelection()).toMatchObject({ feature: FAR_SQUARE })
    })

    test('catches the moveend a transitionless fit emits inside its own request', async () => {
        // An engine with no transition to run ends the camera move inside the
        // `map:fitBounds` call itself, so the plugin has to be listening
        // before it asks for the fit — a listener added afterwards hears
        // nothing and leaves the card to the 1.5s fallback timer.
        api.requestImpl.set('map:fitBounds', () => {
            api.emit('map:moveend', { longitude: 5, latitude: 5, zoom: 4 })
            return true
        })

        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        // `flush` advances the clock by nothing, so the fallback timer cannot
        // be what opened this.
        await flush()

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.latlng).toEqual({ lat: 5, lng: 5 })
        expect(api.listenerCount('map:moveend')).toBe(0)
    })
})

describe('AOITool popup outcomes', () => {
    test('a primary press hands the selected feature to the analysis consumers', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.reset()

        api.closePopup('primary')
        await flush()

        const ready = api.emitsOf('plugin:aoi:analysisAOIReady')
        expect(ready).toHaveLength(1)
        expect(ready[0].data).toEqual({ feature: SQUARE })
        // Analyzing keeps the selection; only cancelling clears it.
        expect(api.getSelection()).toMatchObject({ feature: SQUARE, source: 'search' })
    })

    test.each(['secondary', 'dismiss'])(
        'a %s close clears the selection and its highlight',
        async (action) => {
            await selectAndOpen(SQUARE, 'Alabama')
            api.reset()

            api.closePopup(action)
            await flush()

            expect(api.namesOf('map:removeLayer').map((r) => r.payload)).toContainEqual({
                id: 'aoi:selection',
            })
            expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(1)
            expect(api.getSelection()).toBeNull()
        }
    )

    test('a popup that closed on its own leaves the selection alone', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.reset()

        api.closePopup('closed')
        await flush()

        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(0)
        expect(api.emitsOf('plugin:aoi:analysisAOIReady')).toHaveLength(0)
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
    })

    test('a rejected popup request is reported and keeps the selection', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        api.requestImpl.set('map:showPopup', () => {
            throw new Error('invalid request')
        })

        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        await flush()
        api.emit('map:moveend')
        await flush()

        // Named, because a selection warns from four other places: any of
        // them would satisfy a bare "warned about something".
        expect(warn).toHaveBeenCalledWith('[AOI] showPopup failed', expect.any(Error))
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
    })
})

describe('AOITool popup lifecycle', () => {
    // Closing the tool and unloading it both reach the plugin through
    // `destroy()`, and that is the whole of the teardown contract: nothing of
    // the selection outlives the tool. Hiding the tool does not reach it — the
    // instance is kept and the card stays up.
    test('destroy clears the selection, its highlight and the popup', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        expect(api.hasOpenPopup()).toBe(true)
        api.reset()

        AOITool.destroy()
        await flush()

        expect(api.namesOf('map:hidePopup')).toHaveLength(1)
        expect(api.hasOpenPopup()).toBe(false)
        expect(
            api.namesOf('map:removeLayer').map((r) => r.payload.id)
        ).toContain('aoi:selection')
        expect(AOITool._state.currentAOI).toBeNull()
        expect(api.listenerCount('map:featureClick')).toBe(0)
    })

    test('destroy disarms a show already waiting on the camera', async () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        // Far enough in that the show is armed: the camera has been read and
        // the fit asked for, so a `map:moveend` listener and the fallback timer
        // are both standing.
        await flush()
        expect(api.listenerCount('map:moveend')).toBe(1)
        api.reset()

        AOITool.destroy()

        expect(api.listenerCount('map:moveend')).toBe(0)
        api.emit('map:moveend')
        await vi.advanceTimersByTimeAsync(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(0)
    })

    test('a superseding selection disarms the show already waiting on the camera', async () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        await flush()
        expect(api.listenerCount('map:moveend')).toBe(1)

        AOITool._applySelection(FAR_SQUARE, 'search', 'Alaska')
        await flush()
        // The superseded show let go of its listener and its timer; only the
        // current one is armed.
        expect(api.listenerCount('map:moveend')).toBe(1)

        api.emit('map:moveend')
        await vi.advanceTimersByTimeAsync(2000)

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.title).toBe('Alaska')
    })

    test('a camera step that fails leaves nothing pending', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        // A view missing a corner: deciding the fit throws on it, so the chain
        // ends after the show was already marked pending and before anything
        // was armed to settle it.
        api.requestImpl.set('map:getBounds', () => ({
            northEast: { lat: -30, lng: -30 },
        }))

        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        await flush()

        expect(warn).toHaveBeenCalled()
        // Nothing was armed to open this selection's popup, so neither a
        // moveend nor the fallback timer can produce one.
        api.emit('map:moveend')
        await vi.advanceTimersByTimeAsync(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(0)
    })

})

// Picking a shape arms a session; it does not choose an area. What these pin
// is where along a session the previous selection is actually given up, and
// what the user is left with when the session ends without a drawing.
describe('AOITool drawing sessions', () => {
    const VERTEX = { shape: 'polygon', vertices: [{ lat: 1, lng: 1 }] }

    test('arming a session retracts the card and keeps the selection', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        expect(api.hasOpenPopup()).toBe(true)
        api.reset()

        api.emit('map:drawstart', { shape: 'polygon' })
        await flush()

        // The card cannot stay: it would sit over the map for the whole
        // session, holding the Escape and Enter the session needs and offering
        // to analyze the area being replaced.
        expect(api.hasOpenPopup()).toBe(false)
        expect(api.namesOf('map:hidePopup')).toHaveLength(1)
        // The selection can, and must — nothing has replaced it yet, and a
        // selection dropped here has no undo.
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(0)
    })

    test('backing out before any vertex puts the card back', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        // The camera was fitted to the selection, so its centroid is in view
        // and the card goes back on it.
        api.requestImpl.set('map:getBounds', () => ({
            southWest: { lat: 0, lng: 0 },
            northEast: { lat: 10, lng: 10 },
        }))
        api.emit('map:drawstart', { shape: 'polygon' })
        await flush()
        api.reset()

        api.emit('map:drawcancel', { shape: 'polygon' })
        await flush()

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.title).toBe('Alabama')
        expect(shows[0].payload.latlng).toEqual({ lat: 5, lng: 5 })
        expect(api.hasOpenPopup()).toBe(true)
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
    })

    test('re-arming across the camera read leaves the card down', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.emit('map:drawstart', { shape: 'polygon' })
        await flush()
        api.reset()

        // Backing out reads the camera before putting the card back, and the
        // user picks another shape across that hop. The card belongs to the
        // selection the new session is about to replace, so it stays down.
        api.emit('map:drawcancel', { shape: 'polygon' })
        api.emit('map:drawstart', { shape: 'rectangle' })
        await flush()

        expect(api.namesOf('map:showPopup')).toHaveLength(0)
        expect(api.hasOpenPopup()).toBe(false)
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
    })

    test('the first vertex is where the previous selection goes', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.emit('map:drawstart', { shape: 'polygon' })
        await flush()
        api.reset()

        api.emit('map:drawvertex', VERTEX)
        await flush()

        expect(api.getSelection()).toBeNull()
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(1)
        expect(
            api.namesOf('map:removeLayer').map((r) => r.payload.id)
        ).toContain('aoi:selection')

        // Backing out from here has nothing left to put back.
        api.reset()
        api.emit('map:drawcancel', { shape: 'polygon' })
        await flush()
        expect(api.namesOf('map:showPopup')).toHaveLength(0)
    })

    test('a finished drawing gets its own card', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.emit('map:drawstart', { shape: 'polygon' })
        api.emit('map:drawvertex', VERTEX)
        await flush()
        api.reset()

        api.emit('map:drawcomplete', { feature: FAR_SQUARE })
        await flush()
        api.emit('map:moveend')
        await flush()

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.title).toBe('Drawn area')
        expect(shows[0].payload.latlng).toEqual({ lat: 25, lng: 25 })
        expect(api.getSelection()).toMatchObject({ feature: FAR_SQUARE, source: 'draw' })
    })

    // Both engines end the live session inside `enableDrawing` before starting
    // the new one, and end it without a cancel of its own, so a shape switch
    // reaches the plugin as a `drawstart` alone.
    test('switching shape mid-session keeps the session and its new shape', async () => {
        api.requestImpl.set('map:enableDrawing', ({ shape }) => {
            api.emit('map:drawstart', { shape })
            return true
        })
        await selectAndOpen(SQUARE, 'Alabama')

        AOITool._onDrawShapeChange('polygon')
        await flush()
        expect(AOITool._state).toMatchObject({ isDrawing: true, drawShape: 'polygon' })
        api.reset()

        AOITool._onDrawShapeChange('rectangle')
        await flush()

        // A live session on the new shape: the panel needs both, or it falls
        // back to the shape picker while a rectangle session is running.
        expect(AOITool._state).toMatchObject({ isDrawing: true, drawShape: 'rectangle' })
        // Nothing was backed out of, so the suspended card stays suspended
        // instead of coming back only to be retracted again.
        expect(api.namesOf('map:showPopup')).toHaveLength(0)
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
    })
})

// One popup slot, and core decides whose popup a `map:hidePopup` reaches. AOI
// asks whenever it is done with a popup and lets core sort out whether there
// is one of its own to close — so what these pin is the outcome, not whether
// AOI worked out for itself that it should stay quiet.
describe('AOITool popup ownership', () => {
    // The stamp is the whole mechanism, and it comes from asking through the
    // injected handle: a popup opened on the bare bus carries no address, and
    // would be one AOI could never retract.
    test('asks for its popup through its own handle', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        AOITool.destroy()

        expect(api.namesOf('map:showPopup')[0].caller).toBe('aoi')
        expect(api.namesOf('map:hidePopup')[0].caller).toBe('aoi')
    })
})
