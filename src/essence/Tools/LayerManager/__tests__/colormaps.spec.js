import { test, expect } from 'vitest'
import {
    applyColormapDirection,
    buildGradientCss,
    colormapResponseToColors,
    formatColormapLabel,
    getBaseColormapName,
    isReversedColormap,
    parseColormapList,
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

test.describe('parseColormapList', () => {
    test('reads a flat array of names', () => {
        expect(parseColormapList({ colorMaps: ['viridis', 'viridis_r'] })).toEqual([
            'viridis',
            'viridis_r',
        ])
    })

    test('reads entries carrying the name under id', () => {
        const payload = { colormaps: [{ id: 'accent', links: [] }, { id: 'accent_r' }] }
        expect(parseColormapList(payload)).toEqual(['accent', 'accent_r'])
    })

    test('returns null when nothing recognizable is present', () => {
        expect(parseColormapList(null)).toBe(null)
        expect(parseColormapList({})).toBe(null)
        expect(parseColormapList({ colorMaps: [] })).toBe(null)
        expect(parseColormapList({ colorMaps: 'viridis' })).toBe(null)
        expect(parseColormapList({ colorMaps: [{ nope: 1 }] })).toBe(null)
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

    test('orders colors numerically rather than by key order', () => {
        const response = {
            10: [0, 0, 0, 255],
            2: [255, 255, 255, 255],
        }
        expect(colormapResponseToColors(response)).toEqual([
            'rgba(255, 255, 255, 1)',
            'rgba(0, 0, 0, 1)',
        ])
    })

    test('defaults a missing alpha channel to opaque', () => {
        expect(colormapResponseToColors({ 0: [1, 2, 3] })).toEqual(['rgba(1, 2, 3, 1)'])
    })

    test('returns null for an unusable response', () => {
        expect(colormapResponseToColors(null)).toBe(null)
        expect(colormapResponseToColors({})).toBe(null)
        expect(colormapResponseToColors({ 0: 'nope' })).toBe(null)
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
