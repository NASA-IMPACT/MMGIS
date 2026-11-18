import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// L_.getUrl dereferences window.mmgisglobal on the tile branch; jsdom has none.
window.mmgisglobal = window.mmgisglobal || {}

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)
const { deckColormapFor, makeDeckCOGRefresher } = await import(
    '../../src/essence/Basics/Layers_/deckCOGRefresher.js'
)
const { clearColormapCache } = await import(
    '../../src/essence/Basics/Colormaps/titilerColormaps'
)
const { resolveColormapTable } = await import(
    '../../src/essence/Basics/Colormaps/colormapResolver'
)
const { buildLayerLegend } = await import(
    '../../src/essence/Basics/Layers_/legend/buildLayerLegend'
)
const { colormapResponseToTable, colormapTableToCss } = await import(
    '../../src/essence/Basics/Colormaps/colormapTable'
)
const { getStandardColormapTable } = await import(
    '../../src/essence/Basics/Colormaps/standardColormaps'
)

/**
 * The COG refresher is the layer kind's own answer to "your config moved" —
 * it re-derives props from CURRENT config every time it is called, so a
 * colormap change, a rescale change and a time change all flow through it.
 */
const makeDeckLayer = (id, props = {}) => ({
    id,
    props: { id, ...props },
    clone(patch) {
        return makeDeckLayer(id, { ...props, ...patch })
    },
})

describe('makeDeckCOGRefresher', () => {
    test('re-reads the colormap from config on each call', () => {
        const layerObj = { name: 'l1', url: 'COG:a.tif', cogColormap: 'viridis' }
        L_.layers.opacity.l1 = 1
        const refresh = makeDeckCOGRefresher('l1', layerObj)

        const first = refresh(makeDeckLayer('l1'))
        expect(first.props.updateTriggers.renderTile[0]).toBe('viridis')

        layerObj.currentCogColormap = 'plasma'
        const second = refresh(first)
        expect(second.props.updateTriggers.renderTile[0]).toBe('plasma')
    })

    test('re-reads opacity from the registry rather than capturing it', () => {
        const layerObj = { name: 'l2', url: 'COG:a.tif' }
        L_.layers.opacity.l2 = 1
        const refresh = makeDeckCOGRefresher('l2', layerObj)

        L_.layers.opacity.l2 = 0.25
        expect(refresh(makeDeckLayer('l2')).props.opacity).toBe(0.25)
    })

    // Every config writer mutates the L_.layers.data entry in place today, so
    // capturing the reference happens to work. It stops working the moment one
    // replaces the entry instead — which is what this simulates.
    test('reads the live registry entry, not the object captured at creation', () => {
        const captured = { name: 'l4', url: 'COG:a.tif', cogColormap: 'viridis' }
        L_.layers.opacity.l4 = 1
        const refresh = makeDeckCOGRefresher('l4', captured)

        L_.layers.data.l4 = { ...captured, cogColormap: 'plasma' }

        expect(
            refresh(makeDeckLayer('l4')).props.updateTriggers.renderTile[0]
        ).toBe('plasma')
    })

    test('falls back to the given config when the registry has no entry', () => {
        const layerObj = { name: 'l5', url: 'COG:a.tif', cogColormap: 'magma' }
        L_.layers.opacity.l5 = 1
        delete L_.layers.data.l5

        expect(
            makeDeckCOGRefresher('l5', layerObj)(makeDeckLayer('l5')).props
                .updateTriggers.renderTile[0]
        ).toBe('magma')
    })

    test('returns a new instance rather than mutating the old one', () => {
        const layerObj = { name: 'l3', url: 'COG:a.tif' }
        L_.layers.opacity.l3 = 1
        const original = makeDeckLayer('l3')

        expect(makeDeckCOGRefresher('l3', layerObj)(original)).not.toBe(original)
    })
})

const SERVICE = 'https://eic.test/api/titiler-multidim'

const fixture = (path) =>
    JSON.parse(readFileSync(`tests/unit/fixtures/colormaps/${path}`, 'utf8'))

