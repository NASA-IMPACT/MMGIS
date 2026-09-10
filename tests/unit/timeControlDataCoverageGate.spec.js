import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

/**
 * The time-change choke point asks whether a layer holds data in the window
 * it is about to request, and takes an out-of-coverage layer off the map
 * before any URL work — so a layer with a urlReplacement does not even make
 * its external call. Visibility is touched only on a transition: on deck.gl
 * every visibility write re-syncs every held layer, and this runs for every
 * time-enabled layer on every time step.
 */

const refreshLayer = vi.fn(() => true)
const setLayerVisibility = vi.fn()

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({
    default: {
        engine: {
            engineType: MAP_ENGINE.LEAFLET,
            refreshLayer: (...args) => refreshLayer(...args),
            setLayerVisibility: (...args) => setLayerVisibility(...args),
        },
        refreshLayer: vi.fn(async () => true),
    },
}))

const dataCoverage = {}
const coverageHidden = {}
const setLayerDataCoverage = vi.fn((name, record) => {
    dataCoverage[name] = record
})

vi.mock('../../src/essence/Basics/Layers_/Layers_', async () => {
    // Faithful to L_.assessLayerDataCoverage: records the verdict and
    // remembers whether the gate is holding the layer off the map.
    const { evaluateLayerDataCoverage, isCoverageGated } = await import(
        '../../src/essence/Basics/TimeControl_/layerDataCoverage.js'
    )
    const assessLayerDataCoverage = (layer, evenIfControlled) => {
        const record = evaluateLayerDataCoverage(layer)
        setLayerDataCoverage(layer.name, record)
        const hidden =
            record.outOfDataRange && isCoverageGated(layer, evenIfControlled)
        if (hidden) coverageHidden[layer.name] = true
        else delete coverageHidden[layer.name]
        return !hidden
    }
    return {
        default: {
            missionPath: '',
            configData: {},
            FUTURES: {},
            layers: {
                data: {},
                layer: {},
                on: {},
                opacity: {},
                filters: {},
                dataCoverage,
                coverageHidden,
            },
            asLayerUUID: (name) => name,
            getUrl: (type, url) => url,
            transformStacUrl: (url) => url,
            timeFilterVectorLayer: vi.fn(),
            setLayerDataCoverage,
            assessLayerDataCoverage,
        },
    }
})

const makeLayer = (overrides = {}) => ({
    name: 'Flood Days',
    type: 'tile',
    url: 'https://example.com/{time}/{z}/{x}/{y}.png',
    tileformat: 'wmts',
    controlled: false,
    time: {
        enabled: true,
        type: 'requery',
        format: '%Y-%m-%d',
        dataDates: ['2020-03-04T14:30:00Z'],
        start: '2020-05-01T00:00:00Z',
        end: '2020-05-04T00:00:00Z',
        ...overrides,
    },
})

const suppressed = () => ({
    outOfDataRange: true,
    kind: 'sparse',
    spans: [],
    requestedWindow: null,
})

