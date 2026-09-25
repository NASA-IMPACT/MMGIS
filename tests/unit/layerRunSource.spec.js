import { describe, test, expect, vi } from 'vitest'
import {
    fetchLayerRunSource,
    applyRunSelection,
    newestRuns,
    leadRangeOf,
    runWindow,
    leadAt,
} from '../../src/essence/Basics/TimeControl_/layerRunSource'

const RUNS_URL = 'https://svc/dataset/coordinates/reference_time?url=s3://b/o3'
const LEAD_URL = 'https://svc/dataset/coordinates/lead?url=s3://b/o3'
const NEWEST = '2026-09-21T12:00:00'
const OLDER = '2026-09-21T06:00:00'
const OLDEST = '2026-09-20T12:00:00'

const answering = (byUrl) =>
    vi.fn(async (url) => {
        const body = byUrl[url]
        if (body === undefined) return { ok: false, status: 404 }
        return { ok: true, json: async () => body }
    })

const layerWith = (runs, extra = {}) => ({
    name: 'fc',
    display_name: 'NAQFC O3',
    time: { enabled: true, runs: { url: RUNS_URL, leadUrl: LEAD_URL, ...runs }, ...extra },
})

describe('run source helpers', () => {
    test('newestRuns sorts by instant, keeps the newest n, newest first, and drops junk', () => {
        expect(newestRuns([OLDER, 7, '', 'nope', NEWEST, OLDEST], 2)).toEqual([NEWEST, OLDER])
        expect(newestRuns(null, 3)).toEqual([])
    })

    test('leadRangeOf spans the smallest to the largest lead', () => {
        expect(leadRangeOf([1, 2, 3, 72])).toEqual([1, 72])
        expect(leadRangeOf([])).toBeNull()
    })

    test('runWindow steps from the run by the lead range, reading naive ISO as UTC', () => {
        expect(runWindow(OLDER, { step: 'PT1H', leadRange: [1, 72] })).toEqual({
            start: '2026-09-21T07:00:00Z',
            end: '2026-09-24T06:00:00Z',
        })
        expect(runWindow('2026-01-31T00:00:00', { step: 'P1M', leadRange: [0, 1] })).toEqual({
            start: '2026-01-31T00:00:00Z',
            end: '2026-02-28T00:00:00Z',
        })
        expect(runWindow(OLDER, { step: 'PT1H' })).toEqual({
            start: '2026-09-21T06:00:00Z',
            end: '2026-09-21T06:00:00Z',
        })
    })

    test('leadAt counts whole steps from the pin to an instant', () => {
        const runs = { selected: OLDER, step: 'PT1H' }
        expect(leadAt(runs, '2026-09-22T00:00:00Z')).toBe(18)
        expect(leadAt(runs, '2026-09-21T11:40:00Z')).toBe(6)
        expect(leadAt({ step: 'PT1H' }, '2026-09-22T00:00:00Z')).toBeNull()
        expect(leadAt(null, '2026-09-22T00:00:00Z')).toBeNull()
    })

    test('applyRunSelection pins a listed run and derives the window; refuses an unlisted one', () => {
        const time = { enabled: true, runs: { list: [NEWEST, OLDER], step: 'PT1H', leadRange: [1, 72] } }
        expect(applyRunSelection(time, OLDER)).toBe(true)
        expect(time.runs.selected).toBe(OLDER)
        expect(time.dataStartTime).toBe('2026-09-21T07:00:00Z')
        expect(time.dataEndTime).toBe('2026-09-24T06:00:00Z')
        expect(applyRunSelection(time, '2020-01-01T00:00:00')).toBe(false)
        expect(time.runs.selected).toBe(OLDER)
    })
})

