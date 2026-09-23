import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * The timezone is pinned off UTC so the zone-less parsing test below reads a
 * real offset rather than a zero one — on a UTC runner it could otherwise
 * only pass. `vi.hoisted` runs before the imports above whatever its position
 * in the file, so the module under test loads with the offset already set.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/Chicago'
})

/**
 * time:getCurrentFormatted renders the cursor through the mission's
 * time.format, and time:formatTime applies that same format to a time the
 * caller supplies — a per-layer window on an exported legend, say. The format
 * comes in two languages: d3, marked by a specifier such as '%Y', and moment
 * tokens.
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
    // caller can always ask — and gets null rather than an error. (That
    // time:formatTime is registered too is proven by the tests that call it.)
    test('the cursor getter answers null with mission time disabled', async () => {
        const handlers = await initTimeControl({})

        expect(handlers['time:getCurrentFormatted']()).toBeNull()
    })

    // The shape every mission that never touched the field is in.
    test('falls back to the default format when none is configured', async () => {
        const handlers = await initTimeControl(enabledTimeConfig(undefined))

        expect(handlers['time:getCurrentFormatted']()).toBe(
            '2026-08-20T19:24:39Z'
        )
    })

    // Moment would leave the '%'s literal and read 'm' as minutes; either
    // language has to render the date itself, never the pattern string.
    test.each([
        ['moment tokens', 'YYYY-MM-DDTHH:mm:ss[Z]', '2026-08-20T19:24:39Z'],
        ['d3 specifiers', '%-m/%-d/%-y', '8/20/26'],
    ])('formats the cursor through mission %s', async (_lang, format, shown) => {
        const handlers = await initTimeControl(enabledTimeConfig(format))

        expect(handlers['time:getCurrentFormatted']()).toBe(shown)
    })

    // The time comes from the caller, so the cursor's own state is not what
    // gates an answer — a layer with its own window still gets one.
    test('formats a caller-supplied time, even with mission time disabled', async () => {
        const handlers = await initTimeControl({ time: { format: '%d %b %Y' } })

        expect(handlers['time:formatTime']('2015-03-13T00:00:00Z')).toBe(
            '13 Mar 2015'
        )
    })

    // d3 reads a zone-less string as local and moment as UTC, so parsing has
    // to happen once, up front, or the two languages disagree by the offset
    // of the machine the build ran on. The TZ pinned at the top of this file
    // is what supplies that offset regardless of the runner.
    test('reads a zone-less time as UTC in either language', async () => {
        const momentHandlers = await initTimeControl(
            enabledTimeConfig('YYYY-MM-DDTHH:mm:ss[Z]')
        )
        const viaMoment = momentHandlers['time:formatTime'](
            '2026-08-20T19:24:39'
        )

        vi.resetModules()
        const d3Handlers = await initTimeControl(
            enabledTimeConfig('%Y-%m-%dT%H:%M:%SZ')
        )
        const viaD3 = d3Handlers['time:formatTime']('2026-08-20T19:24:39')

        expect(viaMoment).toBe('2026-08-20T19:24:39Z')
        expect(viaD3).toBe(viaMoment)
    })

    // Nothing to format is not something to format badly.
    test.each([[null], ['nope']])(
        'answers null for the unusable time %p',
        async (time) => {
            const handlers = await initTimeControl(enabledTimeConfig())

            expect(handlers['time:formatTime'](time)).toBeNull()
        }
    )
})

/**
 * time:getMode says which mode the bottom Time UI bar is in, so a plugin
 * never has to guess Point mode from an epoch window start. The bar's
 * widgets are only mounted in the desktop default layout; a stand-in
 * startTempus marks it as mounted here without building the DOM.
 */
describe('TimeControl time:getMode provider', () => {
    let originalMmgisAPI

    beforeEach(() => {
        originalMmgisAPI = window.mmgisAPI
        vi.resetModules()
    })

    afterEach(() => {
        window.mmgisAPI = originalMmgisAPI
    })

    // Loaded after initTimeControl, so it is the same instance TimeControl
    // imported.
    const mountTimeUI = async (mode) => {
        const TimeUI = (
            await import('../../src/essence/Basics/TimeControl_/TimeUI')
        ).default
        TimeUI.startTempus = {}
        TimeUI.modeIndex = TimeUI.modes.indexOf(mode)
        return TimeUI
    }

    test.each([
        ['Range', 'range'],
        ['Point', 'point'],
    ])('answers %p mode as %p', async (mode, answer) => {
        const handlers = await initTimeControl(enabledTimeConfig())
        await mountTimeUI(mode)

        expect(handlers['time:getMode']()).toBe(answer)
    })

    test('answers null with mission time disabled', async () => {
        const handlers = await initTimeControl({})
        await mountTimeUI('Range')

        expect(handlers['time:getMode']()).toBeNull()
    })

    // Mobile and the modern layout never mount the bar, so there is no mode
    // to report even with time on.
    test('answers null when the Time UI bar is not mounted', async () => {
        const handlers = await initTimeControl(enabledTimeConfig())

        expect(handlers['time:getMode']()).toBeNull()
    })
})
