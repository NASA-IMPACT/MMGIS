import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../getLayersWithLegends', () => ({
    getLayersWithLegends: vi.fn(),
}))
// Only the handlers the model actually reaches for are mocked, so it would
// fail loudly if it started requesting anything else.
vi.mock('../../adapters/mmgisAPI', () => ({
    mmgisGetViewState: vi.fn(),
    mmgisGetTimeCurrentFormatted: vi.fn(),
    mmgisFormatTime: vi.fn(),
}))

import { getLayersWithLegends } from '../getLayersWithLegends'
import {
    mmgisGetViewState,
    mmgisGetTimeCurrentFormatted,
    mmgisFormatTime,
} from '../../adapters/mmgisAPI'
import { getExportLegendModel } from '../getExportLegendModel'

const baseLayer = (overrides) => ({
    id: 'layer',
    title: 'Layer',
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    ...overrides,
})

// Both header times go through the mission's own format, so this fake just
// marks that a timestamp went through core.
const formatted = (time) => `fmt(${time})`

beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(mmgisGetViewState).mockResolvedValue({
        missionName: 'Test Mission',
        time: null,
        center: null,
        zoom: null,
    })
    vi.mocked(mmgisGetTimeCurrentFormatted).mockResolvedValue(null)
    vi.mocked(mmgisFormatTime).mockImplementation(async (time) =>
        time == null ? null : formatted(time),
    )
})

describe('getExportLegendModel', () => {
    // Core already resolved each layer's legend; the model only picks the
    // shape it draws as, and a layer with nothing to draw still gets its name
    // on the band.
    test('draws each layer as the legend core resolved for it', async () => {
        vi.mocked(getLayersWithLegends).mockResolvedValue([
            baseLayer({
                title: 'Displacement',
                type: 'gradient',
                stops: ['#000', '#fff'],
                min: 0,
                max: 10,
                unit: { label: 'm' },
            }),
            baseLayer({
                title: 'Classes',
                type: 'categorical',
                categoricalStops: [{ color: '#abc', label: 'Rock' }],
            }),
            baseLayer({ title: 'Basemap', type: 'none' }),
            baseLayer({ title: 'Empty gradient', type: 'gradient', stops: [] }),
        ])
        expect((await getExportLegendModel()).rows).toEqual([
            {
                kind: 'gradient',
                title: 'Displacement',
                colors: ['#000', '#fff'],
                min: 0,
                max: 10,
                unit: 'm',
            },
            {
                kind: 'categorical',
                title: 'Classes',
                stops: [{ color: '#abc', label: 'Rock' }],
            },
            { kind: 'plain', title: 'Basemap' },
            { kind: 'plain', title: 'Empty gradient' },
        ])
    })

    // A layer turned all the way down paints nothing, so it says nothing. No
    // other test narrows the list — a layer that is toggled on is on the band,
    // wherever the map happens to be looking.
    test('drops a layer at zero opacity and keeps every other one', async () => {
        vi.mocked(getLayersWithLegends).mockResolvedValue([
            baseLayer({ id: 'faded', title: 'Faded', opacity: 0.2 }),
            baseLayer({ id: 'off', title: 'Invisible', opacity: 0 }),
            baseLayer({ id: 'far', title: 'Far away', opacity: 1 }),
        ])
        const model = await getExportLegendModel()
        expect(model.rows.map((r) => r.title)).toEqual(['Faded', 'Far away'])
        // Only the layers the user has toggled on are asked for.
        expect(vi.mocked(getLayersWithLegends).mock.calls).toEqual([
            [{ showOnlyVisible: true }],
        ])
    })

    test('prints the cursor and the export time under the mission name', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-09-02T18:30:00Z'))
        try {
            vi.mocked(getLayersWithLegends).mockResolvedValue([baseLayer({})])
            vi.mocked(mmgisGetTimeCurrentFormatted).mockResolvedValue('Sol 1234')
            const model = await getExportLegendModel()
            expect(model.missionName).toBe('Test Mission')
            expect(model.headerLines).toEqual([
                'Time cursor Sol 1234',
                `Exported ${formatted('2026-09-02T18:30:00.000Z')}`,
            ])
        } finally {
            vi.useRealTimers()
        }
    })

    // A mission without time has no cursor to name, and a time bus that
    // cannot answer costs the header a line, never the band its rows.
    test('a throwing time bus leaves the rows and the export line intact', async () => {
        vi.mocked(getLayersWithLegends).mockResolvedValue([
            baseLayer({ title: 'Displacement' }),
        ])
        vi.mocked(mmgisGetTimeCurrentFormatted).mockRejectedValue(
            new Error('no time'),
        )
        const model = await getExportLegendModel()
        expect(model.rows.map((r) => r.title)).toEqual(['Displacement'])
        expect(model.headerLines).toHaveLength(1)
        expect(model.headerLines[0]).toMatch(/^Exported fmt\(/)
    })
})
