import { describe, test, expect, beforeEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_.js')

/**
 * `layers:getRuns` and `layers:setRun`: the bus surface a picker uses over a
 * layer core has pinned to a model run. Core owns the list, the pin, the
 * derived data window and the redraw; the picker only asks. The clock is
 * never touched.
 */

const NEWEST = '2026-09-21T12:00:00'
const OLDER = '2026-09-21T06:00:00'

let providers
let emits
let refreshLayer
let reloadLayer
let clock

const registerProviders = () => {
    providers = {}
    emits = []
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: (event, payload) => emits.push({ event, payload }),
    }
    refreshLayer = vi.fn(() => true)
    // Faithful to TimeControl.reloadLayer, which stamps the time it refreshed
    // a layer at, and refreshes only a layer that is on.
    reloadLayer = vi.fn(async (layer) => {
        if (L_.layers.on[layer.name]) layer.time.current = clock.current
        return true
    })
    clock = {
        current: '2026-09-22T00:00:00Z',
        start: '2020-01-01T00:00:00Z',
        end: '2027-01-01T00:00:00Z',
        setTime: vi.fn(() => true),
    }
    L_.fina(
        null,
        {
            engine: { engineType: MAP_ENGINE.DECKGL, refreshLayer },
            nativeLayer: (layer) => layer,
        },
        null,
        null,
        null,
        {
            performTimeUrlReplacements: async (url) => url,
            getTime: () => clock.current,
            getStartTime: () => clock.start,
            getEndTime: () => clock.end,
            setTime: (...args) => clock.setTime(...args),
            reloadLayer: (...args) => reloadLayer(...args),
        }
    )
}

const forecastLayer = (on = false) => {
    const layer = {
        name: 'fc',
        type: 'tile',
        url: 'https://example.com/{z}/{x}/{y}?sel=reference_time=nearest::{reftime}&sel=lead=nearest::{lead}',
        time: {
            enabled: true,
            runs: { list: [NEWEST, OLDER], selected: NEWEST, step: 'PT1H', leadRange: [1, 72] },
            dataStartTime: '2026-09-21T13:00:00Z',
            dataEndTime: '2026-09-24T12:00:00Z',
        },
    }
    L_.layers.data.fc = layer
    L_.layers.layer.fc = { id: 'fc' }
    L_.layers.on.fc = on
    return layer
}

describe('layers:getRuns', () => {
    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.layer = {}
        L_.layers.on = {}
        registerProviders()
    })

    test('answers a pinned layer with its runs, pin, step, range and the lead at the current time', () => {
        forecastLayer()
        expect(providers['layers:getRuns']('fc')).toEqual({
            runs: [NEWEST, OLDER],
            selected: NEWEST,
            step: 'PT1H',
            leadRange: [1, 72],
            lead: 12,
        })
    })

    test('answers null for a layer with no runs, and a map of only the layers that have them', () => {
        forecastLayer()
        L_.layers.data.plain = { name: 'plain', time: { enabled: true } }
        expect(providers['layers:getRuns']('plain')).toBeNull()
        expect(Object.keys(providers['layers:getRuns']())).toEqual(['fc'])
    })
})

