import { describe, test, expect, vi } from 'vitest'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

// L_.getUrl dereferences window.mmgisglobal on the tile branch; jsdom has none.
window.mmgisglobal = window.mmgisglobal || {}

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)
const { makeDeckCOGRefresher } = await import(
    '../../src/essence/Basics/Layers_/deckCOGRefresher.js'
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
