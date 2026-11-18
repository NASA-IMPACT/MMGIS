import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseColormapList } from '../../src/essence/Basics/Colormaps/colormapList.ts'

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

describe('parseColormapList', () => {
    test('reads a flat array of names, as VEDA lists them', () => {
        expect(parseColormapList({ colorMaps: ['viridis', 'viridis_r'] })).toEqual([
            'viridis',
            'viridis_r',
        ])
        const veda = parseColormapList(read('tests/unit/fixtures/colormaps/veda/colorMaps.json'))
        expect(veda).toHaveLength(221)
        expect(veda).toContain('nlcd')
    })

    test('reads entries carrying the name under id or name, as EIC lists them', () => {
        const payload = { colormaps: [{ id: 'accent', links: [] }, { name: 'accent_r' }] }
        expect(parseColormapList(payload)).toEqual(['accent', 'accent_r'])
        const eic = parseColormapList(read('tests/unit/fixtures/colormaps/eic/colorMaps.json'))
        expect(eic).toHaveLength(214)
        expect(eic).toContain('naqfc_pm25')
    })

    test('returns null when nothing recognizable is present', () => {
        expect(parseColormapList(null)).toBe(null)
        expect(parseColormapList({})).toBe(null)
        expect(parseColormapList({ colorMaps: [] })).toBe(null)
        expect(parseColormapList({ colorMaps: 'viridis' })).toBe(null)
        expect(parseColormapList({ colorMaps: [{ nope: 1 }] })).toBe(null)
    })
})
