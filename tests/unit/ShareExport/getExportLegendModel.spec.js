import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { getExportLegendModel } from '../../../src/essence/Tools/_shared/legend/getExportLegendModel.ts'
import { measureLegendBand, drawLegendBand } from '../../../src/essence/Tools/_shared/legend/renderLegendBand.ts'

// The model is built from the bus alone, so the bus is a switch on the
// request name. Every handler is "provided"; the defaults are what a quiet
// mission answers.

// Timed layers carry the window core last requested for them, which is the
// global cursor's, not any side's pin.
const LAYERS = {
    pm25: { display_name: 'PM2.5', time: { enabled: true, start: '2008-01-01T00:00:00Z', end: '2026-09-15T00:00:00Z' } },
    o3: { display_name: 'Ozone', time: { enabled: true, start: '2008-01-01T00:00:00Z', end: '2026-09-15T00:00:00Z' } },
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

    // Dates mode: the same layers on both sides, one pinned to its own date,
    // the other following the global cursor. The colours are the same either
    // side, so each layer is one row naming both dates.
    test('dates mode: each shared layer is one row naming both sides\' dates', async () => {
        bus({
            'map:comparison:getState': comparison({
                left: { layerIds: ['pm25', 'o3'], date: null, label: 'Sep 15, 2026' },
                right: { layerIds: ['pm25', 'o3'], date: '2026-09-02T00:00:00Z', label: 'Sep 2, 2026' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model)).toEqual([
            { side: undefined, title: 'PM2.5', dateLine: 'Sep 15, 2026 · Sep 2, 2026' },
            { side: undefined, title: 'Ozone', dateLine: 'Sep 15, 2026 · Sep 2, 2026' },
        ])
    })

    test('dates mode: a side with nothing at its date says so on the row', async () => {
        bus({
            'layers:getDataCoverage': { o3: { outOfDataRange: true } },
            'map:comparison:getState': comparison({
                left: { layerIds: ['pm25', 'o3', 'roads'], date: null, label: 'Sep 15, 2026' },
                right: { layerIds: ['pm25', 'o3', 'roads'], date: '2026-10-20T00:00:00Z', label: 'Oct 20, 2026' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model).map((r) => r.dateLine)).toEqual([
            'Sep 15, 2026 · No data at Oct 20, 2026',
            'No data at Sep 15, 2026 · No data at Oct 20, 2026',
            // An untimed layer is the same at any date.
            'Sep 15, 2026 · Oct 20, 2026',
        ])
    })

    // A pinned side's line is built from the pin, not from the window core
    // last requested for the layer, which is the global cursor's.
    test('layers mode: a pinned side dates its layer at the pin', async () => {
        bus({
            'map:comparison:getState': comparison({
                right: { layerIds: ['o3'], date: '2026-09-02T00:00:00Z', label: 'Ozone' },
            }),
        })
        const model = await getExportLegendModel()
        expect(rowsOf(model)[1]).toEqual({ side: 'Ozone', title: 'Ozone', dateLine: 'Collected 2026-09-01 → 2026-09-02' })
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
