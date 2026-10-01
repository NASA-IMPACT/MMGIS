import { test, expect } from 'vitest'
import { filteredOutLayers } from '../lib/utils/filteredOut.ts'

test.describe('filteredOutLayers', () => {
    test('returns layers that are on and filtered out of the list', () => {
        const visible = { a: true, b: true, c: false, d: true }
        const listed = { b: false, c: false }
        expect(filteredOutLayers(visible, listed)).toEqual(['b'])
    })

    test('treats a layer absent from the listed map as listed', () => {
        expect(filteredOutLayers({ a: true }, {})).toEqual([])
        expect(filteredOutLayers({ a: true }, { a: true })).toEqual([])
    })

    test('returns nothing when either map is missing', () => {
        expect(filteredOutLayers(null, { a: false })).toEqual([])
        expect(filteredOutLayers({ a: true }, null)).toEqual([])
        expect(filteredOutLayers(undefined, undefined)).toEqual([])
    })
})
