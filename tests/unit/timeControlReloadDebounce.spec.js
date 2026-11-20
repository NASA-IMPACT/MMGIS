import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * A time change reloads every time-enabled layer, and each reload refetches
 * all of that layer's visible tiles. Scrubbing the timeline changes the time
 * once per slider step, so the reload waits until the time holds still and
 * runs once for the position the user stopped on. Playback and live mode
 * step on their own clock and still reload on every step.
 */

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const loadTimeControl = async () => {
    window.mmgisAPI = undefined
    vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
        default: {
            configData: {},
            FUTURES: {},
            layers: { data: {}, dataFlat: {}, layer: {} },
            asLayerUUID: (name) => name,
        },
    }))
    const TimeControl = (
        await import('../../src/essence/Basics/TimeControl_/TimeControl')
    ).default
    const TimeUI = (await import('../../src/essence/Basics/TimeControl_/TimeUI'))
        .default
    TimeControl.enabled = true
    TimeControl.reloadTimeLayers = vi.fn()
    return { TimeControl, TimeUI }
}

// One committed time change, as a slider step or a typed time makes.
const step = (TimeControl, i) => {
    TimeControl.startTime = '2026-08-01T00:00:00Z'
    TimeControl.endTime = `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00Z`
    TimeControl.currentTime = TimeControl.endTime
    TimeControl.fina()
}

describe('TimeControl time-driven reload debounce', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.doUnmock('../../src/essence/Basics/Layers_/Layers_')
        delete window.mmgisAPI
    })

    test('a single time change reloads once, after the delay', async () => {
        const { TimeControl } = await loadTimeControl()

        step(TimeControl, 0)
        vi.advanceTimersByTime(199)
        expect(TimeControl.reloadTimeLayers).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(TimeControl.reloadTimeLayers).toHaveBeenCalledTimes(1)
    })

    test('a rapid series of time changes reloads once, after the last', async () => {
        const { TimeControl } = await loadTimeControl()

        for (let i = 0; i < 10; i++) {
            step(TimeControl, i)
            vi.advanceTimersByTime(50)
        }
        expect(TimeControl.reloadTimeLayers).not.toHaveBeenCalled()

        vi.advanceTimersByTime(200)
        expect(TimeControl.reloadTimeLayers).toHaveBeenCalledTimes(1)
    })

    test.each(['play', 'now'])(
        'TimeUI %s mode reloads on every step without waiting',
        async (flag) => {
            const { TimeControl, TimeUI } = await loadTimeControl()
            TimeUI[flag] = true

            for (let i = 0; i < 3; i++) step(TimeControl, i)

            expect(TimeControl.reloadTimeLayers).toHaveBeenCalledTimes(3)
        }
    )
})
