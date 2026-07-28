import { test, expect, describe, vi } from 'vitest'

/**
 * tileLayerSource unit tests.
 *
 * `resolveTileLayerSource` is the single implementation both layer creation
 * (Map_.makeTileLayer) and time-driven reload (TimeControl.reloadLayer) use.
 * The reload path once carried its own copy that ignored the active tile
 * level, so a time change silently swapped the layer back to its default
 * source — no error, just the wrong tiles.
 *
 * L_/ServiceUrls are mocked: this module's job is the branching, not what the
 * URL helpers return.
 */

vi.mock('../../src/essence/Basics/Layers_/Layers_', () => ({
    default: {
        missionPath: 'Missions/Test/',
        getUrl: (type, url) => `resolved(${url})`,
        transformStacUrl: (url) => `stac(${url})`,
    },
}))

vi.mock('../../src/essence/Basics/ServiceUrls/ServiceUrls', () => ({
    default: {
        buildTiTilerCogTilesUrl: (url, layerObj, opts) =>
            `titiler(${url};bands=${JSON.stringify(opts.bands)};resampling=${opts.resampling})`,
    },
}))

vi.mock('../../src/essence/Basics/Formulae_/Formulae_', () => ({
    default: {
        isUrlAbsolute: (url) => /^https?:\/\//.test(url),
    },
}))

const {
    resolveTileLayerSource,
    syncTileFormatToConfig,
    getActiveTileLevel,
    getTileLevelElevation,
} = await import('../../src/essence/Basics/Layers_/tileLayerSource.js')

