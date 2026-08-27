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
 * Minimal stand-in for `window.mmgisAPI`: a mitt-like bus plus recording
 * `request`/`emit` logs, so a spec can assert exactly what the plugin asked
 * core for and what it broadcast.
 *
 * `map:showPopup` and `map:hidePopup` model the core service's contract — one
 * popup slot, a later show or a hide closes the current one, and every show is
 * answered on its own promise with how its popup closed.
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
        // Core's own signature: the caller travels in an options object, and
        // core refuses a bare id in that slot outright. Recording it unwrapped
        // is what keeps `requests` reading as a plain caller.
        request(name, payload, options) {
            const caller = options?.caller
            requests.push({ name, payload, caller })
            const impl = requestImpl.get(name)
            return Promise.resolve().then(() =>
                impl ? impl(payload, caller) : true
            )
        },
        provide(name, handler) {
            provided.set(name, handler)
            return () => provided.delete(name)
        },
        forPlugin(pluginId) {
            const prefix = `plugin:${pluginId}:`
            return {
                emit: (event, data) => api.emit(prefix + event, data),
                provide: (name, handler) => api.provide(prefix + name, handler),
                // Unprefixed, and stamped with the plugin's id — the shape
                // core's handle has, because it is the stamp that decides
                // whose popup a hide is allowed to reach.
                request: (name, data) =>
                    api.request(name, data, { caller: pluginId }),
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
    // Showing takes the slot whoever held it, and records who the new popup
    // belongs to.
    requestImpl.set('map:showPopup', (payload, caller) => {
        settleOpen('closed')
        return new Promise((resolve) => {
            openPopup = { payload, resolve, owner: caller ?? null }
        })
    })
    // Hiding reaches only the caller's own popup, as core's does — otherwise
    // these specs would pin a contract core does not offer.
    requestImpl.set('map:hidePopup', (payload, caller) => {
        if (!openPopup || openPopup.owner !== (caller ?? null)) return false
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

    AOITool.make('toolPanel')
    await flush()
    api.reset()
})

afterEach(() => {
    AOITool.destroy()
    const container = document.getElementById('toolPanel')
    if (container) container.remove()
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

    test('retracts the open popup before showing the next one, keeping the new selection', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        expect(api.hasOpenPopup()).toBe(true)
        api.reset()

        // The retract answers the first request with 'closed', which must not
        // be read as the user abandoning the selection just made.
        await selectAndOpen(FAR_SQUARE, 'Alaska')

        expect(api.namesOf('map:hidePopup')).toHaveLength(1)
        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.title).toBe('Alaska')
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(0)
        expect(api.getSelection()).toMatchObject({ feature: FAR_SQUARE })
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

    test('a secondary press clears the selection and its highlight', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.reset()

        api.closePopup('secondary')
        await flush()

        expect(api.namesOf('map:removeLayer').map((r) => r.payload)).toContainEqual({
            id: 'aoi:selection',
        })
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(1)
        expect(api.getSelection()).toBeNull()
    })

    test('a dismissal clears the selection too', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.reset()

        api.closePopup('dismiss')
        await flush()

        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(1)
        expect(api.getSelection()).toBeNull()
    })

    test('a popup that closed on its own leaves the selection alone', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.reset()

        api.closePopup('closed')
        await flush()

        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(0)
        expect(api.emitsOf('plugin:aoi:analysisAOIReady')).toHaveLength(0)
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
    })

    test('a rejected popup request is reported and leaves the tool usable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        api.requestImpl.set('map:showPopup', () => {
            throw new Error('invalid request')
        })

        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        await flush()
        api.emit('map:moveend')
        await flush()

        expect(warn).toHaveBeenCalled()
        // The selection survives, and a later selection still works.
        expect(api.getSelection()).toMatchObject({ feature: SQUARE })
        api.requestImpl.delete('map:showPopup')
        await selectAndOpen(FAR_SQUARE, 'Alaska')
        expect(api.getSelection()).toMatchObject({ feature: FAR_SQUARE })
    })
})

describe('AOITool popup lifecycle', () => {
    test('destroy drops a pending show', async () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        api.reset()

        // Torn down while the camera is still being read, which is the earliest
        // a pending show can be dropped. Nothing of AOI's is on screen yet, so
        // the retract it asks for on the way out closes nothing.
        AOITool.destroy()
        expect(api.hasOpenPopup()).toBe(false)
        await flush()

        api.emit('map:moveend')
        await vi.advanceTimersByTimeAsync(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(0)

        expect(api.listenerCount('map:moveend')).toBe(0)
        expect(api.listenerCount('map:featureClick')).toBe(0)
    })

    // Switching tools, closing the tool and collapsing its panel all reach the
    // plugin the same way — through `destroy()` — so this is the whole of the
    // teardown contract: nothing of the selection outlives the tool.
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
    })

    test('a superseding selection leaves only its own popup pending', async () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        AOITool._applySelection(FAR_SQUARE, 'search', 'Alaska')
        await flush()

        // The superseded show never subscribes at all: it is dropped while the
        // camera is being read.
        expect(api.listenerCount('map:moveend')).toBe(1)

        api.emit('map:moveend')
        await vi.advanceTimersByTimeAsync(2000)

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.title).toBe('Alaska')
        expect(shows[0].payload.latlng).toEqual({ lat: 25, lng: 25 })
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
        // No popup can open from here, so claiming one is pending would be a
        // lie — and would suppress the next selection's show.
        expect(AOITool._pendingPopup).toBeNull()
        api.emit('map:moveend')
        await vi.advanceTimersByTimeAsync(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(0)
    })

})

// One popup slot, and core decides whose popup a `map:hidePopup` reaches. AOI
// asks whenever it is done with a popup and lets core sort out whether there
// is one of its own to close — so what these pin is the outcome, not whether
// AOI worked out for itself that it should stay quiet.
describe('AOITool popup ownership', () => {
    // The stamp is the whole mechanism: a popup opened without AOI's id on the
    // request is one AOI could never retract.
    test('asks for its popup as AOI', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        AOITool.destroy()

        expect(api.namesOf('map:showPopup')[0].caller).toBe('aoi')
        expect(api.namesOf('map:hidePopup')[0].caller).toBe('aoi')
    })

    test('a selection made with an AOI popup open retracts it up front', async () => {
        await selectAndOpen(SQUARE, 'Alabama')
        api.reset()

        // Up front, before the camera step: the retract has to beat the
        // click-away that would otherwise dismiss the selection just made.
        AOITool._applySelection(FAR_SQUARE, 'search', 'Alaska')
        await flush()
        expect(api.namesOf('map:hidePopup')).toHaveLength(1)
        expect(api.hasOpenPopup()).toBe(false)
        expect(api.namesOf('map:showPopup')).toHaveLength(0)
    })

    // The one that matters: once another plugin owns the slot, nothing AOI
    // does on the way out may take it away from them.
    test('leaves the popup that replaced its own alone', async () => {
        await selectAndOpen(SQUARE, 'Alabama')

        // Another plugin takes the slot, through its own handle. AOI's request
        // answers 'closed' and the slot is theirs from here on.
        api.forPlugin('other').request('map:showPopup', { html: 'someone else' })
        await flush()
        api.reset()

        AOITool.destroy()
        await flush()

        // AOI still asked — it has no idea the slot changed hands — and core
        // declined, because the popup showing is not AOI's.
        expect(api.namesOf('map:hidePopup')).toHaveLength(1)
        expect(api.hasOpenPopup()).toBe(true)
    })
})
