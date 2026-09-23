import { test, expect, vi } from 'vitest'
import {
    toggleVisibility,
    getFilteredOutLayers,
    hideFilteredOutLayers,
    setOpacity,
    setColormap,
    setRescale,
    zoomToLayer,
    compareLayer,
    showAddLayer,
    dropLayer,
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

    test('getFilteredOutLayers names the layers on the map but filtered out of the list', async () => {
        setupMock({
            'layers:getVisible': { a: true, b: true, c: false, d: true },
            'layers:getListed': { b: false, c: false, d: false },
            'layers:getAllConfigs': { a: { display_name: 'A' }, b: { display_name: 'Bravo' }, d: {} },
        })
        expect(await getFilteredOutLayers()).toEqual([
            { id: 'b', title: 'Bravo' },
            { id: 'd', title: 'd' },
        ])
    })

    test('hideFilteredOutLayers toggles only those layers and emits for each', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getVisible': { a: true, b: true, c: false, d: true },
            'layers:getListed': { b: false, c: false, d: false },
            'layers:getAllConfigs': {},
            'layers:toggle': false,
        })
        await hideFilteredOutLayers()

        const toggled = requests.filter((r) => r.name === 'layers:toggle').map((r) => r.params)
        expect(toggled).toEqual(['b', 'd'])
        expect(emitCalls).toEqual([
            { event: 'layer:visibilityChange', payload: { layerName: 'b', visible: false } },
            { event: 'layer:visibilityChange', payload: { layerName: 'd', visible: false } },
        ])
    })

    test('hideFilteredOutLayers sends nothing when no layer is filtered out', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getVisible': { a: true, b: false },
            'layers:getListed': { b: false },
            'layers:getAllConfigs': {},
            'layers:toggle': false,
        })
        await hideFilteredOutLayers()

        expect(requests.some((r) => r.name === 'layers:toggle')).toBe(false)
        expect(emitCalls).toEqual([])
    })

    test('hideFilteredOutLayers is a no-op against a core without the listed handler', async () => {
        const { requests } = setupMock({
            'layers:getVisible': { a: true },
            'layers:toggle': false,
        })
        await hideFilteredOutLayers()
        expect(requests.some((r) => r.name === 'layers:toggle')).toBe(false)
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

// dropLayer reads the order from core, places the layer with the pure helper
// covered in tests/unit/layerManagerOrder.spec.js, and hands the whole list
// back. Core's broadcast is what re-sorts the list; nothing is emitted here.
test.describe('dropLayer', () => {
    const withOrder = (order, accepted = true) => {
        const writes = []
        const { emitCalls } = setupMock({
            'layers:getOrder': order,
            'layers:setOrder': (params) => {
                writes.push(params.order)
                return accepted
            },
        })
        return { writes, emitCalls }
    }

    test('writes the placed order back and emits nothing', async () => {
        const { writes, emitCalls } = withOrder(['a', 'b', 'c'])

        await dropLayer('c', 0, ['a', 'b', 'c'])

        expect(writes).toEqual([['c', 'a', 'b']])
        expect(emitCalls).toEqual([])
    })

    test('a drop onto its own slot writes nothing', async () => {
        const { requests } = setupMock({ 'layers:getOrder': ['a', 'b', 'c'] })

        await dropLayer('b', 1, ['a', 'b', 'c'])

        expect(requests.map((r) => r.name)).toEqual(['layers:getOrder'])
    })

    test('writes nothing against a core without an order', async () => {
        const { requests } = setupMock({})

        await dropLayer('a', 1, ['a', 'b'])

        expect(requests.map((r) => r.name)).not.toContain('layers:setOrder')
    })

    // Core refuses when this side's picture of the stack is stale, so the
    // refusal is the moment to re-read it.
    test('on a refusal, warns and refreshes rather than throwing', async () => {
        withOrder(['a', 'b'], false)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const refresh = vi.fn()

        await expect(dropLayer('b', 0, ['a', 'b'], refresh)).resolves.toBeUndefined()

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('b'))
        expect(refresh).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })

    test('drops a second drop that arrives before the first has been written', async () => {
        const { writes } = withOrder(['a', 'b', 'c'])

        const first = dropLayer('c', 0, ['a', 'b', 'c'])
        const second = dropLayer('c', 0, ['a', 'b', 'c'])
        await Promise.all([first, second])

        expect(writes).toEqual([['c', 'a', 'b']])
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
