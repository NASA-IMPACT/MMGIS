import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * TimeControl.init() registers its bus providers (time:isEnabled,
 * time:getCurrent, ...) before checking whether the mission has time
 * enabled, so time:getCurrentFormatted — added alongside them to expose the
 * current time through the mission's globalTimeFormat rather than a raw ISO
 * string — must always be registered, and must itself resolve null until
 * time is both enabled and seeded.
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
        const { bus, handlers } = makeFakeBus()
        window.mmgisAPI = bus
        vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
            default: { configData: {}, FUTURES: {}, layers: { data: {}, dataFlat: {} } },
        }))

        const TimeControl = (
            await import('../../src/essence/Basics/TimeControl_/TimeControl')
        ).default
        TimeControl.init()

        expect(typeof handlers['time:getCurrentFormatted']).toBe('function')
        expect(handlers['time:getCurrentFormatted']()).toBeNull()
    })

    test('formats the seeded current time through globalTimeFormat once time is enabled', async () => {
        const { bus, handlers } = makeFakeBus()
        window.mmgisAPI = bus
        vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
            default: {
                configData: {
                    time: {
                        enabled: true,
                        format: '%Y-%m-%d',
                        initialend: '2024-06-15T00:00:00Z',
                        initialstart: '2024-05-15T00:00:00Z',
                    },
                },
                FUTURES: {},
                layers: { data: {}, dataFlat: {} },
            },
        }))

        const TimeControl = (
            await import('../../src/essence/Basics/TimeControl_/TimeControl')
        ).default
        TimeControl.init()

        expect(handlers['time:getCurrentFormatted']()).toBe('2024-06-15')
        // Same underlying time as the existing raw-ISO provider, just
        // formatted differently.
        expect(handlers['time:getCurrent']()).toBe(TimeControl.getTime())
    })
})