describe('TimeControl.reloadLayer data-coverage gate', () => {
    let TimeControl
    let L_

    beforeEach(async () => {
        vi.resetModules()
        refreshLayer.mockClear()
        setLayerVisibility.mockClear()
        setLayerDataCoverage.mockClear()
        Object.keys(dataCoverage).forEach((k) => delete dataCoverage[k])
        Object.keys(coverageHidden).forEach((k) => delete coverageHidden[k])
        TimeControl = (
            await import('../../src/essence/Basics/TimeControl_/TimeControl')
        ).default
        L_ = (await import('../../src/essence/Basics/Layers_/Layers_')).default
        TimeControl.currentTime = '2020-05-04T00:00:00Z'
        L_.layers.on = { 'Flood Days': true }
        L_.layers.layer = { 'Flood Days': {} }
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    test('hides an out-of-coverage layer and requests nothing', async () => {
        const replacements = vi.spyOn(TimeControl, 'performTimeUrlReplacements')
        const layer = makeLayer()

        const result = await TimeControl.reloadLayer(layer)

        expect(result).toBe(true)
        expect(setLayerDataCoverage).toHaveBeenCalledWith(
            'Flood Days',
            expect.objectContaining({ outOfDataRange: true, kind: 'sparse' })
        )
        expect(setLayerVisibility).toHaveBeenCalledWith('Flood Days', false)
        expect(replacements).not.toHaveBeenCalled()
        expect(refreshLayer).not.toHaveBeenCalled()
        expect(layer.time.current).toBe('2020-05-04T00:00:00Z')
    })

    test('does not stamp an off layer as current when suppressed', async () => {
        L_.layers.on['Flood Days'] = false
        const layer = makeLayer()

        await TimeControl.reloadLayer(layer)

        expect(layer.time.current).toBeUndefined()
    })

    test('does not touch visibility when the layer was already suppressed', async () => {
        dataCoverage['Flood Days'] = suppressed()
        coverageHidden['Flood Days'] = true

        await TimeControl.reloadLayer(makeLayer())

        expect(setLayerVisibility).not.toHaveBeenCalled()
    })

    test('refreshes first and shows after when a layer returns to coverage', async () => {
        dataCoverage['Flood Days'] = suppressed()
        coverageHidden['Flood Days'] = true
        const layer = makeLayer({
            start: '2020-03-04T14:00:00Z',
            end: '2020-03-04T15:00:00Z',
        })

        await TimeControl.reloadLayer(layer)

        expect(refreshLayer).toHaveBeenCalledTimes(1)
        expect(setLayerVisibility).toHaveBeenCalledWith('Flood Days', true)
        expect(setLayerVisibility.mock.invocationCallOrder[0]).toBeGreaterThan(
            refreshLayer.mock.invocationCallOrder[0]
        )
        expect(coverageHidden['Flood Days']).toBeUndefined()
    })

    // A vector layer refreshes through Map_.refreshLayer rather than the
    // engine's refresher, and returns to the map the same way afterwards.
    test('shows a vector layer after its refresh when it returns to coverage', async () => {
        coverageHidden['Flood Days'] = true
        const layer = makeLayer({
            start: '2020-03-04T14:00:00Z',
            end: '2020-03-04T15:00:00Z',
        })
        layer.type = 'vector'

        await TimeControl.reloadLayer(layer)

        expect(setLayerVisibility).toHaveBeenCalledWith('Flood Days', true)
    })

    // An off layer is not on the map to restore; the toggle that turns it
    // on asks the gate itself.
    test('leaves an off layer alone when it returns to coverage', async () => {
        dataCoverage['Flood Days'] = suppressed()
        coverageHidden['Flood Days'] = true
        L_.layers.on['Flood Days'] = false
        const layer = makeLayer({
            start: '2020-03-04T14:00:00Z',
            end: '2020-03-04T15:00:00Z',
        })

        await TimeControl.reloadLayer(layer, true)

        expect(setLayerVisibility).not.toHaveBeenCalled()
    })

    // Time steps are not awaited, so two reloads of one layer overlap when
    // the timeline is scrubbed. A restore decided before the refresh must
    // not land after a later step has hidden the layer again.
    test('does not restore a layer that left coverage while it was refreshing', async () => {
        dataCoverage['Flood Days'] = suppressed()
        coverageHidden['Flood Days'] = true
        const layer = makeLayer({
            start: '2020-03-04T14:00:00Z',
            end: '2020-03-04T15:00:00Z',
        })

        const returning = TimeControl.reloadLayer(layer)
        layer.time.start = '2020-05-01T00:00:00Z'
        layer.time.end = '2020-05-04T00:00:00Z'
        const leaving = TimeControl.reloadLayer(layer)
        await Promise.all([returning, leaving])

        expect(setLayerVisibility).not.toHaveBeenCalledWith('Flood Days', true)
        expect(coverageHidden['Flood Days']).toBe(true)
    })

    test('leaves visibility alone when a layer stays in coverage', async () => {
        dataCoverage['Flood Days'] = {
            outOfDataRange: false,
            kind: 'sparse',
            spans: [],
            requestedWindow: null,
        }
        const layer = makeLayer({
            start: '2020-03-04T14:00:00Z',
            end: '2020-03-04T15:00:00Z',
        })

        await TimeControl.reloadLayer(layer)

        expect(refreshLayer).toHaveBeenCalledTimes(1)
        expect(setLayerVisibility).not.toHaveBeenCalled()
    })

    test('reports but does not move a controlled layer', async () => {
        const layer = makeLayer()
        layer.controlled = true

        await TimeControl.reloadLayer(layer)

        expect(setLayerDataCoverage).toHaveBeenCalledWith(
            'Flood Days',
            expect.objectContaining({ outOfDataRange: true })
        )
        expect(setLayerVisibility).not.toHaveBeenCalled()
        expect(refreshLayer).not.toHaveBeenCalled()
    })

    // Only the caller allowed to touch a controlled layer moves it, so only
    // that caller may forget that the gate hid it.
    test('keeps a controlled layer hidden until its controller reloads it', async () => {
        coverageHidden['Flood Days'] = true
        const layer = makeLayer({
            start: '2020-03-04T14:00:00Z',
            end: '2020-03-04T15:00:00Z',
        })
        layer.controlled = true

        await TimeControl.reloadLayer(layer)
        expect(setLayerVisibility).not.toHaveBeenCalled()
        expect(coverageHidden['Flood Days']).toBe(true)

        await TimeControl.reloadLayer(layer, false, true)
        expect(setLayerVisibility).toHaveBeenCalledWith('Flood Days', true)
        expect(coverageHidden['Flood Days']).toBeUndefined()
    })

    // A dynamicExtent layer fetches through its own extent subscription and
    // is skipped by the time-step walk, so nothing would ever restore it.
    test('refreshes a dynamicExtent layer without gating it', async () => {
        const layer = makeLayer()
        layer.variables = { dynamicExtent: true }

        await TimeControl.reloadLayer(layer)

        expect(refreshLayer).toHaveBeenCalledTimes(1)
        expect(setLayerVisibility).not.toHaveBeenCalled()
        expect(setLayerDataCoverage).toHaveBeenCalledWith(
            'Flood Days',
            expect.objectContaining({ outOfDataRange: true })
        )
    })

    test('refreshes a layer with no declared coverage without touching its visibility', async () => {
        const layer = makeLayer({ dataDates: undefined })

        await TimeControl.reloadLayer(layer)

        expect(refreshLayer).toHaveBeenCalledTimes(1)
        expect(setLayerVisibility).not.toHaveBeenCalled()
    })
})
