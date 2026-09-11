import { test, expect } from 'vitest'
import { buildFeatureClickPayload } from '../../src/essence/Basics/Map_/featureClickPayload.js'

const clickEvent = {
    latlng: { lat: 34.2, lng: -118.1 },
    containerPoint: { x: 120, y: 340 },
}

test.describe('buildFeatureClickPayload', () => {
    test('returns null without a feature', () => {
        expect(buildFeatureClickPayload(null, 'uuid-1', clickEvent)).toBeNull()
        expect(
            buildFeatureClickPayload(undefined, 'uuid-1', clickEvent)
        ).toBeNull()
    })

    test('maps a full click to the payload shape', () => {
        const feature = {
            type: 'Feature',
            properties: { name: 'station-a' },
            geometry: { type: 'Point', coordinates: [-118.1, 34.2] },
        }
        expect(buildFeatureClickPayload(feature, 'uuid-1', clickEvent)).toEqual(
            {
                feature,
                layerName: 'uuid-1',
                latlng: { lat: 34.2, lng: -118.1 },
                pixel: { x: 120, y: 340 },
            }
        )
    })

    test('copies the feature and its properties', () => {
        const feature = {
            type: 'Feature',
            properties: { name: 'station-a' },
            geometry: {},
        }
        const payload = buildFeatureClickPayload(feature, 'uuid-1', clickEvent)
        expect(payload.feature).not.toBe(feature)
        expect(payload.feature.properties).not.toBe(feature.properties)

        feature.properties.appendedLater = true
        expect(payload.feature.properties.appendedLater).toBeUndefined()

        payload.feature.properties.name = 'mutated-by-consumer'
        expect(feature.properties.name).toBe('station-a')
    })

    test('preserves a non-enumerable lazy geometry getter', () => {
        const feature = { type: 'Feature', properties: {} }
        Object.defineProperty(feature, 'geometry', {
            enumerable: false,
            get: () => ({ type: 'Point', coordinates: [10, 20] }),
        })
        const payload = buildFeatureClickPayload(feature, 'uuid-1', clickEvent)
        expect(payload.feature.geometry).toEqual({
            type: 'Point',
            coordinates: [10, 20],
        })
    })

    test('nulls latlng and pixel when the event lacks them', () => {
        const feature = { type: 'Feature', properties: {} }
        expect(buildFeatureClickPayload(feature, 'uuid-1', null)).toEqual({
            feature,
            layerName: 'uuid-1',
            latlng: null,
            pixel: null,
        })
        expect(
            buildFeatureClickPayload(feature, 'uuid-1', { latlng: null })
        ).toMatchObject({ latlng: null, pixel: null })
    })

    test('keeps zero-valued coordinates and pixels', () => {
        const feature = { type: 'Feature', properties: {} }
        const payload = buildFeatureClickPayload(feature, 'uuid-1', {
            latlng: { lat: 0, lng: 0 },
            containerPoint: { x: 0, y: 0 },
        })
        expect(payload.latlng).toEqual({ lat: 0, lng: 0 })
        expect(payload.pixel).toEqual({ x: 0, y: 0 })
    })

    test('passes layerName through and nulls it when absent', () => {
        const feature = { type: 'Feature', properties: {} }
        expect(
            buildFeatureClickPayload(feature, 'uuid-1', clickEvent).layerName
        ).toBe('uuid-1')
        expect(
            buildFeatureClickPayload(feature, null, clickEvent).layerName
        ).toBeNull()
    })
})
