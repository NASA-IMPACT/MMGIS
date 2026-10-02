import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'

// Layers_ reaches Map_ transitively, and Map_ pulls in JSX viewers Vite will
// not parse from a .js file. The providers under test never touch Map_.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

const ALPHA = 'Alpha_0123456789abcdef'
const BRAVO = 'Bravo_fedcba9876543210'

let providers
let emitted

beforeEach(() => {
    L_.layers.data = {
        [ALPHA]: {
            name: ALPHA,
            display_name: 'Alpha',
            type: 'tile',
            url: 'alpha.tif',
            variables: { analysis: { is_analysis_supported: true } },
        },
        [BRAVO]: {
            name: BRAVO,
            display_name: 'Bravo',
            type: 'vector',
            url: 'bravo.json',
        },
    }
    L_.layers.nameToUUID = { Alpha: [ALPHA], Bravo: [BRAVO] }
    L_.layers.on = { [ALPHA]: true, [BRAVO]: false }
    L_.layers.opacity = { [ALPHA]: 1, [BRAVO]: 0.5 }
    L_.layers.listed = { [BRAVO]: false }
    L_.layers.loadStatus = { [ALPHA]: { status: 'ok', message: null } }
    L_.layers.dataCoverage = {
        [ALPHA]: { outOfDataRange: false, coverage: { start: '2026-01-01' } },
    }

    providers = {}
    emitted = []
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: (event, payload) => emitted.push([event, payload]),
    }
    L_.fina(null, null, null, null, null, null)
})

afterAll(() => {
    delete window.mmgisAPI
    L_.layers.data = {}
    L_.layers.nameToUUID = {}
    L_.layers.on = {}
    L_.layers.opacity = {}
    L_.layers.listed = {}
    L_.layers.loadStatus = {}
    L_.layers.dataCoverage = {}
})

// [request, argument, core's own value, what a careless plugin does to the answer]
const READS = [
    [
        'layers:getVisible',
        undefined,
        () => L_.layers.on,
        (answer) => {
            answer[ALPHA] = false
        },
    ],
    [
        'layers:getConfig',
        ALPHA,
        () => L_.layers.data[ALPHA],
        (answer) => {
            answer.url = 'elsewhere.tif'
            answer.variables.analysis.is_analysis_supported = false
        },
    ],
    [
        'layers:getAllConfigs',
        undefined,
        () => L_.layers.data,
        (answer) => {
            answer[ALPHA].variables.analysis.is_analysis_supported = false
            delete answer[BRAVO]
        },
    ],
    [
        'layers:getAllOpacities',
        undefined,
        () => L_.layers.opacity,
        (answer) => {
            answer[ALPHA] = 0
        },
    ],
    [
        'layers:getListed',
        undefined,
        () => L_.layers.listed,
        (answer) => {
            answer[ALPHA] = false
        },
    ],
    [
        'layers:getLoadStatus',
        undefined,
        () => L_.layers.loadStatus,
        (answer) => {
            answer[ALPHA].status = 'error'
        },
    ],
    [
        'layers:getLoadStatus',
        ALPHA,
        () => L_.layers.loadStatus[ALPHA],
        (answer) => {
            answer.status = 'error'
        },
    ],
    [
        'layers:getDataCoverage',
        undefined,
        () => L_.layers.dataCoverage,
        (answer) => {
            answer[ALPHA].outOfDataRange = true
        },
    ],
    [
        'layers:getDataCoverage',
        ALPHA,
        () => L_.layers.dataCoverage[ALPHA],
        (answer) => {
            answer.coverage.start = '1999-01-01'
        },
    ],
]

describe('layer reads answer with a copy', () => {
    for (const [request, arg, core, tamper] of READS) {
        const label = arg == null ? request : `${request} for one layer`

        test(`${label}: writing to the answer leaves core as it was`, () => {
            const before = structuredClone(core())

            const answer = providers[request](arg)
            expect(answer).toEqual(before)
            expect(answer).not.toBe(core())

            tamper(answer)

            expect(core()).toEqual(before)
            expect(providers[request](arg)).toEqual(before)
        })
    }

    test('a layer nobody knows still answers null', () => {
        expect(providers['layers:getConfig']('Nope')).toBeNull()
        expect(providers['layers:getLoadStatus'](BRAVO)).toBeNull()
        expect(providers['layers:getDataCoverage']('Nope')).toBeNull()
    })

    test('layers:updateConfig is still how a plugin changes a layer, and still says so', () => {
        const changed = providers['layers:updateConfig']({
            layerUUID: ALPHA,
            updates: { url: 'updated.tif' },
        })

        expect(changed).toBe(true)
        expect(providers['layers:getConfig'](ALPHA).url).toBe('updated.tif')
        expect(emitted).toContainEqual([
            'layers:configChanged',
            { layerName: ALPHA, keys: ['url'] },
        ])
    })

    test('layer:listedChange carries a copy of the listed map', () => {
        providers['layers:setListed']({ updates: { [ALPHA]: false } })

        const [, payload] = emitted.find(([event]) => event === 'layer:listedChange')
        expect(payload.listed).toEqual({ [ALPHA]: false, [BRAVO]: false })
        expect(payload.listed).not.toBe(L_.layers.listed)

        payload.listed[BRAVO] = true
        expect(L_.layers.listed[BRAVO]).toBe(false)
    })

    test('a layer holding something that cannot be cloned is still answered', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        L_.layers.data[ALPHA].onEachFeature = () => {}

        const answer = providers['layers:getConfig'](ALPHA)

        expect(answer.url).toBe('alpha.tif')
        expect(answer).not.toHaveProperty('onEachFeature')
        expect(answer).not.toBe(L_.layers.data[ALPHA])
        warn.mockRestore()
    })
})
