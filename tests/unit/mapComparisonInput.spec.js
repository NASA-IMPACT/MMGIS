import { test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * How MapComparison treats what it is handed and what it hands back.
 *
 * Every entry point here is reachable from the bus, so the cases worth pinning
 * are the ones core itself would never produce: an object where a number was
 * expected, an engine that cannot do what was asked, a caller that writes into
 * a snapshot, and a drag the browser ends without a `touchend`.
 */

// MapComparison reaches Layers_ through comparisonTimePins, and Layers_ pulls
// Viewer_ in with it — the photosphere, model and PDF viewers, and with them a
// bundled THREE build, react-pdf and WebVR. Nothing here opens a viewer, so
// stub the aggregator to keep the import chain light in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

let MapComparison
let engine
let container

const makeEngine = (overrides = {}) => ({
    enableComparison: vi.fn(),
    disableComparison: vi.fn(),
    setComparisonDivider: vi.fn(),
    setComparisonLayout: vi.fn(),
    getContainer: () => container,
    ...overrides,
})

const divider = () => container.querySelector('.mmgis-comparison-divider')

const enable = () =>
    MapComparison.enable({ leftLayers: ['co2'], rightLayers: ['ch4'] })

beforeEach(async () => {
    vi.resetModules()
    container = document.createElement('div')
    document.body.appendChild(container)
    window.mmgisAPI = { emit: () => {} }
    engine = makeEngine()
    MapComparison = (await import('../../src/essence/Basics/Map_/MapComparison.js')).default
    MapComparison.init(engine)
})

afterEach(() => {
    MapComparison.disable()
    container.remove()
    delete window.mmgisAPI
    vi.restoreAllMocks()
})

test.describe('divider position input', () => {
    test('accepts a payload object as well as a bare number', () => {
        enable()
        MapComparison.setDividerPosition({ position: 0.3 })
        expect(MapComparison.getState().dividerPosition).toBeCloseTo(0.3)
        expect(engine.setComparisonDivider).toHaveBeenLastCalledWith(0.3)
    })

    test('refuses a position that is not a number rather than storing NaN', () => {
        enable()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        MapComparison.setDividerPosition(undefined)
        MapComparison.setDividerPosition({ nope: 1 })
        MapComparison.setDividerPosition('half')

        expect(MapComparison.getState().dividerPosition).toBe(0.5)
        expect(divider().style.left).toBe('50%')
        expect(warn).toHaveBeenCalledTimes(3)
    })

    test('still clamps a number outside 0..1', () => {
        enable()
        MapComparison.setDividerPosition(-2)
        expect(MapComparison.getState().dividerPosition).toBe(0)
        MapComparison.setDividerPosition(9)
        expect(MapComparison.getState().dividerPosition).toBe(1)
    })
})

test('a refused layout switch leaves the reported layout on screen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    MapComparison.init(makeEngine({ setComparisonLayout: undefined }))
    enable()

    MapComparison.setLayout('sideBySide')

    expect(MapComparison.getState().layout).toBe('swipe')
    expect(warn).toHaveBeenCalled()
})

test('a state snapshot cannot be written back into the controller', () => {
    enable()
    const snapshot = MapComparison.getState()

    snapshot.left.layerIds.push('injected')
    snapshot.right.layerIds.length = 0

    expect(MapComparison.getState().left.layerIds).toEqual(['co2'])
    expect(MapComparison.getState().right.layerIds).toEqual(['ch4'])
})

test.describe('touch drag teardown', () => {
    const listeners = () => {
        const added = []
        const removed = []
        vi.spyOn(document, 'addEventListener').mockImplementation(
            (type, handler, options) =>
                added.push(type) &&
                Document.prototype.addEventListener.call(document, type, handler, options),
        )
        vi.spyOn(document, 'removeEventListener').mockImplementation(
            (type, handler, options) =>
                removed.push(type) &&
                Document.prototype.removeEventListener.call(document, type, handler, options),
        )
        return { added, removed }
    }

    test('disabling mid-drag unhooks the touch listeners', () => {
        enable()
        const { added, removed } = listeners()

        divider().dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, cancelable: true }),
        )
        expect(added).toContain('touchmove')

        MapComparison.disable()

        // Left attached, these keep firing on every touch anywhere on the page.
        expect(removed).toContain('touchmove')
        expect(removed).toContain('touchend')
    })

    test('a cancelled gesture unhooks them too', () => {
        enable()
        const { added, removed } = listeners()

        divider().dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, cancelable: true }),
        )
        expect(added).toContain('touchcancel')

        document.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true }))

        expect(removed).toContain('touchmove')
    })
})
