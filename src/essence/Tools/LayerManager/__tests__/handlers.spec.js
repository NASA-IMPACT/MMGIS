import { test, expect, vi } from 'vitest'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
    zoomToLayer,
    compareLayer,
    showAddLayer,
} from '../adapters/handlers.ts'
import {
    ZOOM_TO_LAYER_PADDING,
    ZOOM_TO_LAYER_POINT_MAX_ZOOM,
} from '../lib/utils/constants.ts'

const setupMock = (responses = {}, emitCalls = []) => {
    global.window = global.window || {}
    const requests = []
    global.window.mmgisAPI = {
        request: async (name, params) => {
            requests.push({ name, params })
            if (responses[name] !== undefined) {
                return typeof responses[name] === 'function' ? responses[name](params) : responses[name]
            }
            return null
        },
        hasHandler: (name) => responses[name] !== undefined,
        on: () => () => {},
        emit: (event, payload) => { emitCalls.push({ event, payload }) },
    }
    return { emitCalls, requests }
}

// showAddLayer fires its request without returning it.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const EDITABLE = { hasColormap: true, canChangeColormap: true }
// What an image layer reports: a ramp to show, but nothing to change.
const READ_ONLY = { hasColormap: true, canChangeColormap: false }

// Core answers the capability handler per layer, resolving the identifier it
// is given; unknown layers get null.
const capabilities = (byLayer) => (layerId) => byLayer[layerId] ?? null

const COG_LAYER = {
    'layers:getCogCapabilities': capabilities({ layerA: EDITABLE }),
    'layers:updateConfig': true,
    'layers:refresh': true,
}

