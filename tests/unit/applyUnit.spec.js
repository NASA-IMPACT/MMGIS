import { describe, it, expect } from 'vitest'
import { applyUnit, unapplyUnit } from '../../src/essence/Tools/_shared/units/applyUnit'

const mg = { scale: 0.001, offset: 0 }
const celsius = { scale: 1, offset: -273.15 }

describe('applyUnit / unapplyUnit', () => {
    it('maps a value into the shown unit and back exactly', () => {
        expect(applyUnit(18, mg)).toBe(0.018)
        expect(unapplyUnit(0.02, mg)).toBe(20)
        expect(unapplyUnit(applyUnit(330, mg), mg)).toBe(330)
        expect(applyUnit(273.15, celsius)).toBe(0)
        expect(unapplyUnit(applyUnit(300, celsius), celsius)).toBe(300)
    })
    it('passes non-numbers, non-finite values and a missing map through', () => {
        expect(applyUnit(null, mg)).toBeNull()
        expect(applyUnit('n/a', mg)).toBe('n/a')
        expect(applyUnit(NaN, mg)).toBeNaN()
        expect(applyUnit(5, null)).toBe(5)
        expect(unapplyUnit(5, undefined)).toBe(5)
    })
})
