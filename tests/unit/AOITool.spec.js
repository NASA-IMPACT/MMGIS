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
        request(name, payload) {
            requests.push({ name, payload })
            const impl = requestImpl.get(name)
            return Promise.resolve().then(() => (impl ? impl(payload) : true))
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

    requestImpl.set('map:showPopup', (payload) => {
        settleOpen('closed')
        return new Promise((resolve) => {
            openPopup = { payload, resolve }
        })
    })
    requestImpl.set('map:hidePopup', () => {
        settleOpen('closed')
        return true
    })

    return api
}

let api

/** Let queued microtasks (bus request promises) run. */
const flush = () => vi.advanceTimersByTimeAsync(0)

/** Make a selection and let its deferred popup open. */
async function selectAndOpen(feature, label) {
    AOITool._applySelection(feature, 'search', label)
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
    test('asks core for the analyze/cancel popup at the feature centroid, once the camera settles', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        expect(api.namesOf('map:showPopup')).toHaveLength(0)

        api.emit('map:moveend')

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        const payload = shows[0].payload
        expect(payload.latlng).toEqual({ lat: 5, lng: 5 })
        expect(payload.html).toBe('<strong>Alabama</strong>')
        // Labels only: the outcome comes back on the request's promise, so the
        // plugin names no events for core to broadcast.
        expect(payload.primaryAction).toEqual({ label: 'Analyze area' })
        expect(payload.secondaryAction).toEqual({ label: 'Cancel' })

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
        expect(shows[0].payload.html).toBe('<strong>Alaska</strong>')
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(0)
        expect(api.getSelection()).toMatchObject({ feature: FAR_SQUARE })
    })

    test('escapes markup in the label', () => {
        AOITool._applySelection(SQUARE, 'upload', 'Smith & <b>Sons</b>')
        api.emit('map:moveend')

        const { html } = api.namesOf('map:showPopup')[0].payload
        expect(html).toBe('<strong>Smith &amp; &lt;b&gt;Sons&lt;/b&gt;</strong>')
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
    test('destroy retracts the popup and drops a pending show', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        api.reset()

        AOITool.destroy()
        expect(api.namesOf('map:hidePopup')).toHaveLength(1)

        api.emit('map:moveend')
        vi.advanceTimersByTime(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(0)

        expect(api.listenerCount('map:moveend')).toBe(0)
        expect(api.listenerCount('map:featureClick')).toBe(0)
    })

    test('a superseding selection leaves only its own popup pending', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        AOITool._applySelection(FAR_SQUARE, 'search', 'Alaska')

        // The superseded one-shot is unsubscribed, not just neutered.
        expect(api.listenerCount('map:moveend')).toBe(1)

        api.emit('map:moveend')
        vi.advanceTimersByTime(2000)

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.html).toBe('<strong>Alaska</strong>')
        expect(shows[0].payload.latlng).toEqual({ lat: 25, lng: 25 })
    })

    test('the fallback timer shows the popup exactly once', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')

        vi.advanceTimersByTime(1500)
        expect(api.namesOf('map:showPopup')).toHaveLength(1)

        api.emit('map:moveend')
        expect(api.namesOf('map:showPopup')).toHaveLength(1)
    })

    test('a rejected fitBounds leaves the popup to the fallback timer, still once', async () => {
        api.requestImpl.set('map:fitBounds', () => {
            throw new Error('no view yet')
        })
        vi.spyOn(console, 'warn').mockImplementation(() => { })

        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        await flush()
        expect(api.namesOf('map:showPopup')).toHaveLength(0)

        vi.advanceTimersByTime(1500)
        expect(api.namesOf('map:showPopup')).toHaveLength(1)

        api.emit('map:moveend')
        vi.advanceTimersByTime(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(1)
    })
})
