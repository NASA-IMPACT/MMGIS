import { describe, it, expect } from 'vitest'
import {
    resolveLayerUnit,
    activeUnit,
    toDisplay,
    toSource,
    sameUnit,
} from '../../src/essence/Basics/Layers_/units/units'

const pm25 = {
    variables: {
        unit: {
            sourceUnit: 'µg/m³',
            displayUnit: 'µg/m³',
            options: [
                { label: 'mg/m³', scale: 0.001 },
                { label: 'ppb', scale: 0.4087 },
            ],
        },
    },
}

const kelvin = {
    variables: {
        unit: {
            sourceUnit: 'K',
            options: [{ label: '°C', scale: 1, offset: -273.15 }],
        },
    },
}

describe('sameUnit', () => {
    it('folds the two micro signs, case and surrounding spaces', () => {
        expect(sameUnit('µg/m³', ' μG/M³ ')).toBe(true)
    })
    it('is false for different labels and for blanks', () => {
        expect(sameUnit('ppb', 'ppm')).toBe(false)
        expect(sameUnit('', '')).toBe(false)
        expect(sameUnit(null, undefined)).toBe(false)
    })
})

describe('resolveLayerUnit', () => {
    it('reads variables.unit as one typed shape', () => {
        expect(resolveLayerUnit(pm25)).toEqual({
            sourceUnit: 'µg/m³',
            displayUnit: 'µg/m³',
            options: [
                { label: 'mg/m³', scale: 0.001 },
                { label: 'ppb', scale: 0.4087 },
            ],
        })
    })
    it('drops options with no label, a zero scale or a non-numeric scale', () => {
        const unit = resolveLayerUnit({
            variables: {
                unit: {
                    sourceUnit: 'm',
                    options: [
                        { label: 'ft', scale: 3.28084 },
                        { label: '', scale: 2 },
                        { label: 'bad', scale: 0 },
                        { label: 'worse', scale: 'x' },
                        null,
                    ],
                },
            },
        })
        expect(unit.options).toEqual([{ label: 'ft', scale: 3.28084 }])
    })
    it('falls back to cogUnits', () => {
        expect(resolveLayerUnit({ cogUnits: 'molec/cm²' })).toEqual({
            sourceUnit: 'molec/cm²',
        })
    })
    it('falls back to the shared trailing text of legend entries', () => {
        const _legend = [
            { shape: 'continuous', value: '1 μg/m³' },
            { shape: 'continuous', value: '18 μg/m³' },
        ]
        expect(resolveLayerUnit({ _legend })).toEqual({ sourceUnit: 'μg/m³' })
    })
    it('ignores hidden legend entries, as the legend itself does', () => {
        const _legend = [
            { shape: 'continuous', value: 'NaN', hideFromLegend: true },
            { shape: 'continuous', value: '1 ppm' },
            { shape: 'continuous', value: '2 ppm' },
        ]
        expect(resolveLayerUnit({ _legend })).toEqual({ sourceUnit: 'ppm' })
    })
    it('prefers the declared unit over the older fields', () => {
        expect(
            resolveLayerUnit({ ...pm25, cogUnits: 'other' }).sourceUnit
        ).toBe('µg/m³')
    })
    it('is null when nothing declares a unit', () => {
        expect(resolveLayerUnit({})).toBeNull()
        expect(resolveLayerUnit(null)).toBeNull()
        expect(resolveLayerUnit({ variables: { unit: { sourceUnit: ' ' } } })).toBeNull()
        expect(
            resolveLayerUnit({
                _legend: [
                    { shape: 'continuous', value: '1 ppm' },
                    { shape: 'continuous', value: '2 ppb' },
                ],
            })
        ).toBeNull()
    })
})

