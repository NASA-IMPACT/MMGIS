import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { getExportLegendModel } from '../../../src/essence/Tools/_shared/legend/getExportLegendModel.ts'
import { measureLegendBand, drawLegendBand } from '../../../src/essence/Tools/_shared/legend/renderLegendBand.ts'

// The model is built from the bus alone, so the bus is a switch on the
// request name. Every handler is "provided"; the defaults are what a quiet
// mission answers.

const LAYERS = {
    pm25: { display_name: 'PM2.5', time: { enabled: true } },
    o3: { display_name: 'Ozone', time: { enabled: true } },
    roads: { display_name: 'Roads' },
}
const EXTENTS = {
    pm25: { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z', interval: null, periodAnchor: null },
    o3: { start: '2026-09-01T00:00:00Z', end: '2026-09-30T00:00:00Z', interval: null, periodAnchor: null },
}

let answers
const bus = (overrides = {}) => {
    answers = {
        'layers:getAllConfigs': LAYERS,
        'layers:getVisible': { pm25: true, o3: true, roads: true },
        'layers:getAllOpacities': {},
        'layers:getLegend': {},
        'layers:getOrder': ['pm25', 'o3', 'roads'],
        'map:getViewState': { missionName: 'Air4US' },
        'time:getStart': null,
        'time:getCurrent': '2026-09-15T00:00:00Z',
        'time:getMode': 'point',
        'time:getCurrentFormatted': '2026-09-15',
        'time:getTimeZone': 'UTC',
        'time:formatTime': '2026-11-05',
        'layers:getTemporalExtent': EXTENTS,
        'layers:getDataCoverage': {},
        'map:comparison:getState': null,
        ...overrides,
    }
    window.mmgisAPI = {
        hasHandler: (name) => name in answers,
        request: async (name) => answers[name] ?? null,
        on: () => () => {},
        emit: () => {},
    }
}

const comparison = (overrides = {}) => ({
    enabled: true,
    layout: 'swipe',
    dividerPosition: 0.5,
    left: { layerIds: ['pm25'], date: null, label: 'PM2.5' },
    right: { layerIds: ['o3'], date: null, label: 'Ozone' },
    ...overrides,
})

const rowsOf = (model) => model.rows.map(({ side, title, dateLine }) => ({ side, title, dateLine }))

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
    delete window.mmgisAPI
    vi.restoreAllMocks()
})

describe('getExportLegendModel during a comparison', () => {
    test('with comparison off, every switched-on layer is a row with no side', async () => {
        bus()
        const model = await getExportLegendModel()
        expect(rowsOf(model)).toEqual([
            { side: undefined, title: 'PM2.5', dateLine: 'Collected 2026-09-01 → 2026-09-15' },
            { side: undefined, title: 'Ozone', dateLine: 'Collected 2026-09-01 → 2026-09-15' },
            { side: undefined, title: 'Roads', dateLine: null },
        ])
    })

    // Layers mode: one layer a side. The switched-on layer on neither side is
    // drawn on neither, so it has no place in the band.
    test('layers mode: one row per side under its caption, and no row for a layer on neither side', async () => {
        bus({ 'map:comparison:getState': comparison() })
        const model = await getExportLegendModel()
        expect(rowsOf(model)).toEqual([
            { side: 'PM2.5', title: 'PM2.5', dateLine: 'Collected 2026-09-01 → 2026-09-15' },
            { side: 'Ozone', title: 'Ozone', dateLine: 'Collected 2026-09-01 → 2026-09-15' },
        ])
    })

    // Dates mode: the same layers on both sides, one side pinned to its own
    // date, the other following the global cursor.
    test('dates mode: each side lists the shared layers at its own date', async () => {
        bus({
            'map:comparison:getState': comparison({
                left: { layerIds: ['pm25', 'o3'], date: null, label: '2026-09-15' },
                right: { layerIds: ['pm25', 'o3'], date: '2026-09-02T00:00:00Z', label: '2026-09-02' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model)).toEqual([
            { side: '2026-09-15', title: 'PM2.5', dateLine: 'Collected 2026-09-01 → 2026-09-15' },
            { side: '2026-09-15', title: 'Ozone', dateLine: 'Collected 2026-09-01 → 2026-09-15' },
            { side: '2026-09-02', title: 'PM2.5', dateLine: 'Collected 2026-09-01 → 2026-09-02' },
            { side: '2026-09-02', title: 'Ozone', dateLine: 'Collected 2026-09-01 → 2026-09-02' },
        ])
    })

    test('a side pinned outside a layer\'s coverage says so instead of dating it', async () => {
        bus({
            'map:comparison:getState': comparison({
                right: { layerIds: ['o3'], date: '2026-10-20T00:00:00Z', label: '' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model)[1]).toEqual({ side: 'Right', title: 'Ozone', dateLine: 'No data at 2026-10-20' })
    })

    // The panel may have a side's layer switched off (comparison draws it
    // regardless), and a layer core no longer knows is simply absent.
    test('a side\'s layer is listed even if the panel has it off; an unknown id is skipped', async () => {
        bus({
            'layers:getVisible': { pm25: false, o3: true, roads: true },
            'map:comparison:getState': comparison({
                left: { layerIds: ['pm25', 'gone'], date: null, label: 'PM2.5' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model).map((r) => r.title)).toEqual(['PM2.5', 'Ozone'])
    })

    test('an untimed layer on a pinned side keeps its plain extent line', async () => {
        bus({
            'map:comparison:getState': comparison({
                right: { layerIds: ['roads'], date: '2026-09-02T00:00:00Z', label: 'Roads' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model)[1]).toEqual({ side: 'Roads', title: 'Roads', dateLine: null })
    })
})

describe('renderLegendBand with sides', () => {
    const makeCtx = (calls) => ({
        fillStyle: null,
        font: '',
        textBaseline: 'alphabetic',
        fillRect: () => {},
        fillText: (...args) => calls.push(args),
        measureText: (t) => ({ width: t.length * 6 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        save: () => {},
        restore: () => {},
    })
    const model = (rows) => ({ missionName: 'M', headerFacts: [], rows })

    test('a row with a side is taller by one caption line, and the caption is drawn above the title', () => {
        const plain = model([{ kind: 'plain', title: 'PM2.5', dateLine: null }])
        const sided = model([{ kind: 'plain', title: 'PM2.5', dateLine: null, side: 'Left' }])
        const h0 = measureLegendBand(makeCtx([]), plain, 800, 1)
        const h1 = measureLegendBand(makeCtx([]), sided, 800, 1)
        expect(h1 - h0).toBe(12 + 4)

        const calls = []
        drawLegendBand(makeCtx(calls), sided, 800, 0, h1, 1)
        const side = calls.find(([text]) => text === 'Left')
        const title = calls.find(([text]) => text === 'PM2.5')
        expect(side[2]).toBeLessThan(title[2])
        expect(side[1]).toBe(title[1])
    })
})
