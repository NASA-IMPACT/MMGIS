import { test, expect, describe } from 'vitest'
import { evaluate_cmap } from '../../src/external/js-colormaps/js-colormaps.js'
import { normalizeColormapName, buildColormapLUT } from '../../src/essence/Basics/MapEngines/Adapters/colormapLUT.ts'

describe('normalizeColormapName', () => {
    test('strips _r and flags reverse', () => {
        expect(normalizeColormapName('viridis_r')).toEqual({ name: 'viridis', reverse: true })
    })
    test('case-insensitively recovers canonical key', () => {
        expect(normalizeColormapName('rdbu')).toEqual({ name: 'RdBu', reverse: false })
    })
    test('falls back to viridis for unknown', () => {
        expect(normalizeColormapName('not-a-map')).toEqual({ name: 'viridis', reverse: false })
    })
})

describe('buildColormapLUT', () => {
    test('produces 256 RGBA samples matching evaluate_cmap', () => {
        const lut = buildColormapLUT('viridis')
        expect(lut.length).toBe(256 * 4)
        const [r, g, b] = evaluate_cmap(0, 'viridis', false)
        expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([r, g, b, 255])
        const [r2, g2, b2] = evaluate_cmap(255 / 255, 'viridis', false)
        expect([lut[255 * 4], lut[255 * 4 + 1], lut[255 * 4 + 2]]).toEqual([r2, g2, b2])
    })
    test('reversed variant mirrors samples', () => {
        const fwd = buildColormapLUT('viridis')
        const rev = buildColormapLUT('viridis_r')
        expect([rev[0], rev[1], rev[2]]).toEqual([fwd[255 * 4], fwd[255 * 4 + 1], fwd[255 * 4 + 2]])
    })
})
