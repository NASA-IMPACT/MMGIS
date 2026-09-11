import { describe, test, expect, beforeEach, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_` — so a
// bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * The core's record of each layer's data coverage — the only surface
 * anything outside the core sees. Written through one setter that always
 * stores and announces only on change, since every time step re-evaluates
 * every time-enabled layer and a scrubbed timeline would otherwise emit
 * thousands of identical events.
 */

const ms = (iso) => new Date(iso).getTime()

const outRecord = () => ({
    outOfDataRange: true,
    kind: 'sparse',
    spans: [
        {
            start: ms('2020-03-04T14:00:00Z'),
            end: ms('2020-03-04T14:59:59.999Z'),
            at: ms('2020-03-04T14:30:00Z'),
            unit: 'hour',
        },
    ],
    requestedWindow: {
        start: ms('2020-05-01T00:00:00Z'),
        end: ms('2020-05-04T00:00:00Z'),
    },
})

let emit
let providers

beforeEach(() => {
    emit = vi.fn()
    providers = {}
    window.mmgisAPI = {
        emit,
        provide: vi.fn((name, handler) => {
            providers[name] = handler
            return () => delete providers[name]
        }),
    }
    L_.layers.data = {
        'flood-uuid': { name: 'flood-uuid', display_name: 'Flood Days' },
    }
    L_.layers.nameToUUID = { 'Flood Days': ['flood-uuid'] }
    L_.layers.dataCoverage = {}
    L_.layers.coverageHidden = {}
})

describe('L_.setLayerDataCoverage', () => {
    test('stores the record and announces it', () => {
        L_.setLayerDataCoverage('flood-uuid', outRecord())

        expect(L_.layers.dataCoverage['flood-uuid']).toEqual(outRecord())
        expect(emit).toHaveBeenCalledWith('layers:dataCoverageChanged', {
            layerName: 'flood-uuid',
            ...outRecord(),
        })
    })

    test('stores a fresh window without announcing when nothing else changed', () => {
        L_.setLayerDataCoverage('flood-uuid', outRecord())
        emit.mockClear()

        const next = outRecord()
        next.requestedWindow = {
            start: ms('2020-06-01T00:00:00Z'),
            end: ms('2020-06-04T00:00:00Z'),
        }
        L_.setLayerDataCoverage('flood-uuid', next)

        expect(L_.layers.dataCoverage['flood-uuid'].requestedWindow).toEqual(
            next.requestedWindow
        )
        expect(emit).not.toHaveBeenCalled()
    })

    test('announces a change of verdict', () => {
        L_.setLayerDataCoverage('flood-uuid', outRecord())
        emit.mockClear()

        const next = outRecord()
        next.outOfDataRange = false
        L_.setLayerDataCoverage('flood-uuid', next)

        expect(emit).toHaveBeenCalledTimes(1)
    })
})

describe('L_.assessLayerDataCoverage', () => {
    test('records the verdict and answers whether the layer has data', () => {
        const layer = {
            name: 'flood-uuid',
            time: {
                enabled: true,
                dataDates: ['2020-03-04T14:30:00Z'],
                start: '2020-05-01T00:00:00Z',
                end: '2020-05-04T00:00:00Z',
            },
        }

        expect(L_.assessLayerDataCoverage(layer)).toBe(false)
        expect(L_.layers.dataCoverage['flood-uuid'].outOfDataRange).toBe(true)

        layer.time.start = '2020-03-04T14:00:00Z'
        expect(L_.assessLayerDataCoverage(layer)).toBe(true)
        expect(L_.layers.dataCoverage['flood-uuid'].outOfDataRange).toBe(false)
    })

    // The engine is told the answer wherever this is asked, so the flag says
    // what the engine was told — which is what a later restore, or an
    // off-toggle of a layer the map no longer holds, has to know.
    test('remembers that the gate hid the layer, until it lets it show', () => {
        const layer = {
            name: 'flood-uuid',
            time: {
                enabled: true,
                dataDates: ['2020-03-04T14:30:00Z'],
                start: '2020-05-01T00:00:00Z',
                end: '2020-05-04T00:00:00Z',
            },
        }

        L_.assessLayerDataCoverage(layer)
        expect(L_.layers.coverageHidden['flood-uuid']).toBe(true)

        layer.time.start = '2020-03-04T14:00:00Z'
        L_.assessLayerDataCoverage(layer)
        expect(L_.layers.coverageHidden['flood-uuid']).toBeUndefined()
    })

    test('reports a controlled layer out of range but lets it show', () => {
        const layer = {
            name: 'flood-uuid',
            controlled: true,
            time: {
                enabled: true,
                dataDates: ['2020-03-04T14:30:00Z'],
                start: '2020-05-01T00:00:00Z',
                end: '2020-05-04T00:00:00Z',
            },
        }

        expect(L_.assessLayerDataCoverage(layer)).toBe(true)
        expect(L_.layers.dataCoverage['flood-uuid'].outOfDataRange).toBe(true)
        expect(L_.layers.coverageHidden['flood-uuid']).toBeUndefined()

        expect(L_.assessLayerDataCoverage(layer, true)).toBe(false)
        expect(L_.layers.coverageHidden['flood-uuid']).toBe(true)
    })

    test('never hides a dynamicExtent layer', () => {
        const layer = {
            name: 'flood-uuid',
            variables: { dynamicExtent: true },
            time: {
                enabled: true,
                dataDates: ['2020-03-04T14:30:00Z'],
                start: '2020-05-01T00:00:00Z',
                end: '2020-05-04T00:00:00Z',
            },
        }

        expect(L_.assessLayerDataCoverage(layer, true)).toBe(true)
        expect(L_.layers.dataCoverage['flood-uuid'].outOfDataRange).toBe(true)
    })
})

describe('layers:getDataCoverage', () => {
    beforeEach(() => {
        // Registers the layer providers the way layersRefreshProvider.spec
        // does; the collaborators are unread by this handler.
        L_.fina(null, { engine: {}, nativeLayer: (l) => l }, null, null, null, {})
        L_.setLayerDataCoverage('flood-uuid', outRecord())
    })

    test('answers for one layer by uuid or display name', () => {
        expect(providers['layers:getDataCoverage']('flood-uuid')).toEqual(
            outRecord()
        )
        expect(providers['layers:getDataCoverage']('Flood Days')).toEqual(
            outRecord()
        )
    })

    test('is null for a layer it does not know', () => {
        expect(providers['layers:getDataCoverage']('nope')).toBeNull()
    })

    test('answers with the whole uuid-keyed map when asked for nothing in particular', () => {
        expect(providers['layers:getDataCoverage']()).toEqual({
            'flood-uuid': outRecord(),
        })
    })
})
