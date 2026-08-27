import { test, expect } from 'vitest'
import {
    compileLegendStyle,
    resolveLegendStyle,
} from '../../src/essence/Basics/Layers_/LegendStyle.ts'

/**
 * These pin the legend styling behaviour that shipped inside
 * `constructVectorLayer`'s Leaflet-only style closure, so that lifting it into
 * a shared module (issue #345) cannot quietly change what existing maps draw.
 */

const ramp = (overrides = {}) => [
    {
        styleMatching: true,
        propertyName: 'co2',
        propertyValue: '400',
        shape: 'continuous',
        color: '#000000',
        ...overrides,
    },
    {
        styleMatching: true,
        propertyName: 'co2',
        propertyValue: '440',
        shape: 'continuous',
        color: '#ffffff',
        ...overrides,
    },
]

const resolve = (legend, properties) =>
    resolveLegendStyle(compileLegendStyle(legend), properties)

test.describe('LegendStyle', () => {
    test.describe('compileLegendStyle', () => {
        test('returns null for a missing or non-array legend', () => {
            expect(compileLegendStyle(undefined)).toBe(null)
            expect(compileLegendStyle(null)).toBe(null)
            expect(compileLegendStyle('not a legend')).toBe(null)
        })

        test('returns null when no entry opts into style matching', () => {
            expect(
                compileLegendStyle([
                    { propertyName: 'co2', propertyValue: '400', color: '#f00' },
                    { styleMatching: true, color: '#0f0' },
                ])
            ).toBe(null)
        })

        test('compiles style-matching entries grouped by property', () => {
            const compiled = compileLegendStyle(ramp())
            expect(compiled).toHaveLength(1)
            expect(compiled[0].propertyName).toBe('co2')
            expect(compiled[0].ramp.minValue).toBe(400)
            expect(compiled[0].ramp.maxValue).toBe(440)
        })
    })

    test.describe('continuous ramps', () => {
        test('interpolates a numeric property between two stops', () => {
            expect(resolve(ramp(), { co2: 420 })).toEqual({
                fillColor: 'rgb(128, 128, 128)',
                color: 'rgb(128, 128, 128)',
            })
        })

        test('returns the boundary colours exactly at each end', () => {
            expect(resolve(ramp(), { co2: 400 }).fillColor).toBe('#000000')
            expect(resolve(ramp(), { co2: 440 }).fillColor).toBe('#ffffff')
        })

        test('clamps a value below the lowest stop to the lowest colour', () => {
            expect(resolve(ramp(), { co2: 100 }).fillColor).toBe('#000000')
        })

        test('clamps a value above the highest stop to the highest colour', () => {
            expect(resolve(ramp(), { co2: 9000 }).fillColor).toBe('#ffffff')
        })

        test('interpolates across more than two stops', () => {
            const legend = [
                {
                    styleMatching: true,
                    propertyName: 'v',
                    propertyValue: '0',
                    shape: 'continuous',
                    color: '#000000',
                },
                {
                    styleMatching: true,
                    propertyName: 'v',
                    propertyValue: '50',
                    shape: 'continuous',
                    color: '#ff0000',
                },
                {
                    styleMatching: true,
                    propertyName: 'v',
                    propertyValue: '100',
                    shape: 'continuous',
                    color: '#ffffff',
                },
            ]
            expect(resolve(legend, { v: 25 }).fillColor).toBe('rgb(128, 0, 0)')
            expect(resolve(legend, { v: 75 }).fillColor).toBe(
                'rgb(255, 128, 128)'
            )
        })

        test('sorts stops by numeric value regardless of legend order', () => {
            const reversed = [ramp()[1], ramp()[0]]
            expect(resolve(reversed, { co2: 400 }).fillColor).toBe('#000000')
            expect(resolve(reversed, { co2: 440 }).fillColor).toBe('#ffffff')
        })

        test('falls back to the entry colour for the stroke ramp', () => {
            // A legend authored with fill colours alone still ramps the border.
            expect(resolve(ramp(), { co2: 420 }).color).toBe(
                'rgb(128, 128, 128)'
            )
        })

        test('prefers strokecolor over color for the stroke ramp', () => {
            const legend = ramp()
            legend[0].strokecolor = '#ff0000'
            legend[1].strokecolor = '#00ff00'
            const result = resolve(legend, { co2: 420 })
            expect(result.color).toBe('rgb(128, 128, 0)')
            expect(result.fillColor).toBe('rgb(128, 128, 128)')
        })

        test('needs two stops: a single continuous entry styles nothing', () => {
            const legend = [ramp()[0]]
            expect(resolve(legend, { co2: 420 })).toBe(null)
            // Not even its own value: continuous entries are excluded from
            // exact matching, so a one-stop ramp is inert.
            expect(resolve(legend, { co2: 400 })).toBe(null)
        })

        test('holds a single colour when only one stop carries a colour', () => {
            const legend = ramp()
            delete legend[1].color
            expect(resolve(legend, { co2: 440 }).fillColor).toBe('#000000')
        })

        test('takes the low colour when every stop shares one value', () => {
            const legend = ramp()
            legend[1].propertyValue = '400'
            expect(resolve(legend, { co2: 400 }).fillColor).toBe('#000000')
        })

        test('ignores continuous entries whose value is not a number', () => {
            const legend = ramp()
            legend[1].propertyValue = 'high'
            expect(resolve(legend, { co2: 420 })).toBe(null)
        })
    })

    test.describe('fallbacks', () => {
        test('returns null when the feature lacks the property', () => {
            expect(resolve(ramp(), { other: 420 })).toBe(null)
        })

        test('returns null when the property is non-numeric', () => {
            expect(resolve(ramp(), { co2: 'high' })).toBe(null)
            expect(resolve(ramp(), { co2: null })).toBe(null)
        })

        test('returns null for absent properties', () => {
            expect(resolve(ramp(), null)).toBe(null)
            expect(resolve(ramp(), undefined)).toBe(null)
        })
    })

    test.describe('discrete exact matching', () => {
        const discrete = [
            {
                styleMatching: true,
                propertyName: 'kind',
                propertyValue: 'station',
                color: '#ff0000',
                strokecolor: '#0000ff',
            },
            {
                styleMatching: true,
                propertyName: 'kind',
                propertyValue: 'buoy',
                color: '#00ff00',
            },
        ]

        test('matches a string value', () => {
            expect(resolve(discrete, { kind: 'station' })).toEqual({
                fillColor: '#ff0000',
                color: '#0000ff',
            })
        })

        test('uses the fill colour as the stroke when strokecolor is absent', () => {
            expect(resolve(discrete, { kind: 'buoy' })).toEqual({
                fillColor: '#00ff00',
                color: '#00ff00',
            })
        })

        test('matches a numeric value against a string propertyValue', () => {
            const legend = [
                {
                    styleMatching: true,
                    propertyName: 'grade',
                    propertyValue: '3',
                    color: '#123456',
                },
            ]
            expect(resolve(legend, { grade: 3 }).fillColor).toBe('#123456')
            expect(resolve(legend, { grade: 4 })).toBe(null)
        })

        test('matches a boolean value against "true"/"false"', () => {
            const legend = [
                {
                    styleMatching: true,
                    propertyName: 'active',
                    propertyValue: 'true',
                    color: '#00ff00',
                },
                {
                    styleMatching: true,
                    propertyName: 'active',
                    propertyValue: 'false',
                    color: '#ff0000',
                },
            ]
            expect(resolve(legend, { active: true }).fillColor).toBe('#00ff00')
            expect(resolve(legend, { active: false }).fillColor).toBe('#ff0000')
        })

        test('never applies discrete entries flagged continuous', () => {
            const legend = [
                {
                    styleMatching: true,
                    propertyName: 'kind',
                    propertyValue: 'station',
                    shape: 'continuous',
                    color: '#ff0000',
                },
            ]
            expect(resolve(legend, { kind: 'station' })).toBe(null)
        })
    })

    test.describe('multiple legend properties', () => {
        const legend = [
            ...ramp(),
            {
                styleMatching: true,
                propertyName: 'kind',
                propertyValue: 'buoy',
                color: '#00ff00',
            },
        ]

        test('stops at the first property that styles the feature', () => {
            // The live co2 ramp owns the feature; the kind entry is not read.
            expect(resolve(legend, { co2: 400, kind: 'buoy' }).fillColor).toBe(
                '#000000'
            )
        })

        test('moves on when the first property does not apply', () => {
            expect(
                resolve(legend, { co2: 'unknown', kind: 'buoy' }).fillColor
            ).toBe('#00ff00')
        })
    })

    test.describe('purity', () => {
        test('resolves each feature independently, with no carry-over', () => {
            const compiled = compileLegendStyle(ramp())
            const matched = resolveLegendStyle(compiled, { co2: 440 })
            const unmatched = resolveLegendStyle(compiled, { co2: 'n/a' })
            expect(matched.fillColor).toBe('#ffffff')
            // Previously the matched feature's colour was written to a shared
            // slot and leaked into every later feature that matched nothing.
            expect(unmatched).toBe(null)
        })

        test('does not mutate the legend it is given', () => {
            const legend = ramp()
            const snapshot = JSON.parse(JSON.stringify(legend))
            resolve(legend, { co2: 420 })
            expect(legend).toEqual(snapshot)
        })
    })
})
