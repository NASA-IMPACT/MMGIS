import { describe, test, expect, vi } from 'vitest'
import LeafletAdapter from '../../src/essence/Basics/MapEngines/Adapters/LeafletAdapter.ts'
import DeckGLAdapter from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'

/**
 * refreshLayer is the single update entry point both engines expose (#274).
 * The registered refresher decides WHAT changes; the adapter decides HOW to
 * apply it — Leaflet mutates in place, deck.gl clones and re-syncs.
 */

// A Leaflet tile layer: mutates in place, exposes the native refresh().
const makeLeafletTileLayer = () => ({
    refreshed: null,
    refresh(url, force, tileOptions) {
        this.refreshed = { url, force, tileOptions }
    },
})

// A deck.gl layer: immutable, clone() returns a new instance carrying the patch.
const makeDeckLayer = (id, props = {}) => ({
    id,
    props: { id, ...props },
    clone(patch) {
        return makeDeckLayer(id, { ...props, ...patch })
    },
})

describe('LeafletAdapter.refreshLayer', () => {
    test('calls the native refresh() when no refresher is registered', () => {
        const adapter = new LeafletAdapter()
        const layer = makeLeafletTileLayer()
        adapter.registerLayer('l1', layer)

        expect(
            adapter.refreshLayer('l1', {
                url: 'https://x/{z}/{x}/{y}.png',
                tileOptions: { colormap: 'viridis' },
                force: true,
            })
        ).toBe(true)
        expect(layer.refreshed).toEqual({
            url: 'https://x/{z}/{x}/{y}.png',
            force: true,
            tileOptions: { colormap: 'viridis' },
        })
    })

    test('prefers a registered refresher over the native refresh()', () => {
        const adapter = new LeafletAdapter()
        const layer = makeLeafletTileLayer()
        adapter.registerLayer('l1', layer)
        const refresh = vi.fn()
        adapter.setLayerRefresher('l1', refresh)

        expect(adapter.refreshLayer('l1', { url: 'u' })).toBe(true)
        expect(refresh).toHaveBeenCalledWith(layer, {
            url: 'u',
            tileOptions: undefined,
            force: undefined,
        })
        expect(layer.refreshed).toBe(null)
    })

    test('returns false for an unregistered id', () => {
        expect(new LeafletAdapter().refreshLayer('nope')).toBe(false)
    })

    test('returns false for a layer with neither a refresher nor refresh()', () => {
        const adapter = new LeafletAdapter()
        adapter.registerLayer('l1', {})
        expect(adapter.refreshLayer('l1')).toBe(false)
    })

    test('setLayerRefresher(id, null) clears the hook', () => {
        const adapter = new LeafletAdapter()
        const layer = makeLeafletTileLayer()
        adapter.registerLayer('l1', layer)
        adapter.setLayerRefresher('l1', vi.fn())
        adapter.setLayerRefresher('l1', null)

        adapter.refreshLayer('l1', { url: 'u' })
        expect(layer.refreshed).not.toBe(null)
    })
})

describe('DeckGLAdapter.refreshLayer', () => {
    test('adopts the instance a refresher returns', () => {
        const adapter = new DeckGLAdapter()
        const original = makeDeckLayer('l1', { geotiff: 'a.tif' })
        adapter.addLayer(original)
        adapter.setLayerRefresher('l1', (layer) =>
            layer.clone({ geotiff: 'b.tif' })
        )

        expect(adapter.refreshLayer('l1')).toBe(true)
        const held = adapter.getLayers().find((l) => l.id === 'l1')
        expect(held).not.toBe(original)
        expect(held.props.geotiff).toBe('b.tif')
    })

    test('keeps the existing instance when the refresher returns nothing', () => {
        const adapter = new DeckGLAdapter()
        const original = makeDeckLayer('l1')
        adapter.addLayer(original)
        adapter.setLayerRefresher('l1', () => {})

        expect(adapter.refreshLayer('l1')).toBe(true)
        expect(adapter.getLayers().find((l) => l.id === 'l1')).toBe(original)
    })

    test('falls back to cloning with a compiled tile URL', () => {
        const adapter = new DeckGLAdapter()
        adapter.addLayer(makeDeckLayer('l1', { data: 'old' }))

        // The url carries a {time} placeholder and tileOptions substitutes it,
        // so this is only observable if the fallback actually calls
        // compileTileUrl — a byte-identical url (no placeholder) would pass
        // even if compileTileUrl were never invoked.
        expect(
            adapter.refreshLayer('l1', {
                url: 'https://x/{z}/{x}/{y}.png?time={time}',
                tileOptions: { time: '2024-01-01T00:00:00Z' },
            })
        ).toBe(true)
        const data = adapter.getLayers().find((l) => l.id === 'l1').props.data
        expect(data).not.toContain('{time}')
        expect(data).toContain('2024-01-01T00:00:00Z')
    })

    test('returns false for an unregistered id', () => {
        expect(new DeckGLAdapter().refreshLayer('nope')).toBe(false)
    })

    test('does not clone when the fallback has no url to compile', () => {
        const adapter = new DeckGLAdapter()
        const original = makeDeckLayer('l1', { data: 'old' })
        adapter.addLayer(original)

        expect(adapter.refreshLayer('l1')).toBe(false)
        expect(adapter.getLayers().find((l) => l.id === 'l1')).toBe(original)
    })
})
