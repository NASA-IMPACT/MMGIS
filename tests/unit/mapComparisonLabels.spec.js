import { test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The captions MapComparison writes over the map — what each side of the
 * divider is showing, named on the map itself rather than only in the panel.
 *
 * The module is a singleton holding live state and chrome in the document, so
 * every case re-imports it against a fresh fake engine rather than sharing one
 * across the file.
 */

// MapComparison reaches Layers_ through comparisonTimePins, and Layers_ pulls
// Viewer_ in with it — the photosphere, model and PDF viewers, and with them a
// bundled THREE build, react-pdf and WebVR. Nothing here opens a viewer, so
// stub the aggregator to keep the import chain light in the jsdom test env.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

let MapComparison
let engine
let container

const makeEngine = () => ({
    enableComparison: vi.fn(),
    disableComparison: vi.fn(),
    setComparisonDivider: vi.fn(),
    setComparisonLayout: vi.fn(),
    getContainer: () => container,
})

const overlay = () => container.querySelector('.mmgis-comparison-overlay')
const label = (side) =>
    container.querySelector(`.mmgis-comparison-label--${side}`)
const captions = () => ({
    left: label('left')?.textContent,
    right: label('right')?.textContent,
})

const enable = (extra = {}) =>
    MapComparison.enable({
        leftLayers: ['co2'],
        rightLayers: ['ch4'],
        ...extra,
    })

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

test.describe('MapComparison side captions', () => {
    test('names both sides on the map when the comparison opens', () => {
        enable({ leftLabel: 'CO₂', rightLabel: 'Methane' })
        expect(captions()).toEqual({ left: 'CO₂', right: 'Methane' })
    })

    // A caller that names neither side gets bare chrome, and the empty chips
    // are left for CSS to hide rather than drawn as blank boxes.
    test('leaves the captions empty when neither side is named', () => {
        enable()
        expect(captions()).toEqual({ left: '', right: '' })
    })

    // The whole point of the separate call: a caption follows the timeline
    // without the engine being asked to redraw anything.
    test('re-words the sides without going back to the engine', () => {
        enable({ leftLabel: 'Oct 31, 2024', rightLabel: 'Jun 15, 2024' })
        engine.enableComparison.mockClear()

        MapComparison.setLabels({ left: 'Sep 2, 2024' })

        expect(captions()).toEqual({ left: 'Sep 2, 2024', right: 'Jun 15, 2024' })
        expect(engine.enableComparison).not.toHaveBeenCalled()
    })

    test('reports the wording on both sides of the state snapshot', () => {
        enable({ leftLabel: 'CO₂', rightLabel: 'Methane' })
        const state = MapComparison.getState()

        expect(state.left.label).toBe('CO₂')
        expect(state.right.label).toBe('Methane')
    })

    // The captions hang off the fraction the divider sits at, so one property
    // is what carries them along with a drag.
    test('carries the captions along as the divider moves', () => {
        enable({ leftLabel: 'CO₂', rightLabel: 'Methane' })
        MapComparison.setDividerPosition(0.25)

        expect(
            overlay().style.getPropertyValue('--mmgis-comparison-position'),
        ).toBe('25%')
    })

    // Two panes read side by side are two views, so the captions move to the
    // top of the pane each one names instead of flanking the seam.
    test('marks the overlay with the layout the captions are laid out for', () => {
        enable({ leftLabel: 'CO₂', rightLabel: 'Methane' })
        const sideBySide = () =>
            overlay().classList.contains('mmgis-comparison-overlay--side-by-side')

        expect(sideBySide()).toBe(false)
        MapComparison.setLayout('sideBySide')
        expect(sideBySide()).toBe(true)
    })

    test('takes the captions down with the rest of the chrome', () => {
        enable({ leftLabel: 'CO₂', rightLabel: 'Methane' })
        MapComparison.disable()

        expect(overlay()).toBeNull()
    })

    // Setting a side names it too, so a caller driving one side at a time is
    // not left with the other side's wording beside it.
    test('a side set on its own carries its own wording', () => {
        enable({ leftLabel: 'CO₂', rightLabel: 'Methane' })
        MapComparison.setRightSide({ layers: ['roads'], label: 'Roads' })

        expect(captions()).toEqual({ left: 'CO₂', right: 'Roads' })
    })
})
