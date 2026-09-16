import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * time:getCurrentFormatted renders the cursor through the mission's
 * time.format, and time:formatTime applies that same format to a time the
 * caller supplies — a per-layer window on an exported legend, say. The format
 * comes in two languages: d3 specifiers, marked by a '%', and moment tokens.
 */

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// A minimal stand-in for the mmgisAPI bus: captures whatever TimeControl
// registers via `provide`, keyed by name, so a test can call the handler
// directly the way mmgisRequestIfProvided would.
const initTimeControl = async (configData) => {
    const handlers = {}
    window.mmgisAPI = {
        on: () => () => {},
        emit: () => {},
        provide: (name, handler) => {
            handlers[name] = handler
            return () => delete handlers[name]
        },
    }
    vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
        default: { configData, FUTURES: {}, layers: { data: {}, dataFlat: {} } },
    }))

    const TimeControl = (
        await import('../../src/essence/Basics/TimeControl_/TimeControl')
    ).default
    TimeControl.init()

    return handlers
}

// A mission with time on and seeded, formatted however the caller writes it.
const enabledTimeConfig = (format) => ({
    time: {
        enabled: true,
        ...(format === undefined ? {} : { format }),
        initialend: '2026-08-20T19:24:39Z',
        initialstart: '2026-07-20T19:24:39Z',
    },
})

describe('TimeControl time formatting providers', () => {
    let originalMmgisAPI

    beforeEach(() => {
        originalMmgisAPI = window.mmgisAPI
        vi.resetModules()
    })

    afterEach(() => {
        window.mmgisAPI = originalMmgisAPI
    })

    // Registration happens before the mission's time settings are read, so a
    // caller can always ask — and gets null rather than an error.
    test('both providers are registered even with mission time disabled', async () => {
        const handlers = await initTimeControl({})

        expect(typeof handlers['time:getCurrentFormatted']).toBe('function')
        expect(handlers['time:getCurrentFormatted']()).toBeNull()
        expect(typeof handlers['time:formatTime']).toBe('function')
    })

    // Moment would leave the '%'s literal and read 'm' as minutes; either
    // language has to render the date itself, never the pattern string.
    test.each([
        ['moment tokens', 'YYYY-MM-DDTHH:mm:ss[Z]', '2026-08-20T19:24:39Z'],
        ['d3 specifiers', '%d %b %Y', '20 Aug 2026'],
    ])('formats the cursor through mission %s', async (_lang, format, shown) => {
        const handlers = await initTimeControl(enabledTimeConfig(format))

        expect(handlers['time:getCurrentFormatted']()).toBe(shown)
    })

    // The time comes from the caller, so the cursor's own state is not what
    // gates an answer — a layer with its own window still gets one.
    test('formats a caller-supplied time, even with mission time disabled', async () => {
        const handlers = await initTimeControl({ time: { format: '%d %b %Y' } })

        expect(handlers['time:formatTime']('2015-03-13T00:00:00Z')).toBe(
            '13 Mar 2015',
        )
    })
})