test.describe('handlers', () => {
    test('toggleVisibility issues layers:toggle and emits visibilityChange', async () => {
        const { emitCalls } = setupMock({ 'layers:toggle': true })
        await toggleVisibility('layerA')
        expect(emitCalls).toContainEqual({
            event: 'layer:visibilityChange',
            payload: { layerName: 'layerA', visible: true },
        })
    })

    test('setOpacity issues layers:setOpacity and emits opacityChange', async () => {
        const { emitCalls } = setupMock({ 'layers:setOpacity': true })
        await setOpacity('layerA', 0.5)
        expect(emitCalls).toContainEqual({
            event: 'layer:opacityChange',
            payload: { layerName: 'layerA', opacity: 0.5 },
        })
    })

    test('setColormap is a no-op when core reports the layer unchangeable', async () => {
        const { emitCalls } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: READ_ONLY }),
        })
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
    })

    // Core resolves the identifier, so the handler asks about one layer rather
    // than indexing a UUID-keyed map with whatever id the panel holds.
    test('setColormap asks core about the layer it is changing', async () => {
        const { requests } = setupMock(COG_LAYER)
        await setColormap('layerA', 'plasma', () => {})

        expect(requests[0]).toEqual({
            name: 'layers:getCogCapabilities',
            params: 'layerA',
        })
    })

    // Without the handler there is no way to know core can repaint the layer,
    // so the write is withheld rather than sent and silently dropped.
    test('setColormap is a no-op against a core without the capability handler', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setColormap('layerA', 'plasma', () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests).toHaveLength(0)
    })

    test('setColormap calls refresh on success', async () => {
        const { emitCalls } = setupMock(COG_LAYER)
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogColormapChange',
            payload: { layerName: 'layerA', colormap: 'plasma' },
        })
        expect(refreshCalled).toBe(true)
    })

    // applyCogFieldsToUrl prefers `currentCogColormap`, so a `cogColormap`
    // override would lose to the value the config write puts there.
    test('setColormap writes and refreshes on the same currentCogColormap field', async () => {
        const { requests } = setupMock(COG_LAYER)
        await setColormap('layerA', 'plasma', () => {})

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        const refresh = requests.find((r) => r.name === 'layers:refresh')
        expect(update.params).toEqual({
            layerUUID: 'layerA',
            updates: { currentCogColormap: 'plasma' },
        })
        expect(refresh.params).toEqual({
            layerUUID: 'layerA',
            options: { currentCogColormap: 'plasma' },
        })
    })

    test('setRescale writes and refreshes on the same currentCogMin/Max fields', async () => {
        const { requests, emitCalls } = setupMock(COG_LAYER)
        await setRescale('layerA', 0, 5, () => {})

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        const refresh = requests.find((r) => r.name === 'layers:refresh')
        expect(update.params).toEqual({
            layerUUID: 'layerA',
            updates: { currentCogMin: 0, currentCogMax: 5 },
        })
        expect(refresh.params).toEqual({
            layerUUID: 'layerA',
            options: { currentCogMin: 0, currentCogMax: 5 },
        })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogRescaleChange',
            payload: { layerName: 'layerA', min: 0, max: 5 },
        })
    })

    test('setRescale is a no-op when core reports the layer unchangeable', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: READ_ONLY }),
        })
        let refreshCalled = false
        await setRescale('layerA', 0, 5, () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
        expect(requests.map((r) => r.name)).toEqual(['layers:getCogCapabilities'])
    })

    test('setRescale is a no-op against a core without the capability handler', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setRescale('layerA', 0, 5, () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests).toHaveLength(0)
    })

    // A layer core has never heard of answers null, which must read as
    // "cannot change" rather than throw.
    test('setColormap is a no-op for a layer core does not know', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: EDITABLE }),
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setColormap('layerB', 'plasma', () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests.map((r) => r.name)).toEqual(['layers:getCogCapabilities'])
    })

    // [[south, west], [north, east]] — the pair both map engines normalise.
    const EXTENT = [
        [30, -120],
        [45, -100],
    ]

    // Every feature of the layer sitting at one point: an extent enclosing no
    // area at all.
    const POINT_EXTENT = [
        [30, -120],
        [30, -120],
    ]

    const LOCATABLE = {
        'layers:getBounds': (layerId) =>
            ({ layerA: EXTENT, layerPoint: POINT_EXTENT }[layerId] ?? null),
        'map:fitBounds': true,
    }

    test('zoomToLayer fits the map to the extent core reports', async () => {
        const { requests } = setupMock(LOCATABLE)
        await zoomToLayer('layerA')

        expect(requests).toEqual([
            { name: 'layers:getBounds', params: 'layerA' },
            {
                name: 'map:fitBounds',
                params: {
                    bounds: EXTENT,
                    options: { padding: ZOOM_TO_LAYER_PADDING },
                },
            },
        ])
    })

    // An extent with area is fitted uncapped, so a layer covering a few hundred
    // metres reaches the detail it carries rather than stopping where a point
    // layer has to.
    test('zoomToLayer leaves an extent with area uncapped', async () => {
        const { requests } = setupMock(LOCATABLE)
        await zoomToLayer('layerA')

        const fit = requests.find((r) => r.name === 'map:fitBounds')
        expect(fit.params.options.maxZoom).toBeUndefined()
    })

    // An extent enclosing no area fits to maximum zoom without a cap, landing
    // far past any tile the layer serves.
    test('zoomToLayer caps a fit to an extent enclosing no area', async () => {
        const { requests } = setupMock(LOCATABLE)
        await zoomToLayer('layerPoint')

        const fit = requests.find((r) => r.name === 'map:fitBounds')
        expect(fit.params.options).toEqual({
            padding: ZOOM_TO_LAYER_PADDING,
            maxZoom: ZOOM_TO_LAYER_POINT_MAX_ZOOM,
        })
    })

    test('zoomToLayer moves nothing for a layer with no extent', async () => {
        const { requests } = setupMock(LOCATABLE)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await zoomToLayer('layerB')

        expect(requests.map((r) => r.name)).toEqual(['layers:getBounds'])
        // The panel has no channel for reporting a click that led nowhere, so
        // the log is where it has to show up.
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('layerB'))
        warn.mockRestore()
    })

    // Against a core too old to register the handler there is no extent to
    // move to, and asking the map to fit nothing would throw.
    test('zoomToLayer is a no-op against a core without the bounds handler', async () => {
        const { requests } = setupMock({ 'map:fitBounds': true })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await zoomToLayer('layerA')

        expect(requests).toHaveLength(0)
        warn.mockRestore()
    })

    test('compareLayer announces the layer on the bus', () => {
        const { emitCalls, requests } = setupMock()
        compareLayer('layerA')

        expect(emitCalls).toEqual([
            {
                event: 'plugin:comparison:startWithLayer',
                payload: { layerId: 'layerA' },
            },
        ])
        expect(requests).toHaveLength(0)
    })

    test('showAddLayer commands the layout to reveal the form', async () => {
        const { emitCalls, requests } = setupMock({
            'plugins:show': { ok: true, state: 'visible', changed: true },
        })
        showAddLayer()
        await flush()

        expect(requests).toEqual([
            { name: 'plugins:show', params: { pluginId: 'AddTempLayerTool' } },
        ])
        expect(emitCalls).toHaveLength(0)
    })

    test('showAddLayer logs a refusal instead of dropping it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        setupMock({ 'plugins:show': { ok: false, reason: 'not-found' } })
        showAddLayer()
        await flush()

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-found'))
        warn.mockRestore()
    })
})

