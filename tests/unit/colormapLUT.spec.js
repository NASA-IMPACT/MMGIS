import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildColormapLUT } from '../../src/essence/Basics/MapEngines/Adapters/colormapLUT.ts'
import { getStandardColormapTable } from '../../src/essence/Basics/Colormaps/standardColormaps.ts'

const legacy = JSON.parse(
    readFileSync('tests/unit/fixtures/colormaps/legacy-lut.json', 'utf8')
)
const legacyColour = (name, i) => {
    const hex = legacy.ramps[name].slice(i * 6, i * 6 + 6)
    return [0, 2, 4].map((o) => parseInt(hex.slice(o, o + 2), 16))
}
const lutColour = (lut, i) => Array.from(lut.subarray(i * 4, i * 4 + 4))
const channelDifference = (a, b) =>
    Math.max(...[0, 1, 2].map((c) => Math.abs(a[c] - b[c])))

describe('buildColormapLUT', () => {
    test('is the bundled table, copied', () => {
        const lut = buildColormapLUT('viridis')
        expect(lut.length).toBe(256 * 4)
        expect(lut).toEqual(getStandardColormapTable('viridis'))
        expect(lut).not.toBe(getStandardColormapTable('viridis'))
    })

    test('matches names case-insensitively', () => {
        expect(buildColormapLUT('RdBu')).toEqual(buildColormapLUT('rdbu'))
        expect(buildColormapLUT(' Viridis ')).toEqual(buildColormapLUT('viridis'))
    })

    test('a `_r` name is the exact mirror of the forward ramp', () => {
        const fwd = buildColormapLUT('viridis')
        const rev = buildColormapLUT('viridis_r')
        for (let i = 0; i < 256; i++) {
            expect(lutColour(rev, i)).toEqual(lutColour(fwd, 255 - i))
        }
    })

    test('paints an unknown name as viridis', () => {
        expect(buildColormapLUT('not-a-map')).toEqual(buildColormapLUT('viridis'))
        expect(buildColormapLUT('')).toEqual(buildColormapLUT('viridis'))
    })
})

// legacy-lut.json is what the renderer painted for each bundled ramp when
// ramps were js-colormaps float lists. The 256-colour tables must paint the
// same ramps:
//
// - Smooth ramps: every colour within 2/255 per channel. The float lists were
//   rounded to four decimals (up to 1/255 off), and `twilight` and
//   `twilight_shifted` were 510-colour lists that the evaluator sampled by
//   averaging two neighbours (up to 2/255 off). Neither is visible.
// - Stepped ramps (`qualitative` in the fixture): the same colours in the same
//   order, but a step may start one index earlier or later. The evaluator
//   split 0-1 into equal bands itself; the service uses matplotlib's own
//   split, which differs at a few band edges. At each such index the old
//   colour must be the new colour of a neighbouring index, so only the edge
//   moved.
// - Every colour opaque, as it always was.
describe('bundled ramps paint as the js-colormaps evaluator did', () => {
    const SMOOTH_TOLERANCE = 2
    const MAX_MOVED_EDGES = 4
    const qualitative = new Set(legacy.qualitative)

    test('every legacy ramp is bundled', () => {
        for (const name of Object.keys(legacy.ramps)) {
            expect(getStandardColormapTable(name), name).not.toBeNull()
        }
    })

    test.each(Object.keys(legacy.ramps))('%s', (name) => {
        const lut = buildColormapLUT(name)
        const moved = []
        for (let i = 0; i < 256; i++) {
            const now = lutColour(lut, i)
            const before = legacyColour(name, i)
            expect(now[3]).toBe(255)
            if (channelDifference(now, before) <= SMOOTH_TOLERANCE) continue
            moved.push(i)
            expect(qualitative.has(name), `${name}[${i}] ${now} vs ${before}`).toBe(true)
            const neighbours = [i - 1, i + 1]
                .filter((j) => j >= 0 && j < 256)
                .map((j) => lutColour(lut, j))
            expect(
                neighbours.some((n) => channelDifference(n, before) <= SMOOTH_TOLERANCE),
                `${name}[${i}] is not a moved step edge`
            ).toBe(true)
        }
        expect(moved.length).toBeLessThanOrEqual(MAX_MOVED_EDGES)
    })
})
