import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import * as moment from 'moment'

// TimeControl.init seeds the cursor from a deep link's currentTime when the
// link carries one inside its window; otherwise the cursor sits at the window
// end, as it always has. The layers' first window follows the same cursor.

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const timeLayer = () => ({
    name: 'NO2 Monthly',
    type: 'tile',
    time: { enabled: true, type: 'requery', format: '%Y-%m-%dT%H:%M:%SZ' },
})

const initTimeControl = async (futures) => {
    window.mmgisAPI = {
        on: () => () => {},
        emit: () => {},
        provide: () => () => {},
    }
    const layer = timeLayer()
    vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
        default: {
            configData: {
                time: {
                    enabled: true,
                    initialstart: '2026-07-20T00:00:00Z',
                    initialend: '2026-08-20T00:00:00Z',
                },
            },
            FUTURES: futures,
            layers: { data: { no2: layer }, dataFlat: { no2: layer }, layer: {} },
        },
    }))
    const TimeControl = (
        await import('../../src/essence/Basics/TimeControl_/TimeControl')
    ).default
    TimeControl.init()
    return { TimeControl, layer }
}

describe('TimeControl.init with a deep-linked time cursor', () => {
    let originalMmgisAPI
    let warn

    beforeEach(() => {
        originalMmgisAPI = window.mmgisAPI
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.resetModules()
    })

    afterEach(() => {
        window.mmgisAPI = originalMmgisAPI
        warn.mockRestore()
    })

    test('seeds the cursor from the link when it falls inside the window', async () => {
        const { TimeControl, layer } = await initTimeControl({
            startTime: moment.utc('2026-07-20T00:00:00Z'),
            endTime: moment.utc('2026-08-20T00:00:00Z'),
            currentTime: moment.utc('2026-08-05T12:00:00Z'),
        })

        expect(TimeControl.startTime).toBe('2026-07-20T00:00:00.000Z')
        expect(TimeControl.endTime).toBe('2026-08-20T00:00:00.000Z')
        expect(TimeControl.currentTime).toBe('2026-08-05T12:00:00.000Z')
        expect(layer.time.start).toBe('2026-07-20T00:00:00Z')
        expect(layer.time.end).toBe('2026-08-05T12:00:00Z')
        expect(warn).not.toHaveBeenCalled()
    })

    test('falls back to the window end for a cursor outside the window', async () => {
        const { TimeControl, layer } = await initTimeControl({
            startTime: moment.utc('2026-07-20T00:00:00Z'),
            endTime: moment.utc('2026-08-20T00:00:00Z'),
            currentTime: moment.utc('2026-09-01T00:00:00Z'),
        })

        expect(TimeControl.currentTime).toBe('2026-08-20T00:00:00.000Z')
        expect(layer.time.end).toBe('2026-08-20T00:00:00Z')
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('outside the time window')
        )
    })

    test('keeps the cursor at the window end when the link names none', async () => {
        const { TimeControl, layer } = await initTimeControl({
            startTime: moment.utc('2026-07-20T00:00:00Z'),
            endTime: moment.utc('2026-08-20T00:00:00Z'),
        })

        expect(TimeControl.currentTime).toBe('2026-08-20T00:00:00.000Z')
        expect(layer.time.end).toBe('2026-08-20T00:00:00Z')
    })

    test('seeds from the configured window when there is no deep link', async () => {
        const { TimeControl } = await initTimeControl({})

        expect(TimeControl.currentTime).toBe('2026-08-20T00:00:00.000Z')
    })
})
