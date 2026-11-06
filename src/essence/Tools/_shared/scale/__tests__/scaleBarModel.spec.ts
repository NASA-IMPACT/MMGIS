import { describe, test, expect } from 'vitest'
import {
    buildScaleBarModel,
    niceScaleDistance,
    resolveScaleUnits,
    type ScaleBarModel,
} from '../scaleBarModel'

const FEET_PER_METER = 3.280839895
const METERS_PER = { m: 1, km: 1000, ft: 1 / FEET_PER_METER, mi: 5280 / FEET_PER_METER }
const scaleBarDistanceMeters = (model: ScaleBarModel) =>
    model.distance * METERS_PER[model.unit]

describe('niceScaleDistance', () => {
    test.each([
        [7, 5],
        [23, 20],
        [150, 100],
        [999, 500],
        [1, 1],
        [5, 5],
        [10, 10],
        [0.37, 0.2],
        [0.0123, 0.01],
    ])('%s rounds down to %s', (max, nice) => {
        expect(niceScaleDistance(max)).toBe(nice)
    })
})

describe('buildScaleBarModel', () => {
    test('metric stays in metres below a kilometre', () => {
        expect(buildScaleBarModel(1, 'metric', 150)).toEqual({
            distance: 100,
            unit: 'm',
            label: '100 m',
            widthPx: 100,
        })
        expect(buildScaleBarModel(0.004, 'metric', 150)).toMatchObject({
            distance: 0.5,
            unit: 'm',
            label: '0.5 m',
        })
    })

    test('metric switches to kilometres at 1000 m', () => {
        expect(buildScaleBarModel(10, 'metric', 150)).toEqual({
            distance: 1,
            unit: 'km',
            label: '1 km',
            widthPx: 100,
        })
        expect(buildScaleBarModel(1000 / 150, 'metric', 150)).toMatchObject({
            unit: 'km',
            distance: 1,
        })
    })

    test('imperial uses feet below a mile', () => {
        // 150 m is 492 ft, which rounds down to 200 ft.
        expect(buildScaleBarModel(1, 'imperial', 150)).toMatchObject({
            distance: 200,
            unit: 'ft',
            label: '200 ft',
        })
    })

    test('imperial switches to miles at 5280 ft', () => {
        // 3000 m is 9842.5 ft, 1.86 mi, which rounds down to 1 mi.
        const model = buildScaleBarModel(20, 'imperial', 150)!
        expect(model).toMatchObject({ distance: 1, unit: 'mi', label: '1 mi' })
        expect(model.widthPx).toBeCloseTo(80.467, 2)
        const oneMileMeters = 5280 / 3.280839895
        expect(
            buildScaleBarModel(oneMileMeters / 150, 'imperial', 150),
        ).toMatchObject({ distance: 1, unit: 'mi' })
    })

    test('continental distances get thousands separators', () => {
        expect(buildScaleBarModel(40000, 'metric', 150)!.label).toBe('5,000 km')
    })

    // The property every caller relies on: the drawn length, times the
    // ground distance per pixel, is the distance the label names.
    test.each(['metric', 'imperial'] as const)(
        '%s bar length matches its label across zoom levels',
        (units) => {
            for (let exp = -3; exp <= 5; exp += 0.25) {
                const mpp = Math.pow(10, exp)
                const model = buildScaleBarModel(mpp, units, 150)!
                expect(model.widthPx).toBeLessThanOrEqual(150 + 1e-9)
                expect(model.widthPx).toBeGreaterThan(150 / 5 - 1e-9)
                expect(
                    Math.abs(model.widthPx * mpp - scaleBarDistanceMeters(model)) /
                        scaleBarDistanceMeters(model),
                ).toBeLessThan(1e-9)
            }
        },
    )

    test.each([0, -1, NaN, Infinity, undefined, null])(
        'an unknown scale (%s) draws nothing',
        (mpp) => {
            expect(buildScaleBarModel(mpp as number, 'metric', 150)).toBeNull()
        },
    )

    test('a zero-width bar draws nothing', () => {
        expect(buildScaleBarModel(1, 'metric', 0)).toBeNull()
    })
})

describe('resolveScaleUnits', () => {
    test('only "imperial" selects imperial', () => {
        expect(resolveScaleUnits('imperial')).toBe('imperial')
        for (const v of [undefined, 'metric', 'Imperial', 0, '', null]) {
            expect(resolveScaleUnits(v)).toBe('metric')
        }
    })
})
