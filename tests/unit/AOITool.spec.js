import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// The panel component pulls in @trussworks/react-uswds and a SCSS entry point;
// nothing here renders it.
vi.mock('../../src/essence/Tools/AOI/AOIComponent', () => ({ default: () => null }))
vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render() { }, unmount() { } }),
}))

import AOITool from '../../src/essence/Tools/AOI/AOITool'

const ANALYZE_EVENT = 'plugin:aoi:analyzeClicked'
const CANCEL_EVENT = 'plugin:aoi:drawingCancelled'

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
 */
function makeFakeApi() {
    const listeners = new Map()
    const requests = []
    const emits = []
    const provided = new Map()
    const requestImpl = new Map()

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
                getVars: () => ({}),
                pluginId,
                prefix,
            }
        },

        // Test-only accessors.
        requests,
        emits,
        requestImpl,
        listenerCount: (event) => listeners.get(event)?.size || 0,
        namesOf: (name) => requests.filter((r) => r.name === name),
        emitsOf: (event) => emits.filter((e) => e.event === event),
        getSelection: () => provided.get('plugin:aoi:getCurrentSelection')?.(),
        reset() {
            requests.length = 0
            emits.length = 0
        },
    }
    return api
}

let api

/** Let queued microtasks (bus request promises) run. */
const flush = () => vi.advanceTimersByTimeAsync(0)

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
    test('asks core for the analyze/cancel popup at the feature centroid', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        api.emit('map:moveend')

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        const payload = shows[0].payload
        expect(payload.latlng).toEqual({ lat: 5, lng: 5 })
        expect(payload.html).toBe('<strong>Alabama</strong>')
        expect(payload.primaryAction).toEqual({
            label: 'Analyze area',
            event: ANALYZE_EVENT,
        })
        expect(payload.secondaryAction).toEqual({
            label: 'Cancel',
            event: CANCEL_EVENT,
        })
        expect(payload.dismissEvent).toBe(CANCEL_EVENT)

        // The request must survive a postMessage boundary: data only, no
        // functions crossing into core.
        expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
    })

    test('defers the popup until the camera settles', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        expect(api.namesOf('map:showPopup')).toHaveLength(0)

        api.emit('map:moveend')
        expect(api.namesOf('map:showPopup')).toHaveLength(1)
    })

    test('retracts the open popup before showing the next one', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        // Synchronous, so a click that dismisses the old popup cannot land
        // after the deferred show and wipe the new selection.
        const hideAt = api.requests.findIndex((r) => r.name === 'map:hidePopup')
        expect(hideAt).toBeGreaterThanOrEqual(0)

        api.emit('map:moveend')
        const showAt = api.requests.findIndex((r) => r.name === 'map:showPopup')
        expect(showAt).toBeGreaterThan(hideAt)
    })

    test('escapes markup in the label', () => {
        AOITool._applySelection(SQUARE, 'upload', 'Smith & <b>Sons</b>')
        api.emit('map:moveend')

        const { html } = api.namesOf('map:showPopup')[0].payload
        expect(html).toBe('<strong>Smith &amp; &lt;b&gt;Sons&lt;/b&gt;</strong>')
    })
})

describe('AOITool popup events', () => {
    test('analyze hands the selected feature to the analysis consumers', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        api.emit('map:moveend')
        api.reset()

        api.emit(ANALYZE_EVENT)

        const ready = api.emitsOf('plugin:aoi:analysisAOIReady')
        expect(ready).toHaveLength(1)
        expect(ready[0].data).toEqual({ feature: SQUARE })
        // Analyzing keeps the selection; only Cancel clears it.
        expect(api.getSelection()).toMatchObject({ feature: SQUARE, source: 'search' })
    })

    test('cancel clears the selection without re-broadcasting itself', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        api.emit('map:moveend')
        api.reset()

        api.emit(CANCEL_EVENT)

        expect(api.namesOf('map:removeLayer').map((r) => r.payload)).toContainEqual({
            id: 'aoi:selection',
        })
        expect(api.emitsOf('plugin:aoi:drawingCleared')).toHaveLength(1)
        expect(api.getSelection()).toBeNull()
        // Core broadcasts the cancellation; re-emitting it here would recurse.
        expect(api.emitsOf(CANCEL_EVENT)).toHaveLength(1)
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
        expect(api.listenerCount(ANALYZE_EVENT)).toBe(0)
        expect(api.listenerCount(CANCEL_EVENT)).toBe(0)
    })

    test('a superseding selection leaves only its own popup pending', () => {
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        AOITool._applySelection(FAR_SQUARE, 'search', 'Alaska')

        // The superseded one-shot is unsubscribed, not just neutered.
        expect(api.listenerCount('map:moveend')).toBe(1)

        api.emit('map:moveend')

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

    test('a rejected fitBounds still shows the popup exactly once', async () => {
        api.requestImpl.set('map:fitBounds', () => {
            throw new Error('no view yet')
        })
        vi.spyOn(console, 'warn').mockImplementation(() => { })

        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        await flush()
        expect(api.namesOf('map:showPopup')).toHaveLength(1)

        api.emit('map:moveend')
        vi.advanceTimersByTime(2000)
        expect(api.namesOf('map:showPopup')).toHaveLength(1)
    })

    test('a superseded selection\'s rejected fitBounds cannot show or cancel', async () => {
        api.requestImpl.set('map:fitBounds', () => {
            throw new Error('no view yet')
        })
        vi.spyOn(console, 'warn').mockImplementation(() => { })

        // The first selection's rejection resolves only after the second has
        // taken over, so it must neither open its own popup nor drop the
        // second selection's pending show.
        AOITool._applySelection(SQUARE, 'search', 'Alabama')
        AOITool._applySelection(FAR_SQUARE, 'search', 'Alaska')
        await flush()

        const shows = api.namesOf('map:showPopup')
        expect(shows).toHaveLength(1)
        expect(shows[0].payload.html).toBe('<strong>Alaska</strong>')
    })
})
