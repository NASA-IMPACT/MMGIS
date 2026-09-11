import { describe, test, expect } from 'vitest'
import {
    refreshDeckTileLayer,
    refreshDeckWmsLayer,
} from '../../src/essence/Basics/Layers_/deckTileRefresher.js'
import { buildDeckLayer } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers'

/**
 * The refreshers a deck.gl raster tile layer is registered with. A time
 * change, a colormap pick and a requery all arrive as a source URL plus tile
 * options, and what comes back is either a replacement layer or nothing -
 * nothing meaning the engine keeps what it holds.
 */
const makeDeckLayer = (props) => ({
    id: 'l1',
    props: { id: 'l1', ...props },
    clone(patch) {
        return makeDeckLayer({ ...props, ...patch })
    },
})

const TILE_URL = 'https://example.com/{z}/{x}/{y}.png?time={time}'

describe('refreshDeckTileLayer', () => {
    test('bakes the tile options into the URL deck.gl serves', () => {
        const layer = makeDeckLayer({
            data: 'https://example.com/{z}/{x}/{y}.png?time=202201',
        })
        const next = refreshDeckTileLayer(layer, {
            url: TILE_URL,
            tileOptions: { time: '202206' },
        })

        expect(next.props.data).toBe(
            'https://example.com/{z}/{x}/{y}.png?time=202206'
        )
    })

    // Handing deck.gl an empty url blanks the layer, so a source that resolves
    // to nothing has to leave the engine holding what it has.
    test.each([
        ['no source URL', { url: null }],
        ['a source URL that compiles to nothing', { url: '' }],
    ])('keeps the layer given %s', (_label, ctx) => {
        expect(refreshDeckTileLayer(makeDeckLayer({ data: 'a' }), ctx)).toBeUndefined()
    })
})

describe('refreshDeckWmsLayer', () => {
    const WMS_URL =
        'https://wms.example/ows?LAYERS=no2&STYLES=&FORMAT=image/png&time={time}'

    // deck.gl's WMSLayer builds its GetMap requests from an image source, and
    // given a full URL as a string it appends a second query to it. The
    // refresh has to hand it a source built from the base and the params.
    test('rebuilds the image source from the compiled URL', () => {
        const layer = makeDeckLayer({ data: 'previous source', layers: ['no2'] })
        const next = refreshDeckWmsLayer(layer, {
            url: WMS_URL,
            tileOptions: { time: '202206' },
        })

        expect(typeof next.props.data).not.toBe('string')
        const getMap = next.props.data.getMapURL({
            width: 1,
            height: 1,
            bbox: [0, 0, 1, 1],
            layers: next.props.layers,
        })
        expect(getMap.startsWith('https://wms.example/ows?')).toBe(true)
        expect(getMap.match(/\?/g)).toHaveLength(1)
        expect(getMap).toContain('TIME=202206')
        expect(next.props.layers).toEqual(['no2'])
    })

    // A play tick or a slider nudge that lands inside the layer's current time
    // bucket compiles to the URL the layer is already drawing. A WMS layer
    // cannot spot that for itself - every rebuild is a new source object, and
    // deck.gl compares sources by identity - so an unremarked clone costs a
    // GetCapabilities and a GetMap for the image already on screen. What the
    // layer is drawing is remembered as `wmsSourceUrl`, a prop deck.gl knows
    // nothing about, so this runs on a real WMSLayer through a real clone:
    // the URL it was built with has to read the same way as a compiled one,
    // and the clone has to carry the prop forward or every refresh after the
    // first one reloads again.
    test('keeps a real layer until the compiled URL changes', () => {
        const refresh = (layer, time) =>
            refreshDeckWmsLayer(layer, {
                url: WMS_URL,
                tileOptions: { time },
            })

        const built = buildDeckLayer('wms-layer', {
            type: 'tile',
            tileformat: 'wms',
            url: WMS_URL.replace('{time}', '202206'),
        })

        expect(refresh(built, '202206')).toBeUndefined()

        const moved = refresh(built, '202207')
        expect(moved).not.toBeUndefined()
        expect(moved.props.data).not.toBe(built.props.data)
        expect(refresh(moved, '202207')).toBeUndefined()
    })

    test('keeps the layer given no source URL', () => {
        expect(refreshDeckWmsLayer(makeDeckLayer({}), { url: null })).toBeUndefined()
    })
})
