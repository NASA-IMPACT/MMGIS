import { test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The date half of MapComparison: a side pinned to a date must reach the engine
 * as the props that redraw its layers there, and a side with no date must reach
 * it with nothing, so it keeps following the global timeline.
 *
 * The module is a singleton holding live state and a divider in the document,
 * so every case re-imports it against a fresh fake engine.
 */

let MapComparison
let engine
let container
let pinCalls

const makeEngine = () => ({
    enableComparison: vi.fn(),
    disableComparison: vi.fn(),
    setComparisonDivider: vi.fn(),
    setComparisonLayout: vi.fn(),
    getContainer: () => container,
})

beforeEach(async () => {
    vi.resetModules()
    container = document.createElement('div')
    document.body.appendChild(container)
    window.mmgisAPI = { emit: () => {} }

    pinCalls = []
    vi.doMock('../../src/essence/Basics/Map_/comparisonTimePins', () => ({
        pinWindowFor: (instant) => ({ start: 'GLOBAL_START', end: instant }),
        buildTimePinnedProps: (ids, pin) => {
            pinCalls.push({ ids, pin })
            return Object.fromEntries(
                ids.map((id) => [id, { data: `${id}@${pin.end}` }]),
            )
        },
    }))

    MapComparison = (await import('../../src/essence/Basics/Map_/MapComparison')).default
    engine = makeEngine()
    MapComparison.init(engine)
})

afterEach(() => {
    MapComparison.disable()
    container.remove()
    delete window.mmgisAPI
})

const lastConfig = () => engine.enableComparison.mock.calls.at(-1)[0]

test('a pinned side reaches the engine as props for its layers', () => {
    MapComparison.enable({
        leftLayers: ['co2', 'roads'],
        rightLayers: ['co2', 'roads'],
        rightDate: '2024-06-15T00:00:00Z',
    })

    expect(lastConfig().rightLayerProps).toEqual({
        co2: { data: 'co2@2024-06-15T00:00:00Z' },
        roads: { data: 'roads@2024-06-15T00:00:00Z' },
    })
    expect(pinCalls).toEqual([
        {
            ids: ['co2', 'roads'],
            pin: { start: 'GLOBAL_START', end: '2024-06-15T00:00:00Z' },
        },
    ])
})

test('an unpinned side sends no props, so it follows the global timeline', () => {
    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['co2'],
        rightDate: '2024-06-15T00:00:00Z',
    })

    expect(lastConfig().leftLayerProps).toBeUndefined()
})

test('both sides can be pinned independently', () => {
    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['co2'],
        leftDate: '2024-01-15T00:00:00Z',
        rightDate: '2024-06-15T00:00:00Z',
    })

    expect(lastConfig().leftLayerProps.co2.data).toBe('co2@2024-01-15T00:00:00Z')
    expect(lastConfig().rightLayerProps.co2.data).toBe('co2@2024-06-15T00:00:00Z')
})

test('changing one side re-pins it without disturbing the other', () => {
    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['co2'],
        rightDate: '2024-06-15T00:00:00Z',
    })

    MapComparison.setRightSide({
        layers: ['co2', 'roads'],
        date: '2024-09-01T00:00:00Z',
    })

    expect(lastConfig().rightLayerProps).toEqual({
        co2: { data: 'co2@2024-09-01T00:00:00Z' },
        roads: { data: 'roads@2024-09-01T00:00:00Z' },
    })
    expect(lastConfig().leftLayerProps).toBeUndefined()
})

test('a date change leaves the divider where the user put it', () => {
    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['co2'],
        rightDate: '2024-06-15T00:00:00Z',
    })
    MapComparison.setDividerPosition(0.25)

    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['co2'],
        rightDate: '2024-07-15T00:00:00Z',
    })

    expect(MapComparison.getState().dividerPosition).toBe(0.25)
})
