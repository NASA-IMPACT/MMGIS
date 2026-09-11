import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

/**
 * Every committed time change reloads every time-enabled layer, and each
 * reload refetches that layer's whole tileset. Play mode commits as often as
 * every 100ms and a datepicker commits per keystroke, so the commits arrive
 * faster than the tiles they ask for can come back — the browser abandons the
 * in-flight requests, but the tile service has already begun answering them.
 *
 * So the reload waits: one per window, carrying the time the last commit in
 * the window set. What is asserted here is the engine-side effect — how many
 * times the layer is actually refreshed, and with which time — not that a
 * scheduler was called.
 *
 * Commits arrive on `time:changeRequested`, the bus event the timeline, the
 * datepicker and the play loop all raise.
 */

const WINDOW_MS = 200

const refreshLayer = vi.fn(() => true)

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({
    default: {
        engine: {
            engineType: MAP_ENGINE.DECKGL,
            refreshLayer: (...args) => refreshLayer(...args),
        },
        refreshLayer: vi.fn(async () => true),
    },
}))

vi.mock('../../src/essence/Basics/Layers_/Layers_', () => ({
    default: {
        missionPath: '',
        configData: {},
        FUTURES: {},
        layers: { data: {}, layer: {}, on: {}, opacity: {}, filters: {} },
        asLayerUUID: (name) => name,
        getUrl: (type, url) => url,
        transformStacUrl: (url) => url,
        timeFilterVectorLayer: vi.fn(),
    },
}))

// As much of the event bus as TimeControl uses: subscriptions, emits and the
// request/provide pairs it registers at init.
const makeBus = () => {
    const handlers = {}
    return {
        on(event, handler) {
            handlers[event] = handler
            return () => delete handlers[event]
        },
        emit(event, payload) {
            const handler = handlers[event]
            if (handler) handler(payload)
        },
        provide() {
            return () => {}
        },
    }
}

// The time the layer was asked for, in the order the engine was asked.
const refreshedTimes = () =>
    refreshLayer.mock.calls.map(([, ctx]) => ctx.tileOptions.time)