describe('resolveTileLayerSource', () => {
    describe('tile levels', () => {
        const layerWithLevels = (extra = {}) => ({
            name: 'x',
            type: 'tile',
            url: 'https://default/{z}/{x}/{y}.png',
            variables: {
                tileLevels: [
                    { value: 'low', url: 'https://low/{z}/{x}/{y}.png', height: 10 },
                    { value: 'high', url: 'https://high/{z}/{x}/{y}.png', height: 20 },
                ],
            },
            ...extra,
        })

        test('uses the first level when nothing is selected', () => {
            const { url } = resolveTileLayerSource(layerWithLevels())
            expect(url).toBe('resolved(https://low/{z}/{x}/{y}.png)')
        })

        test('honours the currently selected level', () => {
            const { url } = resolveTileLayerSource(
                layerWithLevels({ currentTileLevel: 'high' })
            )
            expect(url).toBe('resolved(https://high/{z}/{x}/{y}.png)')
        })

        test('honours the configured default level', () => {
            const layer = layerWithLevels()
            layer.variables.defaultTileLevel = 'high'
            expect(resolveTileLayerSource(layer).url).toBe(
                'resolved(https://high/{z}/{x}/{y}.png)'
            )
        })

        test('the selection wins over the configured default', () => {
            const layer = layerWithLevels({ currentTileLevel: 'low' })
            layer.variables.defaultTileLevel = 'high'
            expect(resolveTileLayerSource(layer).url).toBe(
                'resolved(https://low/{z}/{x}/{y}.png)'
            )
        })

        test('returns the selected level elevation', () => {
            expect(
                resolveTileLayerSource(
                    layerWithLevels({ currentTileLevel: 'high' })
                ).tileElevation
            ).toBe(20)
        })

        test("falls back to the layer's own url when a level has none", () => {
            const layer = layerWithLevels()
            layer.variables.tileLevels = [{ value: 'low' }]
            expect(resolveTileLayerSource(layer).url).toBe(
                'resolved(https://default/{z}/{x}/{y}.png)'
            )
        })

        test("uses the layer's own url when there are no levels", () => {
            const { url, tileElevation } = resolveTileLayerSource({
                name: 'x',
                type: 'tile',
                url: 'https://default/{z}/{x}/{y}.png',
            })
            expect(url).toBe('resolved(https://default/{z}/{x}/{y}.png)')
            expect(tileElevation).toBeUndefined()
        })
    })

    describe('service prefixes', () => {
        test('plain templates pass through with no splitColonType', () => {
            const { url, splitColonType } = resolveTileLayerSource({
                type: 'tile',
                url: 'https://t/{z}/{x}/{y}.png',
            })
            expect(url).toBe('resolved(https://t/{z}/{x}/{y}.png)')
            expect(splitColonType).toBeUndefined()
        })

        test('stac-collection transforms the URL and resolves wmts', () => {
            const layer = {
                type: 'tile',
                url: 'stac-collection:mycollection',
            }
            const { url, splitColonType, tileFormat } =
                resolveTileLayerSource(layer)
            expect(splitColonType).toBe('stac-collection')
            expect(url).toBe('stac(stac-collection:mycollection)')
            expect(tileFormat).toBe('wmts')
            // The resolver never writes to the layer config; that is
            // syncTileFormatToConfig's job, called at creation.
            expect(layer.tileformat).toBeUndefined()
        })

        test('a stac-collection tile level transforms the LEVEL url, not the layer url', () => {
            // transformStacUrl no-ops on a non-STAC URL, so resolving
            // layerObj.url here would yield a plain URL tagged as STAC.
            const { url, splitColonType, tileFormat } = resolveTileLayerSource({
                type: 'tile',
                url: 'https://plain/{z}/{x}/{y}.png',
                currentTileLevel: 'stac',
                variables: {
                    tileLevels: [
                        { value: 'stac', url: 'stac-collection:levelcollection' },
                    ],
                },
            })
            expect(splitColonType).toBe('stac-collection')
            expect(url).toBe('stac(stac-collection:levelcollection)')
            expect(tileFormat).toBe('wmts')
        })

        test('non-stac sources resolve tileFormat from the layer config', () => {
            const plain = (extra) =>
                resolveTileLayerSource({
                    type: 'tile',
                    url: 'https://t/{z}/{x}/{y}.png',
                    ...extra,
                }).tileFormat
            expect(plain({})).toBe('tms')
            expect(plain({ tms: false })).toBe('wmts')
            expect(plain({ tileformat: 'wms' })).toBe('wms')
        })

        test('COG wraps the resolved file URL in TiTiler', () => {
            const { url, splitColonType } = resolveTileLayerSource({
                type: 'tile',
                url: 'COG:data/x.tif',
                cogBands: [1, 2, 3],
                cogResampling: 'bilinear',
            })
            expect(splitColonType).toBe('COG')
            expect(url).toBe(
                'titiler(resolved(COG:data/x.tif);bands=[1,2,3];resampling=bilinear)'
            )
        })

        test('a COG expression suppresses the bands', () => {
            const { url } = resolveTileLayerSource({
                type: 'tile',
                url: 'COG:data/x.tif',
                cogBands: [1, 2, 3],
                cogExpression: 'b1/b2',
            })
            expect(url).toContain('bands=null')
        })

        test('an empty COG expression still passes the bands', () => {
            const { url } = resolveTileLayerSource({
                type: 'tile',
                url: 'COG:data/x.tif',
                cogBands: [1],
                cogExpression: '   ',
            })
            expect(url).toContain('bands=[1]')
        })

        test('titiler-url strips the prefix and keeps an absolute URL as is', () => {
            const { url, splitColonType } = resolveTileLayerSource({
                type: 'tile',
                url: 'titiler-url:https://titiler/tiles/{z}/{x}/{y}?url=x.tif',
            })
            expect(splitColonType).toBe('titiler-url')
            // Deliberately not routed through L_.getUrl — see the module note.
            expect(url).toBe('https://titiler/tiles/{z}/{x}/{y}?url=x.tif')
        })

        test('titiler-url absolutizes a relative URL against the mission path', () => {
            const { url } = resolveTileLayerSource({
                type: 'tile',
                url: 'titiler-url:tiles/{z}/{x}/{y}',
            })
            expect(url).toBe('Missions/Test/tiles/{z}/{x}/{y}')
        })

        test('an unrecognized prefix falls through untouched', () => {
            const { url, splitColonType } = resolveTileLayerSource({
                type: 'tile',
                url: 'https://t/{z}/{x}/{y}.png',
            })
            expect(splitColonType).toBeUndefined()
            expect(url).toBe('resolved(https://t/{z}/{x}/{y}.png)')
        })

        test('the prefix is read from the active tile level, not the layer url', () => {
            const { url, splitColonType } = resolveTileLayerSource({
                type: 'tile',
                url: 'https://plain/{z}/{x}/{y}.png',
                currentTileLevel: 'cog',
                variables: {
                    tileLevels: [{ value: 'cog', url: 'COG:data/x.tif' }],
                },
            })
            expect(splitColonType).toBe('COG')
            expect(url).toContain('titiler(')
        })
    })

    describe('getActiveTileLevel', () => {
        test('returns null when no levels are configured', () => {
            expect(getActiveTileLevel({})).toBe(null)
            expect(getActiveTileLevel({ variables: { tileLevels: [] } })).toBe(
                null
            )
        })

        test('falls back to the first level when the selection is unknown', () => {
            const levels = [{ value: 'a' }, { value: 'b' }]
            expect(
                getActiveTileLevel({
                    currentTileLevel: 'nope',
                    variables: { tileLevels: levels },
                })
            ).toBe(levels[0])
        })
    })

    describe('getTileLevelElevation', () => {
        test('reads height, elevation or z', () => {
            expect(getTileLevelElevation({ height: 1 })).toBe(1)
            expect(getTileLevelElevation({ elevation: 2 })).toBe(2)
            expect(getTileLevelElevation({ z: 3 })).toBe(3)
        })

        test('is undefined when absent or unparseable', () => {
            expect(getTileLevelElevation({})).toBeUndefined()
            expect(getTileLevelElevation({ height: 'tall' })).toBeUndefined()
            expect(getTileLevelElevation(null)).toBeUndefined()
        })
    })

    describe('syncTileFormatToConfig', () => {
        test('writes the resolved format for a stac-collection source', () => {
            const layer = { type: 'tile', url: 'stac-collection:mycollection' }
            syncTileFormatToConfig(layer, resolveTileLayerSource(layer))
            expect(layer.tileformat).toBe('wmts')
        })

        test('leaves the config untouched for any other source', () => {
            const layer = { type: 'tile', url: 'https://t/{z}/{x}/{y}.png' }
            syncTileFormatToConfig(layer, resolveTileLayerSource(layer))
            expect(layer.tileformat).toBeUndefined()

            const cog = { type: 'tile', url: 'COG:data/x.tif' }
            syncTileFormatToConfig(cog, resolveTileLayerSource(cog))
            expect(cog.tileformat).toBeUndefined()
        })
    })
})
