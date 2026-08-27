import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * TimeControl.init() registers its bus providers (time:isEnabled,
 * time:getCurrent, ...) before checking whether the mission has time
 * enabled, so time:getCurrentFormatted — added alongside them to expose the
 * current time through the mission's time.format rather than a raw ISO
 * string — must always be registered, and must itself resolve null until
 * time is both enabled and seeded.
 *
 * That time.format comes in two languages: d3 time-format specifiers, marked
 * by a '%', and moment tokens. Both must render an actual date.
 */

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// A minimal stand-in for the mmgisAPI bus: captures whatever TimeControl
// registers via `provide`, keyed by name, so a test can call the handler
// directly the way mmgisRequestIfProvided would.
const makeFakeBus = () => {
    const handlers = {}
    return {
        handlers,
        bus: {
            on: () => () => {},
            emit: () => {},
            provide: (name, handler) => {
                handlers[name] = handler
                return () => {
                    delete handlers[name]
                }
            },
        },
    }
}

// Mocks Layers_ with the given mission configData, then imports and inits a
// fresh TimeControl against a fake bus. Returns the captured handlers.
const initTimeControl = async (configData) => {
    const { bus, handlers } = makeFakeBus()
    window.mmgisAPI = bus
    vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
        default: { configData, FUTURES: {}, layers: { data: {}, dataFlat: {} } },
    }))

    const TimeControl = (
        await import('../../src/essence/Basics/TimeControl_/TimeControl')
    ).default
    TimeControl.init()

    return { TimeControl, handlers }
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

describe('TimeControl time:getCurrentFormatted provider', () => {
    let originalMmgisAPI

    beforeEach(() => {
        originalMmgisAPI = window.mmgisAPI
        vi.resetModules()
    })

    afterEach(() => {
        window.mmgisAPI = originalMmgisAPI
    })

    test('is registered even when the mission has time disabled, and resolves null', async () => {
        const { handlers } = await initTimeControl({})

        expect(typeof handlers['time:getCurrentFormatted']).toBe('function')
        expect(handlers['time:getCurrentFormatted']()).toBeNull()
    })

    test('formats the seeded current time through a moment-style mission format', async () => {
        const { TimeControl, handlers } = await initTimeControl(
            enabledTimeConfig('YYYY-MM-DDTHH:mm:ss[Z]')
        )

        // The actual formatted date, never the literal pattern string.
        expect(handlers['time:getCurrentFormatted']()).toBe(
            '2026-08-20T19:24:39Z'
        )
        // Same underlying time as the existing raw-ISO provider, just
        // formatted differently.
        expect(handlers['time:getCurrent']()).toBe(TimeControl.getTime())
    })

    test('formats the seeded current time through a d3-style mission format', async () => {
        const { handlers } = await initTimeControl(
            enabledTimeConfig('%Y-%m-%dT%H:%M:%SZ')
        )

        // Moment would leave the '%'s literal and read 'm' as minutes; d3
        // renders the same date the layer-level time.format contract does.
        expect(handlers['time:getCurrentFormatted']()).toBe(
            '2026-08-20T19:24:39Z'
        )
    })

    test('renders a d3 format whose tokens moment would misread', async () => {
        const { handlers } = await initTimeControl(
            enabledTimeConfig('%d %b %Y')
        )

        expect(handlers['time:getCurrentFormatted']()).toBe('20 Aug 2026')
    })

    test('falls back to the default moment format when the mission has no time.format', async () => {
        const { handlers } = await initTimeControl(enabledTimeConfig())

        expect(handlers['time:getCurrentFormatted']()).toBe(
            '2026-08-20T19:24:39Z'
        )
    })

    test('falls back to the default moment format when time.format is empty', async () => {
        const { handlers } = await initTimeControl(enabledTimeConfig(''))

        expect(handlers['time:getCurrentFormatted']()).toBe(
            '2026-08-20T19:24:39Z'
        )
    })

    test('falls back to the default rather than throwing on an unusable format', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { handlers } = await initTimeControl(enabledTimeConfig(42))

        expect(handlers['time:getCurrentFormatted']()).toBe(
            '2026-08-20T19:24:39Z'
        )
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})
