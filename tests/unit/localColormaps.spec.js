import { test, expect, describe } from 'vitest'
import {
    evaluate_cmap,
    data as colormapData,
} from '../../src/external/js-colormaps/js-colormaps.js'
import { buildColormapLUT } from '../../src/essence/Basics/MapEngines/Adapters/colormapLUT.ts'
import {
    listLocalColormapNames,
    hasLocalColormap,
    getLocalColormapColors,
    buildLocalColormapTable,
} from '../../src/essence/Basics/Colormaps/localColormaps.ts'

const rgb = (name, x, reverse = false) => {
    const [r, g, b] = evaluate_cmap(x, name, reverse)
    return `rgba(${r}, ${g}, ${b}, 1)`
}

describe('listLocalColormapNames', () => {
    // Lowercase is how a tiling service names its ramps, and the UI's label
    // and apply paths already assume it. Emitting the evaluator's own mixed
    // casing would render "RdBu" where the service path renders "Rdbu".
    test('reports every ramp the evaluator knows, lowercased and forward only', () => {
        const names = listLocalColormapNames()
        expect(names).toEqual(
            Object.keys(colormapData)
                .map((n) => n.toLowerCase())
                .sort((a, b) => a.localeCompare(b))
        )
        expect(names.some((n) => n.endsWith('_r'))).toBe(false)
    })
})

describe('hasLocalColormap', () => {
    test('accepts a canonical name, a differently-cased one, and its reversed form', () => {
        expect(hasLocalColormap('viridis')).toBe(true)
        expect(hasLocalColormap('rdbu')).toBe(true)
        expect(hasLocalColormap('viridis_r')).toBe(true)
    })

    // The renderer-aware list leans on this: a name the GPU cannot honour must
    // report false rather than silently resolving to the viridis fallback.
    test('rejects a name the evaluator does not define', () => {
        expect(hasLocalColormap('nlcd')).toBe(false)
        expect(hasLocalColormap('')).toBe(false)
    })
})

describe('getLocalColormapColors', () => {
    test('samples an interpolated ramp end to end', () => {
        const colors = getLocalColormapColors('viridis')
        expect(colors[0]).toBe(rgb('viridis', 0))
        expect(colors[colors.length - 1]).toBe(rgb('viridis', 1))
    })

    test('reverses when the name carries the _r suffix', () => {
        const forward = getLocalColormapColors('viridis')
        const reversed = getLocalColormapColors('viridis_r')
        expect(reversed[0]).toBe(forward[forward.length - 1])
    })

    // The swatch and the GPU both stand for the same rendered pixels, so they
    // have to be sampled identically. A qualitative ramp emitted at its own
    // palette length would blend smoothly across its colours, where the GPU
    // paints — and a tile server returns — hard bands of equal width.
    test('samples a discrete ramp exactly as the GPU lookup table does', () => {
        const colors = getLocalColormapColors('Accent')
        const lut = buildColormapLUT('Accent')

        expect(colors).toHaveLength(256)
        const fromLut = (i) =>
            `rgba(${lut[i * 4]}, ${lut[i * 4 + 1]}, ${lut[i * 4 + 2]}, 1)`
        expect(colors).toEqual(Array.from({ length: 256 }, (_, i) => fromLut(i)))
        // Eight colours, each held for a run rather than blended between.
        expect(new Set(colors).size).toBe(colormapData.Accent.colors.length)
    })

    test('samples an interpolated ramp exactly as the GPU lookup table does', () => {
        const colors = getLocalColormapColors('viridis')
        const lut = buildColormapLUT('viridis')

        expect(colors).toHaveLength(256)
        expect(colors[128]).toBe(
            `rgba(${lut[128 * 4]}, ${lut[128 * 4 + 1]}, ${lut[128 * 4 + 2]}, 1)`
        )
    })

    test('returns null for a name the evaluator does not define', () => {
        expect(getLocalColormapColors('nlcd')).toBeNull()
    })
})

describe('buildLocalColormapTable', () => {
    test('carries every listed ramp and agrees with getLocalColormapColors', () => {
        const table = buildLocalColormapTable()
        expect(Object.keys(table).sort()).toEqual(listLocalColormapNames().sort())
        expect(table.viridis).toEqual(getLocalColormapColors('viridis'))
    })

    // Consumers look ramps up by the lowercased name the UI carries, so a
    // mixed-case ramp has to be reachable under that spelling.
    test('keys a mixed-case ramp by its lowercased name', () => {
        expect(buildLocalColormapTable().rdbu).toEqual(getLocalColormapColors('RdBu'))
    })

    test('returns the same memoized table rather than rebuilding it', () => {
        expect(buildLocalColormapTable()).toBe(buildLocalColormapTable())
    })
})
