import { test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * MapComparison's layout half: which of the two ways to split the map is in
 * effect, how a switch reaches the engine, and what the divider looks like in
 * each.
 *
 * The module is a singleton holding live state and a divider in the document,
 * so every case re-imports it against a fresh fake engine rather than sharing
 * one across the file.
 */

// MapComparison reaches Layers_ through comparisonTimePins, and Layers_ pulls
// Viewer_ in with it — the photosphere, model and PDF viewers, and with them a
// bundled THREE build, react-pdf and WebVR. Nothing here opens a viewer, so
// stub the aggregator to keep the import chain light in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

let MapComparison
let engine
let container
let emitted

const makeEngine = () => ({
    enableComparison: vi.fn(),
    disableComparison: vi.fn(),
    setComparisonDivider: vi.fn(),
    setComparisonLayout: vi.fn(),
    getContainer: () => container,
})

const divider = () => container.querySelector('.mmgis-comparison-divider')

const isSideBySide = () =>
    divider()?.classList.contains('mmgis-comparison-divider--side-by-side')

/** Enable with both sides filled in, which is the only state that draws. */
const enable = (layout) =>
    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['ch4'],
        ...(layout ? { layout } : {}),
    })

beforeEach(async () => {
    vi.resetModules()
    container = document.createElement('div')
    document.body.appendChild(container)

    emitted = []
    window.mmgisAPI = { emit: (event, payload) => emitted.push({ event, payload }) }

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

test.describe('MapComparison layouts', () => {
    test('starts in swipe, the layout comparison has always had', () => {
        enable()
        expect(MapComparison.getState().layout).toBe('swipe')
        expect(engine.enableComparison).toHaveBeenCalledWith(
            expect.objectContaining({ layout: 'swipe' }),
        )
        expect(isSideBySide()).toBe(false)
    })

    test('enable carries a requested layout through to the engine', () => {
        enable('sideBySide')
        expect(engine.enableComparison).toHaveBeenCalledWith({
            leftLayerIds: ['co2'],
            rightLayerIds: ['ch4'],
            layout: 'sideBySide',
        })
        expect(MapComparison.getState().layout).toBe('sideBySide')
        expect(isSideBySide()).toBe(true)
    })

    test('switching layout rebuilds through the engine and re-marks the divider', () => {
        enable()
        MapComparison.setLayout({ layout: 'sideBySide' })

        expect(engine.setComparisonLayout).toHaveBeenCalledWith('sideBySide')
        expect(MapComparison.getState().layout).toBe('sideBySide')
        expect(isSideBySide()).toBe(true)
        expect(emitted).toContainEqual({
            event: 'map:comparison:layoutChanged',
            payload: { layout: 'sideBySide' },
        })
    })

    test('accepts a bare layout name as well as a payload object', () => {
        enable()
        MapComparison.setLayout('sideBySide')
        expect(engine.setComparisonLayout).toHaveBeenCalledWith('sideBySide')
    })

    // The divider is where the user left it, and a layout switch is not a
    // reason to move it — both layouts read the same fraction.
    test('keeps the divider position across a layout switch', () => {
        enable()
        MapComparison.setDividerPosition(0.25)
        MapComparison.setLayout('sideBySide')

        expect(MapComparison.getState().dividerPosition).toBe(0.25)
        expect(divider().style.left).toBe('25%')
    })

    test('a layout chosen before comparison is on rides in on the next enable', () => {
        MapComparison.setLayout('sideBySide')
        expect(engine.setComparisonLayout).not.toHaveBeenCalled()

        enable()
        expect(engine.enableComparison).toHaveBeenCalledWith(
            expect.objectContaining({ layout: 'sideBySide' }),
        )
    })

    test('changing one side leaves the layout alone', () => {
        enable('sideBySide')
        MapComparison.setRightSide({ layers: ['no2'] })

        expect(engine.enableComparison).toHaveBeenLastCalledWith({
            leftLayerIds: ['co2'],
            rightLayerIds: ['no2'],
            layout: 'sideBySide',
        })
    })

    test('an unknown layout is refused rather than passed on', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        enable()
        MapComparison.setLayout('diagonal')

        expect(engine.setComparisonLayout).not.toHaveBeenCalled()
        expect(MapComparison.getState().layout).toBe('swipe')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('diagonal'))
    })

    test('re-selecting the layout already in effect rebuilds nothing', () => {
        enable()
        MapComparison.setLayout('swipe')
        expect(engine.setComparisonLayout).not.toHaveBeenCalled()
    })

    // An engine that only knows how to wipe should say so rather than leave the
    // panel showing a layout the map is not in.
    test('reports an engine that cannot change layout', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        delete engine.setComparisonLayout
        enable()
        MapComparison.setLayout('sideBySide')

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('does not support comparison layouts'),
        )
    })

    test('disable takes the divider down whichever layout it was in', () => {
        enable('sideBySide')
        expect(divider()).not.toBeNull()

        MapComparison.disable()
        expect(divider()).toBeNull()
        expect(engine.disableComparison).toHaveBeenCalled()
    })
})

/**
 * The divider element and the engine's split are two readings of one number,
 * and MapComparison holds it. Every path that has the engine draw comparison
 * has to hand it that number, or the seam lands somewhere other than the line
 * the user sees.
 */
test.describe('MapComparison divider position', () => {
    test('hands the engine the position the divider opens at', () => {
        enable()
        expect(engine.setComparisonDivider).toHaveBeenLastCalledWith(0.5)
    })

    // A close leaves the engine holding wherever the last drag put the split,
    // while the next open draws the divider back at the middle.
    test('re-enabling after a drag puts the engine back under the divider', () => {
        enable()
        MapComparison.setDividerPosition(0.8)
        MapComparison.disable()

        engine.setComparisonDivider.mockClear()
        enable()

        expect(divider().style.left).toBe('50%')
        expect(engine.setComparisonDivider).toHaveBeenLastCalledWith(0.5)
    })

    // Switching layout rebuilds the engine's surfaces, so it is told the
    // position the divider is holding on to across the switch.
    test('hands the engine the kept position on a layout switch', () => {
        enable()
        MapComparison.setDividerPosition(0.25)
        engine.setComparisonDivider.mockClear()
        MapComparison.setLayout('sideBySide')

        expect(engine.setComparisonDivider).toHaveBeenLastCalledWith(0.25)
    })
})
