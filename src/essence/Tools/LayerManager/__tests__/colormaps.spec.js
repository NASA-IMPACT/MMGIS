import { test, expect } from 'vitest'
import {
    applyColormapDirection,
    canReverseColormap,
    buildGradientCss,
    formatColormapLabel,
    getBaseColormapName,
    isReversedColormap,
    toForwardColormapNames,
    validateRescale,
} from '../lib/utils/colormaps.ts'

test.describe('colormap names', () => {
    test('reads direction off the name suffix', () => {
        expect(isReversedColormap('viridis_r')).toBe(true)
        expect(isReversedColormap('viridis')).toBe(false)
        expect(isReversedColormap(null)).toBe(false)
    })

    test('strips the suffix to get the base name', () => {
        expect(getBaseColormapName('rdylbu_r')).toBe('rdylbu')
        expect(getBaseColormapName('rdylbu')).toBe('rdylbu')
        expect(getBaseColormapName(undefined)).toBe('')
    })

    test('recombines a base name with a direction', () => {
        expect(applyColormapDirection('Viridis', false)).toBe('viridis')
        expect(applyColormapDirection('viridis', true)).toBe('viridis_r')
    })

    test('re-reversing an already reversed name does not double the suffix', () => {
        expect(applyColormapDirection('viridis_r', true)).toBe('viridis_r')
        expect(applyColormapDirection('viridis_r', false)).toBe('viridis')
    })

    test('labels are title-cased with underscores spaced out', () => {
        expect(formatColormapLabel('rd_yl_bu_r')).toBe('Rd yl bu')
        expect(formatColormapLabel('')).toBe('')
    })
})

test.describe('toForwardColormapNames', () => {
    test('keeps one forward entry per ramp and sorts them', () => {
        const names = ['viridis', 'viridis_r', 'accent', 'accent_r', 'magma']
        expect(toForwardColormapNames(names)).toEqual(['accent', 'magma', 'viridis'])
    })

    test('is empty when there is no list', () => {
        expect(toForwardColormapNames(null)).toEqual([])
    })
})

test.describe('gradients', () => {
    test('interpolates evenly across the stops', () => {
        expect(buildGradientCss(['#000', '#888', '#fff'])).toBe(
            'linear-gradient(to right, #000 0%, #888 50%, #fff 100%)',
        )
    })

    test('a single color is a flat fill, and no colors is transparent', () => {
        expect(buildGradientCss(['#abc'])).toBe('#abc')
        expect(buildGradientCss([])).toBe('transparent')
        expect(buildGradientCss(null)).toBe('transparent')
    })
})

test.describe('validateRescale', () => {
    test('accepts an ascending numeric range', () => {
        expect(validateRescale('0', '30')).toEqual({ valid: true, min: 0, max: 30 })
        expect(validateRescale(-2.5, 4)).toEqual({ valid: true, min: -2.5, max: 4 })
    })

    test('rejects empty, non-numeric, and infinite bounds', () => {
        expect(validateRescale('', '30').valid).toBe(false)
        expect(validateRescale('  ', '30').valid).toBe(false)
        expect(validateRescale('5abc', '30').valid).toBe(false)
        expect(validateRescale('0', 'abc').valid).toBe(false)
        expect(validateRescale('0', Infinity).valid).toBe(false)
    })

    test('rejects a range that does not ascend', () => {
        expect(validateRescale('30', '0').valid).toBe(false)
        expect(validateRescale('5', '5').valid).toBe(false)
    })
})

test('canReverseColormap offers a reversal only when the service lists the _r form', () => {
    const listed = ['viridis', 'viridis_r', 'tornado_ef_scale']
    expect(canReverseColormap('viridis', listed)).toBe(true)
    expect(canReverseColormap('Viridis', listed)).toBe(true)
    expect(canReverseColormap('tornado_ef_scale', listed)).toBe(false)
})

test('canReverseColormap allows every ramp with no service list', () => {
    expect(canReverseColormap('jet', null)).toBe(true)
})