// --- Switching a layer on brings it into view ------------------------------
// A layer whose data sits outside the viewport draws correctly but looks
// broken, so toggling it on moves the map — unless it already overlaps what
// the user is looking at, where moving would be a nuisance.

import { normalizeMapBounds, boundsIntersect } from '../adapters/handlers.ts'

const VENEZUELA = [
    [8.98, -70.05],
    [11.55, -64.72],
]
const CONUS_VIEW = {
    southWest: { lat: 24, lng: -125 },
    northEast: { lat: 50, lng: -66 },
}
const VENEZUELA_VIEW = {
    southWest: { lat: 8, lng: -71 },
    northEast: { lat: 12, lng: -64 },
}

const toggleOn = (mapBounds, layerBounds = VENEZUELA) => ({
    'layers:toggle': true,
    'layers:getBounds': layerBounds,
    'map:getBounds': mapBounds,
    'map:fitBounds': true,
})

test('toggling a layer on moves the map when its data is off-screen', async () => {
    const { requests } = setupMock(toggleOn(CONUS_VIEW))
    await toggleVisibility('layerA')
    const fit = requests.find((r) => r.name === 'map:fitBounds')
    expect(fit).toBeDefined()
    expect(fit.params.bounds).toEqual(VENEZUELA)
    expect(fit.params.options.padding).toBe(ZOOM_TO_LAYER_PADDING)
})

test('toggling a layer on leaves the map alone when it already overlaps the view', async () => {
    const { requests } = setupMock(toggleOn(VENEZUELA_VIEW))
    await toggleVisibility('layerA')
    expect(requests.find((r) => r.name === 'map:fitBounds')).toBeUndefined()
})

test('switching a layer OFF never moves the map', async () => {
    const { requests } = setupMock({ ...toggleOn(CONUS_VIEW), 'layers:toggle': false })
    await toggleVisibility('layerA')
    expect(requests.find((r) => r.name === 'map:fitBounds')).toBeUndefined()
})

test('a layer with no extent is left alone rather than guessed at', async () => {
    const { requests } = setupMock(toggleOn(CONUS_VIEW, null))
    await toggleVisibility('layerA')
    expect(requests.find((r) => r.name === 'map:fitBounds')).toBeUndefined()
})

// An unknown viewport is not grounds for moving the map.
test('an unreadable viewport leaves the map alone', async () => {
    const { requests } = setupMock(toggleOn({ nonsense: true }))
    await toggleVisibility('layerA')
    expect(requests.find((r) => r.name === 'map:fitBounds')).toBeUndefined()
})

test('the visibility event still fires regardless of any move', async () => {
    const emits = []
    setupMock(toggleOn(CONUS_VIEW), emits)
    await toggleVisibility('layerA')
    expect(emits).toContainEqual({
        event: 'layer:visibilityChange',
        payload: { layerName: 'layerA', visible: true },
    })
})

test('normalizeMapBounds reads the Leaflet adapter shape', () => {
    expect(normalizeMapBounds(CONUS_VIEW)).toEqual([
        [24, -125],
        [50, -66],
    ])
})

// deck.gl's adapter returns Leaflet-style accessors instead of plain corners.
test('normalizeMapBounds reads the deck.gl accessor shape', () => {
    expect(
        normalizeMapBounds({
            getSouthWest: () => ({ lat: 24, lng: -125 }),
            getNorthEast: () => ({ lat: 50, lng: -66 }),
        }),
    ).toEqual([
        [24, -125],
        [50, -66],
    ])
})

test('normalizeMapBounds reads a corner tuple', () => {
    expect(
        normalizeMapBounds([
            [24, -125],
            [50, -66],
        ]),
    ).toEqual([
        [24, -125],
        [50, -66],
    ])
})

test.each([
    ['null', null],
    ['a non-object', 'nope'],
    ['missing corners', { southWest: { lat: 1, lng: 2 } }],
    ['non-numeric corners', { southWest: { lat: 'a', lng: 'b' }, northEast: { lat: 1, lng: 2 } }],
])('normalizeMapBounds returns null for %s', (_label, raw) => {
    expect(normalizeMapBounds(raw)).toBeNull()
})

test('boundsIntersect is true for overlap and false for disjoint extents', () => {
    expect(boundsIntersect(VENEZUELA, [[8, -71], [12, -64]])).toBe(true)
    expect(boundsIntersect(VENEZUELA, [[24, -125], [50, -66]])).toBe(false)
    // Touching edges count as overlapping — nothing to reveal.
    expect(boundsIntersect([[0, 0], [10, 10]], [[10, 10], [20, 20]])).toBe(true)
})
