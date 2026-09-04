import { describe, test, expect, afterEach, vi } from 'vitest'
import { getVisibleLayersWithLegends } from '../getVisibleLayersWithLegends.ts'

/**
 * Covers the seam between core and the legend: the COG capabilities core
 * returns have to reach buildLayerLegendData per layer, and their absence has
 * to leave the COG controls out rather than throw.
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
        cogColormap: 'viridis',
        cogMin: 0,
        cogMax: 1,
    },
    [BASEMAP]: { display_name: 'Basemap', cogColormap: 'viridis' },
}

const setupMock = ({
    capabilities,
    provideCapability = true,
    titilerUrls,
    configs = CONFIGS,
    visible = { [DISPLACEMENT]: true, [BASEMAP]: true },
    listed,
}) => {
    const responses = {
        'layers:getAllConfigs': configs,
        'layers:getVisible': visible,
        'layers:getAllOpacities': { [DISPLACEMENT]: 1, [BASEMAP]: 1 },
    }
    if (provideCapability) responses['layers:getCogCapabilities'] = capabilities
    if (titilerUrls) responses['layers:getTiTilerUrl'] = titilerUrls
    if (listed) responses['layers:getListed'] = listed

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

const EDITABLE = { hasColormap: true, canChangeColormap: true }
const READ_ONLY = { hasColormap: true, canChangeColormap: false }
const NONE = { hasColormap: false, canChangeColormap: false }

const byId = (layers, id) => layers.find((l) => l.id === id)

describe('getVisibleLayersWithLegends', () => {
    afterEach(() => {
        delete global.window.mmgisAPI
    })

    test("passes each layer's capabilities through to its legend data", async () => {
        setupMock({ capabilities: { [DISPLACEMENT]: EDITABLE, [BASEMAP]: NONE } })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).cog).not.toBeNull()
        expect(byId(layers, DISPLACEMENT).cog?.colormap).toBe('viridis')
        expect(byId(layers, BASEMAP).cog).toBeNull()
    })

    // The capability map is UUID-keyed, and a layer's UUID is not its title.
    // Keying the lookup by either the display name or the title would leave
    // every layer without controls.
    test('keys capabilities by layer UUID, not display name', async () => {
        setupMock({
            capabilities: {
                [DISPLACEMENT]: EDITABLE,
                // What a display-name-keyed lookup would find instead. It must
                // not be what decides the verdict.
                Displacement: NONE,
                Basemap: EDITABLE,
            },
        })
        const layers = await getVisibleLayersWithLegends()

        const displacement = byId(layers, DISPLACEMENT)
        expect(displacement.title).toBe('Displacement')
        expect(displacement.id).not.toBe(displacement.title)
        expect(displacement.cog).not.toBeNull()
        expect(byId(layers, BASEMAP).cog).toBeNull()
    })

    test('carries the editable flag through per layer', async () => {
        setupMock({
            capabilities: { [DISPLACEMENT]: READ_ONLY, [BASEMAP]: EDITABLE },
        })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).cog?.editable).toBe(false)
        expect(byId(layers, BASEMAP).cog?.editable).toBe(true)
    })

    test('leaves COG data off a layer the capability map omits', async () => {
        setupMock({ capabilities: { [DISPLACEMENT]: EDITABLE } })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, BASEMAP).cog).toBeNull()
    })

    test('degrades to no COG data against a core without the handler', async () => {
        setupMock({ provideCapability: false })
        const layers = await getVisibleLayersWithLegends()

        expect(layers).toHaveLength(2)
        expect(layers.every((l) => l.cog === null)).toBe(true)
    })

    // Per layer rather than global, since a mission can point one layer at a
    // different service than the rest.
    test('carries the tiling service core resolved through per layer', async () => {
        setupMock({
            capabilities: { [DISPLACEMENT]: EDITABLE, [BASEMAP]: EDITABLE },
            titilerUrls: {
                [DISPLACEMENT]: 'https://titiler.test',
                [BASEMAP]: 'https://other-titiler.test',
            },
        })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).cog?.titilerUrl).toBe('https://titiler.test')
        expect(byId(layers, BASEMAP).cog?.titilerUrl).toBe('https://other-titiler.test')
    })

    test('leaves the service null when core resolves none for a layer', async () => {
        setupMock({
            capabilities: { [DISPLACEMENT]: EDITABLE, [BASEMAP]: EDITABLE },
            titilerUrls: { [DISPLACEMENT]: null, [BASEMAP]: 'https://titiler.test' },
        })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).cog?.titilerUrl).toBeNull()
        expect(byId(layers, BASEMAP).cog?.titilerUrl).toBe('https://titiler.test')
    })

    test('leaves the service null against a core without the handler', async () => {
        setupMock({ capabilities: { [DISPLACEMENT]: EDITABLE } })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, DISPLACEMENT).cog?.titilerUrl).toBeNull()
    })

    // A caller (getExportLegendModel) that already fetched
    // layers:getAllConfigs for its own purposes can pass it straight
    // through, so this module never re-requests it from core.
    test('uses a provided layerConfigs instead of requesting layers:getAllConfigs itself', async () => {
        const responses = {
            'layers:getVisible': { [DISPLACEMENT]: true, [BASEMAP]: true },
            'layers:getAllOpacities': { [DISPLACEMENT]: 1, [BASEMAP]: 1 },
            'layers:getCogCapabilities': {
                [DISPLACEMENT]: EDITABLE,
                [BASEMAP]: NONE,
            },
        }
        global.window = global.window || {}
        global.window.mmgisAPI = {
            request: async (name) => {
                if (name === 'layers:getAllConfigs') {
                    throw new Error(
                        'layers:getAllConfigs should not be requested when layerConfigs is provided',
                    )
                }
                if (responses[name] === undefined)
                    throw new Error(`No handler for ${name}`)
                return responses[name]
            },
            hasHandler: (name) => responses[name] !== undefined,
            on: () => () => {},
            emit: () => {},
        }

        const layers = await getVisibleLayersWithLegends({
            layerConfigs: CONFIGS,
        })

        expect(layers).toHaveLength(2)
        expect(byId(layers, DISPLACEMENT).cog).not.toBeNull()
    })
})

describe('getVisibleLayersWithLegends filtering', () => {
    afterEach(() => {
        delete global.window.mmgisAPI
    })

    // showOnlyVisible is what keeps a toggled-off layer out of an export's
    // legend band. Without the guard the band lists layers that are not on
    // the map.
    test('showOnlyVisible drops a toggled-off layer', async () => {
        setupMock({
            capabilities: { [DISPLACEMENT]: NONE, [BASEMAP]: NONE },
            visible: { [DISPLACEMENT]: true, [BASEMAP]: false },
        })
        const layers = await getVisibleLayersWithLegends({ showOnlyVisible: true })

        expect(layers.map((l) => l.id)).toEqual([DISPLACEMENT])
        expect(byId(layers, BASEMAP)).toBeUndefined()
    })

    test('without showOnlyVisible the toggled-off layer is still listed', async () => {
        setupMock({
            capabilities: { [DISPLACEMENT]: NONE, [BASEMAP]: NONE },
            visible: { [DISPLACEMENT]: true, [BASEMAP]: false },
        })
        const layers = await getVisibleLayersWithLegends()

        expect(layers.map((l) => l.id).sort()).toEqual(
            [DISPLACEMENT, BASEMAP].sort(),
        )
        expect(byId(layers, BASEMAP).visible).toBe(false)
    })

    // A `header` config is a grouping row in the layer list, not a layer, so
    // it has nothing to draw and must never reach the band.
    test('a header config gets no row', async () => {
        setupMock({
            capabilities: {},
            configs: {
                ...CONFIGS,
                'Group_aaaaaaaaaaaaaaaa': { display_name: 'Group', type: 'header' },
            },
            visible: {
                [DISPLACEMENT]: true,
                [BASEMAP]: true,
                'Group_aaaaaaaaaaaaaaaa': true,
            },
        })
        const layers = await getVisibleLayersWithLegends({ showOnlyVisible: true })

        expect(layers.map((l) => l.id).sort()).toEqual(
            [DISPLACEMENT, BASEMAP].sort(),
        )
    })

    // A layer core reports as unlisted is deliberately hidden from the layer
    // UI, so it stays out of the legend too.
    test('an unlisted layer gets no row', async () => {
        setupMock({
            capabilities: {},
            listed: { [DISPLACEMENT]: true, [BASEMAP]: false },
        })
        const layers = await getVisibleLayersWithLegends({ showOnlyVisible: true })

        expect(layers.map((l) => l.id)).toEqual([DISPLACEMENT])
    })

    // Fail open: core answering nothing is not "every layer is hidden".
    // Dropping all rows on a null answer would silently empty the band.
    test('a null visibility map keeps every layer, with a warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            setupMock({ capabilities: {}, visible: null })
            const layers = await getVisibleLayersWithLegends({
                showOnlyVisible: true,
            })

            expect(layers.map((l) => l.id).sort()).toEqual(
                [DISPLACEMENT, BASEMAP].sort(),
            )
            expect(warn).toHaveBeenCalled()
        } finally {
            warn.mockRestore()
        }
    })
})
