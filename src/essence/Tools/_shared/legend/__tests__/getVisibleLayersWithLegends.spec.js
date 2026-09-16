import { describe, test, expect, afterEach, vi } from 'vitest'
import { getVisibleLayersWithLegends } from '../getVisibleLayersWithLegends.ts'

/**
 * Covers the seam between core and the legend. Every map crossing it is keyed
 * by layer UUID, which a mission config sets independently of `display_name`,
 * so the fixtures keep the two deliberately different.
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
    configs = CONFIGS,
    visible = { [DISPLACEMENT]: true, [BASEMAP]: true },
    listed,
}) => {
    const responses = {
        'layers:getAllConfigs': configs,
        'layers:getVisible': visible,
        'layers:getAllOpacities': { [DISPLACEMENT]: 1, [BASEMAP]: 1 },
    }
    responses['layers:getCogCapabilities'] = capabilities
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
const NONE = { hasColormap: false, canChangeColormap: false }

const byId = (layers, id) => layers.find((l) => l.id === id)

describe('getVisibleLayersWithLegends', () => {
    afterEach(() => {
        delete global.window.mmgisAPI
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
        expect(displacement.cog?.colormap).toBe('viridis')
        expect(byId(layers, BASEMAP).cog).toBeNull()
    })

    // showOnlyVisible is what keeps a toggled-off layer out of an export's
    // legend band. Without the guard the band lists layers that are not on
    // the map.
    test('showOnlyVisible drops a toggled-off layer', async () => {
        setupMock({
            capabilities: {},
            visible: { [DISPLACEMENT]: true, [BASEMAP]: false },
        })
        expect(
            (await getVisibleLayersWithLegends({ showOnlyVisible: true })).map(
                (l) => l.id,
            ),
        ).toEqual([DISPLACEMENT])
        // Without the flag the layer is still listed, marked not visible.
        expect(byId(await getVisibleLayersWithLegends(), BASEMAP).visible).toBe(
            false,
        )
    })

    // A `header` config is a grouping row in the layer list, not a layer, and
    // a layer core reports as unlisted is deliberately hidden from the layer
    // UI — neither has anything to draw on the band.
    test('a header config and an unlisted layer get no row', async () => {
        setupMock({
            capabilities: {},
            configs: {
                ...CONFIGS,
                Group_aaaaaaaaaaaaaaaa: { display_name: 'Group', type: 'header' },
            },
            visible: {
                [DISPLACEMENT]: true,
                [BASEMAP]: true,
                Group_aaaaaaaaaaaaaaaa: true,
            },
            listed: { [DISPLACEMENT]: true, [BASEMAP]: false },
        })
        const layers = await getVisibleLayersWithLegends({
            showOnlyVisible: true,
        })

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
