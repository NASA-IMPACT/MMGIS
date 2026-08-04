import { test, expect, describe } from 'vitest'
import {
    buildDeckCOGLayer,
    resolveNoDataValue,
    canonicalizeNoData,
    NODATA_SENTINEL,
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

    test('returns null for NaN (NaN is canonicalized at upload, not matched by ==)', () => {
        expect(resolveNoDataValue(null, NaN)).toBe(null)
        expect(resolveNoDataValue(NaN, -9999)).toBe(null)
    })
})

describe('canonicalizeNoData', () => {
    test('replaces NaN pixels with the sentinel in place', () => {
        const f32 = Float32Array.from([1.5, NaN, 280.25, NaN])
        const out = canonicalizeNoData(f32, null)
        expect(out).toBe(f32)
        expect(out[0]).toBe(1.5)
        expect(out[1]).toBe(NODATA_SENTINEL)
        expect(out[2]).toBe(280.25)
        expect(out[3]).toBe(NODATA_SENTINEL)
    })

    test('replaces a declared nodata value alongside NaN', () => {
        const f32 = Float32Array.from([-9999, 42, NaN])
        const out = canonicalizeNoData(f32, -9999)
        expect(out[0]).toBe(NODATA_SENTINEL)
        expect(out[1]).toBe(42)
        expect(out[2]).toBe(NODATA_SENTINEL)
    })

    test('leaves data untouched when there is no NaN and no declared nodata', () => {
        const f32 = Float32Array.from([0, 1, 2])
        expect(Array.from(canonicalizeNoData(f32, null))).toEqual([0, 1, 2])
    })

    test('sentinel is representable exactly in float32 (survives the texture round-trip)', () => {
        expect(Math.fround(NODATA_SENTINEL)).toBe(NODATA_SENTINEL)
    })
})