describe('fetchLayerRunSource', () => {
    test('reads runs and leads, keeps the newest offered, and pins the newest', async () => {
        const fetchImpl = answering({
            [RUNS_URL]: { data: [OLDEST, OLDER, NEWEST] },
            [LEAD_URL]: { data: [1, 2, 3, 72] },
        })
        const layer = layerWith({ offer: 2, step: 'PT1H' })

        expect(await fetchLayerRunSource(layer, { fetchImpl })).toBe(true)
        expect(layer.time.runs.list).toEqual([NEWEST, OLDER])
        expect(layer.time.runs.leadRange).toEqual([1, 72])
        expect(layer.time.runs.selected).toBe(NEWEST)
        expect(layer.time.dataStartTime).toBe('2026-09-21T13:00:00Z')
        expect(layer.time.dataEndTime).toBe('2026-09-24T12:00:00Z')
    })

    test('reads the lists through the configured paths', async () => {
        const fetchImpl = answering({
            [RUNS_URL]: { coords: { reference_time: [OLDER, NEWEST] } },
            [LEAD_URL]: { coords: { lead: [3, 4] } },
        })
        const layer = layerWith({ path: 'coords.reference_time', leadPath: 'coords.lead' })
        expect(await fetchLayerRunSource(layer, { fetchImpl })).toBe(true)
        expect(layer.time.runs.list).toEqual([NEWEST, OLDER])
        expect(layer.time.runs.leadRange).toEqual([3, 4])
    })

    test('keeps an existing selection that is still listed', async () => {
        const fetchImpl = answering({ [RUNS_URL]: { data: [OLDER, NEWEST] }, [LEAD_URL]: { data: [1, 2] } })
        const layer = layerWith({ selected: OLDER })
        await fetchLayerRunSource(layer, { fetchImpl })
        expect(layer.time.runs.selected).toBe(OLDER)
    })

    test('pins the run alone when there is no lead source', async () => {
        const fetchImpl = answering({ [RUNS_URL]: { data: [NEWEST] } })
        const layer = layerWith({ leadUrl: undefined })
        expect(await fetchLayerRunSource(layer, { fetchImpl })).toBe(true)
        expect(layer.time.runs.leadRange).toBeNull()
        expect(layer.time.dataStartTime).toBe('2026-09-21T12:00:00Z')
        expect(layer.time.dataEndTime).toBe('2026-09-21T12:00:00Z')
    })

    test('a source that fails leaves the layer as configured and warns once', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const fetchImpl = answering({})
        const layer = layerWith({}, { dataStartTime: '2026-01-01T00:00:00Z' })
        expect(await fetchLayerRunSource(layer, { fetchImpl })).toBe(false)
        expect(layer.time.runs.list).toBeUndefined()
        expect(layer.time.dataStartTime).toBe('2026-01-01T00:00:00Z')
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    test('does nothing for a layer without a runs url, or with time off', async () => {
        const fetchImpl = vi.fn()
        expect(await fetchLayerRunSource({ time: { enabled: true, runs: {} } }, { fetchImpl })).toBe(false)
        expect(await fetchLayerRunSource({ time: { enabled: false, runs: { url: RUNS_URL } } }, { fetchImpl })).toBe(false)
        expect(await fetchLayerRunSource({ time: { enabled: true } }, { fetchImpl })).toBe(false)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('resolves a relative url against the mission path', async () => {
        const fetchImpl = answering({ '/Missions/M/runs.json': { data: [NEWEST] } })
        const layer = layerWith({ url: 'runs.json', leadUrl: undefined })
        await fetchLayerRunSource(layer, { fetchImpl, missionPath: '/Missions/M/' })
        expect(fetchImpl.mock.calls[0][0]).toBe('/Missions/M/runs.json')
    })
})

describe('fetchLayerRunSource against the global fetch', () => {
    test('calls the browser fetch as a free function, never as a method', async () => {
        // A browser's fetch throws "Illegal invocation" when `this` is anything
        // but the window; this stand-in enforces the same rule.
        const strict = function (url) {
            if (this !== undefined && this !== globalThis) {
                throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
            }
            return Promise.resolve({ ok: true, json: async () => ({ data: url.includes('lead') ? [1, 2] : [OLDER, NEWEST] }) })
        }
        vi.stubGlobal('fetch', strict)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const layer = layerWith({})
            expect(await fetchLayerRunSource(layer)).toBe(true)
            expect(layer.time.runs.selected).toBe(NEWEST)
            expect(warn).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
            warn.mockRestore()
        }
    })
})