/** A stand-in tiling service answering from a name -> response map. */
const stubService = (responses) => {
    const fetch = vi.fn(async (url) => {
        const name = decodeURIComponent(url.slice(`${SERVICE}/colorMaps/`.length))
        const body = responses[name]
        return body
            ? { ok: true, json: async () => body }
            : { ok: false, status: 404, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
}

/**
 * A client-side COG layer paints from the layer's colormap sources, like its
 * legend. A ramp only its tiling service has (EIC's naqfc_pm25) is painted as
 * that ramp, not the fallback; the first paint does not wait for it.
 */
describe('deckColormapFor', () => {
    let engine

    beforeEach(() => {
        clearColormapCache()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        engine = { refreshLayer: vi.fn(() => true) }
        L_.Map_ = { engine }
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        L_.Map_ = null
    })

    const pm25 = (fields = {}) => ({
        name: 'pm25',
        type: 'tile',
        url: 'COG:https://data.test/pm25.tif',
        cogTransform: true,
        cogRendererMode: 'deckRaster',
        cogColormap: 'naqfc_pm25',
        titilerUrl: SERVICE,
        ...fields,
    })

    test('paints a service-only ramp once the service answers, repainting the layer', async () => {
        stubService({ naqfc_pm25: fixture('eic/naqfc_pm25.json') })
        const layerObj = pm25()
        L_.layers.data.pm25 = layerObj
        L_.layers.opacity.pm25 = 1
        const refresh = makeDeckCOGRefresher('pm25', layerObj)

        const first = refresh(makeDeckLayer('pm25'))
        expect(first.props.updateTriggers.renderTile[1]).toBe('fallback|viridis')

        await vi.waitFor(() => expect(engine.refreshLayer).toHaveBeenCalledWith('pm25'))

        // What the engine's refresh runs: the same refresher, now settled.
        const second = refresh(first)
        expect(second.props.updateTriggers.renderTile[1]).toBe(
            `service:${SERVICE}|naqfc_pm25`
        )
        expect(deckColormapFor('pm25', layerObj).table).toEqual(
            colormapResponseToTable('naqfc_pm25', fixture('eic/naqfc_pm25.json'))
        )
    })

    // Map, legend and picker swatch all ask the resolver; this pins the map
    // and the legend to one table.
    test('paints exactly the table the legend draws', async () => {
        stubService({ naqfc_pm25: fixture('eic/naqfc_pm25.json') })
        const layerObj = pm25()

        const legend = await buildLayerLegend(layerObj, { serviceUrl: SERVICE })
        expect(legend.stops).toEqual(
            colormapTableToCss(deckColormapFor('pm25', layerObj).table)
        )
    })

    test("reverses with the service's own `_r` table", async () => {
        const reversed = fixture('eic/viridis.json')
        reversed[0] = [9, 9, 9, 255]
        stubService({ viridis_r: reversed })
        const layerObj = pm25({ cogColormap: 'viridis_r' })

        // Bundled mirror first, so the first paint is already close.
        expect(deckColormapFor('pm25', layerObj).table).toBe(
            getStandardColormapTable('viridis_r')
        )
        await resolveColormapTable({ name: 'viridis_r' }, { serviceUrl: SERVICE })
        expect(Array.from(deckColormapFor('pm25', layerObj).table.subarray(0, 4))).toEqual([
            9, 9, 9, 255,
        ])
    })

    test('a layer the engine does not hold yet has its stored instance rebuilt', async () => {
        stubService({ naqfc_pm25: fixture('eic/naqfc_pm25.json') })
        engine.refreshLayer.mockReturnValue(false)
        const layerObj = pm25()
        L_.layers.data.pm25 = layerObj
        L_.layers.opacity.pm25 = 1
        L_.layers.layer.pm25 = makeDeckCOGRefresher('pm25', layerObj)(makeDeckLayer('pm25'))

        await vi.waitFor(() =>
            expect(L_.layers.layer.pm25.props.updateTriggers.renderTile[1]).toBe(
                `service:${SERVICE}|naqfc_pm25`
            )
        )
    })

    test('with no service, paints from the bundle and asks nothing', () => {
        const fetch = stubService({})
        const layerObj = pm25({ cogColormap: 'magma', titilerUrl: undefined })

        const colormap = deckColormapFor('pm25', layerObj)
        expect(colormap.key).toBe('bundle|magma')
        expect(colormap.table).toBe(getStandardColormapTable('magma'))
        expect(fetch).not.toHaveBeenCalled()
        expect(engine.refreshLayer).not.toHaveBeenCalled()
    })
})
