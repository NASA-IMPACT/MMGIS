import { describe, test, expect, afterEach } from 'vitest'
import { getVisibleLayersWithLegends } from '../../../src/essence/Tools/LayerManager/adapters/getVisibleLayersWithLegends.ts'

/**
 * Covers the seam between core and the legend: the colormap-capable map core
 * returns has to reach buildLayerLegendData per layer, and its absence has to
 * leave the COG controls out rather than throw.
 */

const CONFIGS = {
    Displacement: { display_name: 'Displacement', cogColormap: 'viridis', cogMin: 0, cogMax: 1 },
    Basemap: { display_name: 'Basemap', cogColormap: 'viridis' },
}

const setupMock = ({ capable, provideCapability = true }) => {
    const responses = {
        'layers:getAllConfigs': CONFIGS,
        'layers:getVisible': { Displacement: true, Basemap: true },
        'layers:getAllOpacities': { Displacement: 1, Basemap: 1 },
    }
    if (provideCapability) responses['layers:getColormapCapable'] = capable

    global.window = global.window || {}
    global.window.mmgisAPI = {
        request: async (name) => responses[name] ?? null,
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

    test("passes each layer's capability flag through to its legend data", async () => {
        setupMock({ capable: { Displacement: true, Basemap: false } })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, 'Displacement').cog).not.toBeNull()
        expect(byId(layers, 'Displacement').cog?.colormap).toBe('viridis')
        expect(byId(layers, 'Basemap').cog).toBeNull()
    })

    test('leaves COG data off a layer the capability map omits', async () => {
        setupMock({ capable: { Displacement: true } })
        const layers = await getVisibleLayersWithLegends()

        expect(byId(layers, 'Basemap').cog).toBeNull()
    })

    test('degrades to no COG data against a core without the handler', async () => {
        setupMock({ provideCapability: false })
        const layers = await getVisibleLayersWithLegends()

        expect(layers).toHaveLength(2)
        expect(layers.every((l) => l.cog === null)).toBe(true)
    })
})
