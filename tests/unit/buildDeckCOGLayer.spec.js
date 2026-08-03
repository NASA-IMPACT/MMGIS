import { test, expect, describe } from 'vitest'
import { buildDeckCOGLayer } from '../../src/essence/Basics/MapEngines/Adapters/DeckCOGLayer.ts'

describe('buildDeckCOGLayer', () => {
    test('derives zoom limits from the layer config so refresh rebuilds keep them', () => {
        const layer = buildDeckCOGLayer('l1', {
            rawCogUrl: 'https://example.com/a.tif',
            layerObj: { minZoom: '3', maxZoom: '12', cogColormap: 'viridis' },
        })
        expect(layer.props.minZoom).toBe(3)
        expect(layer.props.maxZoom).toBe(12)
    })

    test('leaves zoom limits at deck defaults (not NaN) when the config has none', () => {
        const layer = buildDeckCOGLayer('l2', {
            rawCogUrl: 'https://example.com/a.tif',
            layerObj: {},
        })
        expect(Number.isNaN(layer.props.minZoom)).toBe(false)
        expect(Number.isNaN(layer.props.maxZoom)).toBe(false)
    })
})
