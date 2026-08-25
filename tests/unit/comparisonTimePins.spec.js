import { describe, test, expect, vi, beforeEach } from 'vitest'

/**
 * The pin module is what makes one side of a comparison show a different date
 * from the other: it reads a layer's config and returns the single deck prop
 * that redraws it at a pinned window. What matters is that each source kind
 * gets the prop its deck layer actually reads, that unpinnable layers are left
 * out rather than guessed at, and that the shared config is never written to.
 */

const START = '2024-01-01T00:00:00Z'
const END = '2024-10-31T14:30:00Z'

let buildTimePinnedProps
let pinWindowFor
let configs

const load = async () => {
    vi.resetModules()
    vi.doMock('../../src/essence/Basics/Layers_/Layers_', () => ({
        default: {
            layers: { get data() { return configs } },
            // Core's getUrl strips the service prefix off a COG source so the
            // bare file URL is what the client-side renderer reads.
            getUrl: (_type, url) =>
                String(url).startsWith('COG:') ? String(url).slice(4) : url,
            missionPath: '/mission/',
            TimeControl_: { getStartTime: () => START },
        },
    }))
    // The tile-source resolver reaches for a TiTiler host on the COG branch,
    // which a unit run has none of. The COG case here goes to the client-side
    // renderer, which reads the bare file URL and never the wrapped one.
    vi.doMock('../../src/essence/Basics/ServiceUrls/ServiceUrls', () => ({
        default: { buildTiTilerCogTilesUrl: (url) => url },
    }))
    const mod = await import('../../src/essence/Basics/Map_/comparisonTimePins')
    buildTimePinnedProps = mod.buildTimePinnedProps
    pinWindowFor = mod.pinWindowFor
}

beforeEach(async () => {
    configs = {
        raster: {
            name: 'raster',
            type: 'TileLayer',
            url: 'https://host/{starttime}/{endtime}/{z}/{x}/{y}.png',
            time: { enabled: true, type: 'global', start: 'x', end: 'x' },
        },
        cog: {
            name: 'cog',
            type: 'TileLayer',
            url: 'COG:https://host/{endtime}.tif',
            cogTransform: true,
            cogRendererMode: 'deckRaster',
            time: { enabled: true, type: 'global', start: 'x', end: 'x' },
        },
        mvt: {
            name: 'mvt',
            type: 'MVTLayer',
            url: 'https://host/{starttime}/{endtime}/{z}/{x}/{y}.pbf',
            time: { enabled: true, type: 'global', start: 'x', end: 'x' },
        },
        geodatasets: {
            name: 'geodatasets',
            type: 'MVTLayer',
            url: 'geodatasets:foo',
            time: { enabled: true, type: 'global', start: 'x', end: 'x' },
        },
        untimed: {
            name: 'untimed',
            type: 'TileLayer',
            url: 'https://host/{z}/{x}/{y}.png',
            time: { enabled: false },
        },
        vec: {
            name: 'vec',
            type: 'GeoJsonLayer',
            url: 'https://host/{endtime}.geojson',
            time: { enabled: true, type: 'requery', start: 'x', end: 'x' },
        },
        tiles3d: {
            name: 'tiles3d',
            type: 'Tile3DLayer',
            url: 'https://host/{endtime}/tileset.json',
            time: { enabled: true, type: 'global', start: 'x', end: 'x' },
        },
    }
    await load()
})

describe('buildTimePinnedProps', () => {
    // A tile layer with no explicit tileformat is served as TMS, so the tile-URL
    // pipeline carries the window in query parameters as well as in the path.
    test('a raster tile layer is pinned through its data URL', () => {
        const props = buildTimePinnedProps(['raster'], { start: START, end: END })
        expect(props.raster.data).toBe(
            'https://host/2024-01-01T00:00:00Z/2024-10-31T14:30:00Z/{z}/{x}/{y}.png' +
                '?starttime=2024-01-01T00:00:00Z&time=2024-10-31T14:30:00Z',
        )
    })

    test('a client-side COG is pinned through its geotiff URL', () => {
        const props = buildTimePinnedProps(['cog'], { start: START, end: END })
        expect(props.cog.geotiff).toBe('https://host/2024-10-31T14:30:00Z.tif')
        expect(props.cog.data).toBeUndefined()
    })

    test('a vector tile layer is pinned through its data URL', () => {
        const props = buildTimePinnedProps(['mvt'], { start: START, end: END })
        expect(props.mvt.data).toBe(
            'https://host/2024-01-01T00:00:00Z/2024-10-31T14:30:00Z/{z}/{x}/{y}.pbf',
        )
    })

    test('the layer format governs how the times are written', () => {
        configs.raster.time.format = '%Y-%m-%d'
        const props = buildTimePinnedProps(['raster'], { start: START, end: END })
        expect(props.raster.data).toBe(
            'https://host/2024-01-01/2024-10-31/{z}/{x}/{y}.png' +
                '?starttime=2024-01-01&time=2024-10-31',
        )
    })

    test('layers with no pinnable source are left out', () => {
        const props = buildTimePinnedProps(
            ['untimed', 'vec', 'tiles3d', 'nosuchlayer'],
            { start: START, end: END },
        )
        expect(props).toEqual({})
    })

    // A geodatasets source is served through an API query that Map_ builds at
    // layer creation, and its time never lived in the configured URL. Patching
    // it from that URL would replace a working source with one the tile server
    // cannot answer, so it is left to draw with the source it already has.
    test('a vector tile layer whose URL carries no time is left out', () => {
        const props = buildTimePinnedProps(['geodatasets'], {
            start: START,
            end: END,
        })
        expect(props).toEqual({})
    })

    test('the shared layer config is never written to', () => {
        buildTimePinnedProps(['raster', 'cog', 'mvt'], { start: START, end: END })
        expect(configs.raster.time.start).toBe('x')
        expect(configs.raster.time.end).toBe('x')
        expect(configs.mvt.url).toBe(
            'https://host/{starttime}/{endtime}/{z}/{x}/{y}.pbf',
        )
    })
})

describe('pinWindowFor', () => {
    test('spans the global start up to the pinned instant', () => {
        expect(pinWindowFor(END)).toEqual({ start: START, end: END })
    })
})
