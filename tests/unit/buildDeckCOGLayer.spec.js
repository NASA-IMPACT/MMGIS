import { test, expect, describe } from 'vitest'
import {
    buildDeckCOGLayer,
    resolveNoDataValue,
} from '../../src/essence/Basics/MapEngines/Adapters/DeckCOGLayer.ts'

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

describe('resolveNoDataValue', () => {
    test("falls back to the file's GDAL_NODATA when no config value is set", () => {
        expect(resolveNoDataValue(null, -9999)).toBe(-9999)
        expect(resolveNoDataValue(undefined, 0)).toBe(0)
    })

    test('config value wins over the file value', () => {
        expect(resolveNoDataValue(255, -9999)).toBe(255)
    })

    test('returns null when neither is set', () => {
        expect(resolveNoDataValue(null, null)).toBe(null)
        expect(resolveNoDataValue(undefined, undefined)).toBe(null)
    })

    test('returns null for NaN (FilterNaN handles it; == can never match NaN)', () => {
        expect(resolveNoDataValue(null, NaN)).toBe(null)
        expect(resolveNoDataValue(NaN, -9999)).toBe(null)
    })
})
