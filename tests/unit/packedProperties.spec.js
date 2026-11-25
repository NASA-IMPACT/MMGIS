import { describe, test, expect } from 'vitest'
import { unpackFeatureProperties } from '../../src/essence/Basics/Layers_/packedProperties.ts'

/**
 * Geodataset vector tiles pack each feature's properties into one JSON string
 * attribute, which every renderer unpacks before reading a property by name.
 */
describe('unpackFeatureProperties', () => {
    test('unpacks a packed JSON object, replacing the packed form', () => {
        expect(
            unpackFeatureProperties({ id: 7, properties: '{"frp":12,"name":"a"}' })
        ).toEqual({ frp: 12, name: 'a' })
    })

    test('hands back properties that are not packed', () => {
        const plain = { frp: 12 }
        expect(unpackFeatureProperties(plain)).toBe(plain)
        const nested = { properties: { frp: 12 } }
        expect(unpackFeatureProperties(nested)).toBe(nested)
    })

    test('hands back a packed string that is not a JSON object', () => {
        for (const packed of ['not json', '[1,2]', 'null', '12']) {
            const properties = { properties: packed }
            expect(unpackFeatureProperties(properties)).toBe(properties)
        }
    })

    test('passes absent properties through', () => {
        expect(unpackFeatureProperties(null)).toBe(null)
        expect(unpackFeatureProperties(undefined)).toBe(undefined)
    })

    test('unpacks a feature once however often it is asked', () => {
        const properties = { properties: '{"frp":12}' }
        expect(unpackFeatureProperties(properties)).toBe(
            unpackFeatureProperties(properties)
        )
    })
})
