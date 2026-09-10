import { describe, test, expect } from 'vitest'
import { refreshDeckTileLayer } from '../../src/essence/Basics/Layers_/deckTileRefresher.js'

/**
 * The refresher a plain deck.gl raster tile layer is registered with. A time
 * change, a colormap pick and a requery all arrive here as a source URL plus
 * tile options, and what comes back is either a replacement layer or nothing —
 * nothing meaning the engine keeps what it holds.
 *
 * A returned layer costs a full tileset reload: deck.gl reads new `data` as a
 * new source, drops every cached tile and refetches the viewport.
 */
const makeDeckLayer = (data) => ({
    id: 'l1',
    props: { id: 'l1', data },
    clone(patch) {
        return makeDeckLayer(patch.data ?? data)
    },
})

const TILE_URL = 'https://example.com/{z}/{x}/{y}.png?time={time}'

describe('refreshDeckTileLayer', () => {
    test('bakes the tile options into the URL deck.gl serves', () => {
        const layer = makeDeckLayer('https://example.com/{z}/{x}/{y}.png?time=202201')
        const next = refreshDeckTileLayer(layer, {
            url: TILE_URL,
            tileOptions: { time: '202206' },
        })

        expect(next.props.data).toBe(
            'https://example.com/{z}/{x}/{y}.png?time=202206'
        )
    })

    // The case the production tile bill is made of: a play tick or a slider
    // nudge that lands inside the layer's current time bucket compiles to the
    // URL already on screen. Reloading it refetches every visible tile to draw
    // exactly what is drawn, and aborts the in-flight ones — which the tile
    // service has already begun answering.
    test('keeps the layer when the compiled URL has not changed', () => {
        const compiled = 'https://example.com/{z}/{x}/{y}.png?time=202206'
        const layer = makeDeckLayer(compiled)

        const next = refreshDeckTileLayer(layer, {
            url: TILE_URL,
            tileOptions: { time: '202206' },
        })

        expect(next).toBeUndefined()
    })

    // `force` is the caller saying the bytes behind the URL may have changed
    // even though the URL did not — a requery, a nocache — so the URL check
    // must not swallow it.
    test('reloads an unchanged URL when the caller forces it', () => {
        const compiled = 'https://example.com/{z}/{x}/{y}.png?time=202206'
        const layer = makeDeckLayer(compiled)

        const next = refreshDeckTileLayer(layer, {
            url: TILE_URL,
            tileOptions: { time: '202206' },
            force: true,
        })

        expect(next).not.toBeUndefined()
        expect(next.props.data).toBe(compiled)
    })

    // Handing deck.gl an empty url blanks the layer, so a source that resolves
    // to nothing has to leave the engine holding what it has.
    test.each([
        ['no source URL', { url: null }],
        ['a source URL that compiles to nothing', { url: '' }],
    ])('keeps the layer given %s', (_label, ctx) => {
        expect(refreshDeckTileLayer(makeDeckLayer('a'), ctx)).toBeUndefined()
    })

    // A layer the engine holds but has never refreshed carries whatever data
    // it was built with; the comparison must not mistake a missing props bag
    // for a match.
    test('reloads a layer that carries no data yet', () => {
        const next = refreshDeckTileLayer(
            { id: 'l1', props: {}, clone: (patch) => makeDeckLayer(patch.data) },
            { url: TILE_URL, tileOptions: { time: '202206' } }
        )

        expect(next.props.data).toBe(
            'https://example.com/{z}/{x}/{y}.png?time=202206'
        )
    })
})
