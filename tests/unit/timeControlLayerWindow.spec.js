import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * TimeControl stamps each time-enabled layer with the window it requests,
 * `layer.time.start/end`, which the tile URL builders read. A raster tile
 * layer with a periodic `time.interval` is stamped with the one period
 * holding the cursor; every other layer with `[window start, cursor]`. Both
 * the per-step path (updateLayersTime) and the init paths stamp the same
 * way, because tile layers are created from the first stamps.
 */

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const WINDOW_START = '2026-07-26T15:42:31Z'
const CURSOR = '2026-08-25T15:42:31Z'

const layer = (name, type, time) => ({
    name,
    type,
    url: 'https://example.com/{z}/{x}/{y}.png',
    time: { enabled: true, type: 'requery', ...time },
})

const makeLayers = () => ({
    dailyTile: layer('dailyTile', 'tile', { interval: 'P1D' }),
    plainTile: layer('plainTile', 'tile', {}),
    dailyVector: layer('dailyVector', 'vector', { interval: 'P1D' }),
})

const loadTimeControl = async (layers, configData = {}) => {
    window.mmgisAPI = undefined
    vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
        default: {
            configData,
            FUTURES: {},
            layers: { data: layers, dataFlat: layers, layer: {} },
            asLayerUUID: (name) => name,
        },
    }))
    return (await import('../../src/essence/Basics/TimeControl_/TimeControl'))
        .default
}

describe('TimeControl layer window stamping', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    afterEach(() => {
        vi.doUnmock('../../src/essence/Basics/Layers_/Layers_')
        delete window.mmgisAPI
    })

    test('updateLayersTime stamps a periodic raster tile layer with its period', async () => {
        const layers = makeLayers()
        const TimeControl = await loadTimeControl(layers)
        TimeControl.startTime = WINDOW_START
        TimeControl.currentTime = CURSOR

        TimeControl.updateLayersTime()

        expect(layers.dailyTile.time.start).toBe('2026-08-25T00:00:00Z')
        expect(layers.dailyTile.time.end).toBe('2026-08-25T23:59:59Z')
    })

    test('updateLayersTime stamps non-periodic and non-raster layers with the window', async () => {
        const layers = makeLayers()
        const TimeControl = await loadTimeControl(layers)
        TimeControl.startTime = WINDOW_START
        TimeControl.currentTime = CURSOR

        TimeControl.updateLayersTime()

        for (const name of ['plainTile', 'dailyVector']) {
            expect(layers[name].time.start).toBe(WINDOW_START)
            expect(layers[name].time.end).toBe(CURSOR)
        }
    })

    test('init stamps the same way, from the seeded start and end', async () => {
        const layers = makeLayers()
        const TimeControl = await loadTimeControl(layers, {
            time: {
                enabled: true,
                initialstart: WINDOW_START,
                initialend: CURSOR,
            },
        })

        TimeControl.init()

        expect(layers.dailyTile.time.start).toBe('2026-08-25T00:00:00Z')
        expect(layers.dailyTile.time.end).toBe('2026-08-25T23:59:59Z')
        // init seeds the Time Control through toISOString, milliseconds
        // included, and a non-periodic layer carries that through as-is.
        expect(layers.plainTile.time.start).toBe('2026-07-26T15:42:31.000Z')
        expect(layers.plainTile.time.end).toBe('2026-08-25T15:42:31.000Z')
        expect(layers.dailyVector.time.end).toBe('2026-08-25T15:42:31.000Z')
    })
})
