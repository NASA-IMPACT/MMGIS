import { describe, test, expect, afterEach } from 'vitest'
import { getVisibleLayersWithLegends } from '../adapters/getVisibleLayersWithLegends.ts'

/**
 * Covers the seam between core and the panel. Core answers what each layer's
 * legend is and what its colormap supports; this side only assembles those
 * answers into rows, so what is tested here is that each one reaches the layer
 * it belongs to and that a core too old to answer leaves the row plain rather
 * than throwing.
 *
 * Every map crossing this seam is keyed by layer UUID, which a mission config
 * sets independently of `display_name`. The fixtures below keep the two
 * deliberately different so a lookup that keys by the wrong one fails here
 * rather than in a mission.
 */

const DISPLACEMENT = 'Displacement_0123456789abcdef'
const BASEMAP = 'Basemap_fedcba9876543210'

const CONFIGS = {
    [DISPLACEMENT]: {
        display_name: 'Displacement',
        variables: { analysis: { is_analysis_supported: true } },
    },
    [BASEMAP]: {
        display_name: 'Basemap',
        // An analysis block without the flag: configured, but not opted in.
        variables: { analysis: { itemUrl: 'https://raster.test/items/basemap' } },
    },
}

const GRADIENT = {
    type: 'gradient',
    stops: ['#000000', '#ffffff'],
    min: 0,
    max: 1,
    unit: { label: 'm' },
    swatches: null,
    colormap: 'plasma',
}

const NO_LEGEND = {
    type: 'none',
    stops: null,
    min: null,
    max: null,
    unit: null,
    swatches: null,
    colormap: null,
}

const EDITABLE = { hasColormap: true, canChangeColormap: true }
const READ_ONLY = { hasColormap: true, canChangeColormap: false }
const NONE = { hasColormap: false, canChangeColormap: false }

const setupMock = ({ legends, capabilities, titilerUrls, coverage, order } = {}) => {
    const responses = {
        'layers:getAllConfigs': CONFIGS,
        'layers:getVisible': { [DISPLACEMENT]: true, [BASEMAP]: true },
        'layers:getAllOpacities': { [DISPLACEMENT]: 1, [BASEMAP]: 1 },
    }
    if (legends) responses['layers:getLegend'] = legends
    if (capabilities) responses['layers:getCogCapabilities'] = capabilities
    if (titilerUrls) responses['layers:getTiTilerUrl'] = titilerUrls
    if (coverage) responses['layers:getDataCoverage'] = coverage
    if (order) responses['layers:getOrder'] = order

    global.window = global.window || {}
    global.window.mmgisAPI = {
        // The real bus rejects for a handler nobody registered; only
        // mmgisRequestIfProvided guards the call with hasHandler first.
        request: async (name) => {
            if (responses[name] === undefined)
                throw new Error(`No handler for ${name}`)
            return responses[name]
        },
        hasHandler: (name) => responses[name] !== undefined,
        on: () => () => {},
        emit: () => {},
    }
}

const byId = (layers, id) => layers.find((l) => l.id === id)

describe('getVisibleLayersWithLegends', () => {
    afterEach(() => {
        delete global.window.mmgisAPI
    })

    // Core's legend is copied onto the row as it stands. Nothing here rebuilds
    // it, derives bounds, or resolves a ramp — that all happened in core.
    test("carries core's legend onto the row it belongs to", async () => {
        setupMock({ legends: { [DISPLACEMENT]: GRADIENT, [BASEMAP]: NO_LEGEND } })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT)).toMatchObject({
            title: 'Displacement',
            type: 'gradient',
            stops: ['#000000', '#ffffff'],
            min: 0,
            max: 1,
            unit: { label: 'm' },
        })
        expect(byId(layers, BASEMAP).type).toBe('none')
    })

    // Every map crossing the seam is UUID-keyed, and a layer's UUID is not its
    // title. Keying by display name would give both rows the wrong answers.
    test('keys every answer by layer UUID, not display name', async () => {
        setupMock({
            legends: { [DISPLACEMENT]: GRADIENT, Displacement: NO_LEGEND },
            capabilities: {
                [DISPLACEMENT]: EDITABLE,
                // What a display-name-keyed lookup would find instead.
                Displacement: NONE,
                Basemap: EDITABLE,
            },
        })
        const layers = await getVisibleLayersWithLegends()

        const displacement = byId(layers, DISPLACEMENT)
        expect(displacement.id).not.toBe(displacement.title)
        expect(displacement.type).toBe('gradient')
        expect(displacement.cog).not.toBeNull()
        expect(byId(layers, BASEMAP).cog).toBeNull()
    })

    // The controls follow the capability, and each layer gets the service core
    // resolved for it — a mission can point one layer at its own.
    test('offers colormap controls only where core reports the capability', async () => {
        setupMock({
            legends: { [DISPLACEMENT]: GRADIENT, [BASEMAP]: GRADIENT },
            capabilities: { [DISPLACEMENT]: READ_ONLY, [BASEMAP]: EDITABLE },
            titilerUrls: { [DISPLACEMENT]: null, [BASEMAP]: 'https://titiler.test' },
        })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).cog).toEqual({
            editable: false,
            colormap: 'plasma',
            titilerUrl: null,
        })
        expect(byId(layers, BASEMAP).cog).toEqual({
            editable: true,
            colormap: 'plasma',
            titilerUrl: 'https://titiler.test',
        })
    })

    // A core that registers none of these handlers answers null rather than a
    // verdict. The rows still list, plain.
    test('degrades to plain rows against a core without the handlers', async () => {
        setupMock()
        const layers = await getVisibleLayersWithLegends()

        expect(layers).toHaveLength(2)
        expect(layers.every((l) => l.type === 'none' && l.cog === null)).toBe(true)
    })

    test("flags each layer core reports out of range, keyed by UUID", async () => {
        setupMock({
            coverage: {
                [DISPLACEMENT]: { outOfDataRange: true },
                // A display-name-keyed lookup would find this instead.
                Basemap: { outOfDataRange: true },
            },
        })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).outOfDataRange).toBe(true)
        expect(byId(layers, BASEMAP).outOfDataRange).toBe(false)
    })

    // The same flag the analysis plugins gate on, so the mark and the layers
    // those plugins act on cannot disagree.
    test('flags a layer whose config opts into area analysis', async () => {
        setupMock()
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).analysisSupported).toBe(true)
        expect(byId(layers, BASEMAP).analysisSupported).toBe(false)
    })

    // The list reads top down as the map stacks. The config lists
    // Displacement first; the draw order below puts the basemap on top.
    test('lists layers in the draw order core gives', async () => {
        setupMock({ order: [BASEMAP, DISPLACEMENT] })
        expect((await getVisibleLayersWithLegends()).map((l) => l.id)).toEqual([
            BASEMAP,
            DISPLACEMENT,
        ])

        setupMock()
        expect((await getVisibleLayersWithLegends()).map((l) => l.id)).toEqual([
            DISPLACEMENT,
            BASEMAP,
        ])
    })
})