describe('time-driven layer reloads', () => {
    let TimeControl
    let L_

    beforeEach(async () => {
        vi.resetModules()
        refreshLayer.mockClear()
        vi.useFakeTimers()
        window.mmgisAPI = makeBus()

        TimeControl = (
            await import('../../src/essence/Basics/TimeControl_/TimeControl')
        ).default
        L_ = (await import('../../src/essence/Basics/Layers_/Layers_')).default

        const layer = {
            name: 'NO2 Monthly',
            type: 'TileLayer',
            url: 'https://example.com/{time}/tiles/{z}/{x}/{y}.png',
            tileformat: 'wmts',
            controlled: false,
            time: {
                enabled: true,
                type: 'requery',
                format: '%Y%m',
            },
        }
        L_.layers.data = { [layer.name]: layer }
        L_.layers.layer = { [layer.name]: { id: layer.name } }
        L_.layers.on = { [layer.name]: true }

        L_.configData.time = {
            enabled: true,
            format: '%Y-%m-%dT%H:%M:%SZ',
            initialstart: '2022-01-01T00:00:00Z',
            initialend: '2022-01-15T00:00:00Z',
        }
        // Registers the bus handler commits arrive on. Seeding the times this
        // way does not reload — the layers are not on the map yet.
        TimeControl.init()
        expect(TimeControl.enabled).toBe(true)
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        delete window.mmgisAPI
    })

    const commit = async (month) => {
        window.mmgisAPI.emit('time:changeRequested', {
            startTime: `2022-${month}-01T00:00:00Z`,
            endTime: `2022-${month}-15T00:00:00Z`,
            currentTime: `2022-${month}-15T00:00:00Z`,
        })
        // reloadLayer awaits its URL replacements before reaching the engine.
        await vi.advanceTimersByTimeAsync(0)
    }

    test('reloads once, when the window closes, on an isolated change', async () => {
        await commit('06')

        await vi.advanceTimersByTimeAsync(WINDOW_MS - 1)
        expect(refreshedTimes()).toEqual([])

        await vi.advanceTimersByTimeAsync(1)
        expect(refreshedTimes()).toEqual(['202206'])
    })

    // The held-down arrow key / typed date case: the months passed through
    // are never on screen long enough to be worth a tileset, and the month
    // that matters is the one the user stopped on.
    test('collapses a burst into one reload, carrying the last time', async () => {
        await commit('06')
        await commit('07')
        await commit('08')
        await commit('09')

        await vi.advanceTimersByTimeAsync(WINDOW_MS)

        expect(refreshedTimes()).toEqual(['202209'])
    })

    // Every commit still moves the clock immediately, whatever the reload is
    // waiting for — the time label must never lag the timeline.
    test('commits the time itself with no delay', async () => {
        await commit('06')
        await commit('07')

        expect(TimeControl.getTime()).toBe('2022-07-15T00:00:00Z')
    })

    // Playback at its fastest commits every 100ms and never goes quiet. A
    // commit must not push the booked reload back, or the map would freeze
    // until the user pressed stop: every window still ends in a reload, on
    // the newest tick.
    test('keeps reloading every window through continuous playback', async () => {
        const ticks = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']
        for (const month of ticks) {
            await commit(month)
            await vi.advanceTimersByTimeAsync(100)
        }

        expect(refreshedTimes()).toEqual([
            '202202',
            '202204',
            '202206',
            '202208',
            '202210',
        ])
    })

    // A Leaflet tile layer compiles each tile's URL from its own options when
    // the tile is requested. Written at commit time, a tile a pan exposes
    // inside the window would carry the new time beside on-screen tiles
    // carrying the old one, so a commit leaves the options to the reload -
    // reloadLayer writes them. (`TimeControl.updateLayersTime`, which is
    // public API, writes them itself; commits do not go through it.)
    test('leaves a commit\'s tile options to the reload it books', async () => {
        const leafletLayer = { options: {} }
        L_.layers.layer['NO2 Monthly'] = leafletLayer

        await commit('06')
        expect(leafletLayer.options.time).toBeUndefined()

        await vi.advanceTimersByTimeAsync(WINDOW_MS)
        expect(leafletLayer.options.time).toBe('202206')
    })

    // The other caller of the same times: `updateLayersTime` is public API
    // that promises a layer synchronized with the global times, and a Leaflet
    // raster tile layer is not synchronized until its options carry them.
    test('synchronizes the tile options on updateLayersTime', async () => {
        const leafletLayer = { options: {} }
        L_.layers.layer['NO2 Monthly'] = leafletLayer

        await commit('06')
        expect(TimeControl.updateLayersTime()).toEqual(['NO2 Monthly'])

        expect(leafletLayer.options.time).toBe('202206')
    })

    // A mission swap re-inits TimeControl. A reload the old mission's last
    // commit left booked would otherwise land on the new mission's layers.
    test('drops a booked reload on re-init', async () => {
        await commit('06')

        TimeControl.init()
        await vi.advanceTimersByTimeAsync(WINDOW_MS * 5)

        expect(refreshedTimes()).toEqual([])
    })

    // The wait belongs to the commit path alone. A tool or plugin that calls
    // reloadTimeLayers has asked for a reload now — typically because
    // something other than the time changed — and gets one.
    test('leaves a direct reloadTimeLayers call unthrottled', async () => {
        await commit('06')

        TimeControl.reloadTimeLayers()
        await vi.advanceTimersByTimeAsync(0)

        expect(refreshedTimes()).toEqual(['202206'])
    })

    // That direct call is the flush, not a reload alongside the booked one:
    // it reloads the layers on the times the commit left them, which is
    // exactly what the booking was waiting to do, so letting the window close
    // afterwards would refetch every tileset a second time for nothing.
    test('cancels the booked reload when one is asked for directly', async () => {
        await commit('06')

        TimeControl.reloadTimeLayers()
        await vi.advanceTimersByTimeAsync(WINDOW_MS * 2)

        expect(refreshedTimes()).toEqual(['202206'])
    })
})
