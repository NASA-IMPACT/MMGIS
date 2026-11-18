import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    STANDARD_COLORMAP_NAMES,
    findStandardColormap,
    getStandardColormapTable,
    getStandardColormapTableOrFallback,
    getStandardColormapCss,
    sampleStandardColormap,
} from '../../src/essence/Basics/Colormaps/standardColormaps.ts'

afterEach(() => {
    vi.restoreAllMocks()
})

const colourAt = (table, i) => Array.from(table.subarray(i * 4, i * 4 + 4))

describe('standard colormaps', () => {
    test('are named as the tiling service names them, forward only', () => {
        expect(STANDARD_COLORMAP_NAMES).toContain('viridis')
        expect(STANDARD_COLORMAP_NAMES).toContain('rdbu')
        expect(STANDARD_COLORMAP_NAMES.every((n) => n === n.toLowerCase())).toBe(true)
        expect(STANDARD_COLORMAP_NAMES.some((n) => n.endsWith('_r'))).toBe(false)
    })

    test('find names in any case, with or without `_r`', () => {
        expect(findStandardColormap('RdBu')).toBe('rdbu')
        expect(findStandardColormap('RdBu_r')).toBe('rdbu')
        expect(findStandardColormap('naqfc_pm25')).toBeNull()
        expect(findStandardColormap(null)).toBeNull()
    })

    test('decode once and share the table', () => {
        const table = getStandardColormapTable('viridis')
        expect(table.length).toBe(1024)
        expect(getStandardColormapTable('VIRIDIS')).toBe(table)
        // viridis starts dark purple and ends yellow, as the service has it.
        expect(colourAt(table, 0)).toEqual([68, 1, 84, 255])
        expect(colourAt(table, 255)).toEqual([253, 231, 36, 255])
    })

    test('reverse by `_r` or by flag, the two cancelling out', () => {
        const forward = getStandardColormapTable('viridis')
        const reversed = getStandardColormapTable('viridis_r')
        expect(colourAt(reversed, 0)).toEqual(colourAt(forward, 255))
        expect(getStandardColormapTable('viridis', true)).toBe(reversed)
        expect(getStandardColormapTable('viridis_r', true)).toBe(forward)
    })

    test('fall back to viridis only where asked to', () => {
        expect(getStandardColormapTable('not-a-map')).toBeNull()
        expect(getStandardColormapTableOrFallback('not-a-map')).toBe(
            getStandardColormapTable('viridis')
        )
    })

    test('list a ramp as 256 CSS colours', () => {
        const css = getStandardColormapCss('viridis')
        expect(css).toHaveLength(256)
        expect(css[0]).toBe('rgba(68, 1, 84, 1)')
        expect(getStandardColormapCss('viridis_r')).toEqual([...css].reverse())
        expect(getStandardColormapCss('not-a-map')).toBeNull()
    })

    test('sample one position at a time, as a per-pixel renderer does', () => {
        expect(sampleStandardColormap(0, 'viridis')).toEqual([68, 1, 84])
        expect(sampleStandardColormap(1, 'viridis')).toEqual([253, 231, 36])
        expect(sampleStandardColormap(0, 'viridis', true)).toEqual([253, 231, 36])
        // 0.5 rescales to 127.5, which truncates to index 127.
        expect(sampleStandardColormap(0.5, 'Viridis')).toEqual(
            colourAt(getStandardColormapTable('viridis'), 127).slice(0, 3)
        )
    })

    test('sample an unknown ramp as viridis, warning once per name', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(sampleStandardColormap(0, 'mystery')).toEqual([68, 1, 84])
        sampleStandardColormap(0.3, 'mystery')
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toMatch(/"mystery"/)
    })
})