describe('activeUnit', () => {
    it('is the source unit with scale 1 when nothing is picked', () => {
        expect(activeUnit({ cogUnits: 'ppm' })).toEqual({
            sourceUnit: 'ppm',
            label: 'ppm',
            scale: 1,
            offset: 0,
        })
    })
    it('picks the option named by currentUnit', () => {
        expect(activeUnit({ ...pm25, currentUnit: 'mg/m³' })).toEqual({
            sourceUnit: 'µg/m³',
            label: 'mg/m³',
            scale: 0.001,
            offset: 0,
        })
    })
    it('matches currentUnit tolerantly', () => {
        expect(activeUnit({ ...pm25, currentUnit: ' MG/M³ ' }).label).toBe('mg/m³')
    })
    it('falls back to displayUnit, then to the source', () => {
        const withDisplay = {
            variables: { unit: { ...pm25.variables.unit, displayUnit: 'ppb' } },
        }
        expect(activeUnit(withDisplay).label).toBe('ppb')
        expect(activeUnit({ ...withDisplay, currentUnit: 'nope' }).label).toBe('ppb')
        expect(
            activeUnit({
                variables: { unit: { ...pm25.variables.unit, displayUnit: 'nope' } },
            }).label
        ).toBe('µg/m³')
    })
    it('lets currentUnit name the source unit itself', () => {
        expect(activeUnit({ ...pm25, currentUnit: 'µg/m³' }).scale).toBe(1)
    })
    it('is null when the layer resolves to no unit', () => {
        expect(activeUnit({ currentUnit: 'mg/m³' })).toBeNull()
    })
})

describe('toDisplay / toSource', () => {
    const mg = activeUnit({ ...pm25, currentUnit: 'mg/m³' })
    const celsius = activeUnit({ ...kelvin, currentUnit: '°C' })

    it('scales into the picked unit and back exactly', () => {
        expect(toDisplay(330, mg)).toBeCloseTo(0.33, 12)
        expect(toSource(toDisplay(330, mg), mg)).toBe(330)
    })
    it('applies an offset and inverts it', () => {
        expect(toDisplay(273.15, celsius)).toBeCloseTo(0, 12)
        expect(toSource(toDisplay(300, celsius), celsius)).toBeCloseTo(300, 12)
    })
    it('is the identity for the source unit', () => {
        const src = activeUnit(pm25)
        expect(toDisplay(9.7, src)).toBe(9.7)
        expect(toSource(9.7, src)).toBe(9.7)
    })
    it('passes non-numbers and non-finite values through', () => {
        expect(toDisplay(null, mg)).toBeNull()
        expect(toDisplay(undefined, mg)).toBeUndefined()
        expect(toDisplay('n/a', mg)).toBe('n/a')
        expect(toDisplay(NaN, mg)).toBeNaN()
        expect(toDisplay(Infinity, mg)).toBe(Infinity)
        expect(toSource(null, mg)).toBeNull()
    })
    it('passes the value through when there is no unit', () => {
        expect(toDisplay(5, null)).toBe(5)
        expect(toSource(5, undefined)).toBe(5)
    })
})

describe('layerUnitAnswer', () => {
    it('lists the source first and fills every offset', async () => {
        const { layerUnitAnswer } = await import(
            '../../src/essence/Basics/Layers_/units/units'
        )
        expect(layerUnitAnswer({ ...pm25, currentUnit: 'ppb' })).toEqual({
            sourceUnit: 'µg/m³',
            property: null,
            active: { sourceUnit: 'µg/m³', label: 'ppb', scale: 0.4087, offset: 0 },
            options: [
                { label: 'µg/m³', scale: 1, offset: 0 },
                { label: 'mg/m³', scale: 0.001, offset: 0 },
                { label: 'ppb', scale: 0.4087, offset: 0 },
            ],
        })
        expect(layerUnitAnswer({})).toBeNull()
    })
})

describe('layerUnitAnswer property', () => {
    it('names the property declared on the unit, else the one the legend styles by', async () => {
        const { layerUnitAnswer } = await import(
            '../../src/essence/Basics/Layers_/units/units'
        )
        const declared = {
            variables: {
                unit: { sourceUnit: 'ppm', property: 'conc' },
                legend: [{ propertyName: 'other', value: '1 ppm' }],
            },
        }
        expect(layerUnitAnswer(declared).property).toBe('conc')
        const styled = {
            variables: {
                unit: { sourceUnit: 'ppm' },
                legend: [{ propertyName: ' ' }, { propertyName: 'conc' }],
            },
        }
        expect(layerUnitAnswer(styled).property).toBe('conc')
        const processed = {
            cogUnits: 'MW',
            _legend: [{ propertyName: 'frp', value: '1 MW' }],
        }
        expect(layerUnitAnswer(processed).property).toBe('frp')
    })
})