describe('layers:setRun', () => {
    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.layer = {}
        L_.layers.on = {}
        registerProviders()
    })

    test('pins a listed run, derives the window, and announces both ways', async () => {
        const layer = forecastLayer(false)
        expect(await providers['layers:setRun']({ layerUUID: 'fc', run: OLDER })).toBe(true)

        expect(layer.time.runs.selected).toBe(OLDER)
        expect(layer.time.dataStartTime).toBe('2026-09-21T07:00:00Z')
        expect(layer.time.dataEndTime).toBe('2026-09-24T06:00:00Z')
        expect(emits).toEqual([
            { event: 'layers:configChanged', payload: { layerName: 'fc', keys: ['time'] } },
            {
                event: 'layer:runChange',
                payload: { layerName: 'fc', run: OLDER, start: '2026-09-21T07:00:00Z', end: '2026-09-24T06:00:00Z' },
            },
        ])
    })

    test('reloads the layer after the pin moves, so coverage is re-decided against the new window', async () => {
        const layer = forecastLayer(true)
        reloadLayer.mockImplementation(async (l) => {
            expect(l.time.runs.selected).toBe(OLDER)
            expect(l.time.dataEndTime).toBe('2026-09-24T06:00:00Z')
            return true
        })
        await providers['layers:setRun']({ layerUUID: 'fc', run: OLDER })
        expect(reloadLayer).toHaveBeenCalledTimes(1)
        expect(reloadLayer.mock.calls[0][0]).toBe(layer)
    })

    test('reloads a layer that is off too, leaving the on/off decision to reloadLayer', async () => {
        const layer = forecastLayer(false)
        await providers['layers:setRun']({ layerUUID: 'fc', run: OLDER })
        expect(reloadLayer).toHaveBeenCalledWith(layer)
    })

    // The clock does not move on a pick, so a layer that is off would still
    // read as current when switched on and bring back the previous run's
    // tiles. Clearing the stamp is what sends it through catchUpLayerTime.
    test('leaves a layer that is off marked behind, so it reloads when next shown', async () => {
        const layer = forecastLayer(false)
        layer.time.current = clock.current
        await providers['layers:setRun']({ layerUUID: 'fc', run: OLDER })
        expect(layer.time.current).toBeNull()
    })

    test('leaves a layer that is on stamped current once it has redrawn', async () => {
        const layer = forecastLayer(true)
        layer.time.current = clock.current
        await providers['layers:setRun']({ layerUUID: 'fc', run: OLDER })
        expect(layer.time.current).toBe(clock.current)
    })

    test('leaves the stamp alone on a refused pick', async () => {
        const layer = forecastLayer(false)
        layer.time.current = clock.current
        await providers['layers:setRun']({ layerUUID: 'fc', run: '2020-01-01T00:00:00' })
        expect(layer.time.current).toBe(clock.current)
    })

    test('refuses an unlisted run, an unknown layer, and a layer without runs', async () => {
        const layer = forecastLayer()
        L_.layers.data.plain = { name: 'plain', time: { enabled: true } }
        expect(await providers['layers:setRun']({ layerUUID: 'fc', run: '2020-01-01T00:00:00' })).toBe(false)
        expect(await providers['layers:setRun']({ layerUUID: 'nope', run: OLDER })).toBe(false)
        expect(await providers['layers:setRun']({ layerUUID: 'plain', run: OLDER })).toBe(false)
        expect(layer.time.runs.selected).toBe(NEWEST)
        expect(emits).toEqual([])
        expect(reloadLayer).not.toHaveBeenCalled()
    })

    test('never moves the clock or the global window, even when the clock sits outside the run window', async () => {
        forecastLayer()
        clock.current = '2026-08-01T00:00:00Z'
        await providers['layers:setRun']({ layerUUID: 'fc', run: OLDER })
        expect(clock.setTime).not.toHaveBeenCalled()
    })
})

describe('layers:refreshRuns', () => {
    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.layer = {}
        L_.layers.on = {}
        registerProviders()
    })

    test('re-reads the source, pins, and announces; false for a layer without one', async () => {
        const layer = forecastLayer(false)
        layer.time.current = clock.current
        layer.time.runs = { url: 'https://svc/runs', path: 'data', step: 'PT1H' }
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [OLDER, NEWEST] }) })))
        try {
            expect(await providers['layers:refreshRuns']('fc')).toBe(true)
        } finally {
            vi.unstubAllGlobals()
        }
        expect(layer.time.runs.list).toEqual([NEWEST, OLDER])
        expect(layer.time.runs.selected).toBe(NEWEST)
        expect(emits.map((e) => e.event)).toEqual(['layers:configChanged', 'layer:runChange'])
        expect(reloadLayer).toHaveBeenCalledWith(layer)
        expect(layer.time.current).toBeNull()

        L_.layers.data.plain = { name: 'plain', time: { enabled: true } }
        expect(await providers['layers:refreshRuns']('plain')).toBe(false)
    })
})
