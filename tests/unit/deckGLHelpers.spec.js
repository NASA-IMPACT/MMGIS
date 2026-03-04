import { test, expect } from '@playwright/test'
import {
    resolveLatLng,
    resolveBounds,
    resolvePoint,
    resolvePadding,
    resolveLayerId,
    pickInfoToResult,
    buildDeckLayer,
} from '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts'

test.describe('DeckGLHelpers', () => {
    test.describe('resolveLatLng', () => {
        test('accepts [lat, lng] tuple', () => {
            expect(resolveLatLng([40, -120])).toEqual({ lat: 40, lng: -120 })
        })

        test('accepts {lat, lng} object', () => {
            expect(resolveLatLng({ lat: 40, lng: -120 })).toEqual({ lat: 40, lng: -120 })
        })
    })

    test.describe('resolveBounds', () => {
        test('accepts [[sw], [ne]] tuple and converts to [[lng, lat], [lng, lat]]', () => {
            const result = resolveBounds([[10, -20], [30, -10]])
            expect(result).toEqual([[-20, 10], [-10, 30]])
        })

        test('accepts {southWest, northEast} object', () => {
            const result = resolveBounds({
                southWest: { lat: 10, lng: -20 },
                northEast: { lat: 30, lng: -10 },
            })
            expect(result).toEqual([[-20, 10], [-10, 30]])
        })
    })

    test.describe('resolvePoint', () => {
        test('accepts [x, y] tuple', () => {
            expect(resolvePoint([100, 200])).toEqual({ x: 100, y: 200 })
        })

        test('accepts {x, y} object', () => {
            expect(resolvePoint({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 })
        })
    })

    test.describe('resolvePadding', () => {
        test('returns 0 when undefined', () => {
            expect(resolvePadding(undefined)).toBe(0)
        })

        test('passes through a number', () => {
            expect(resolvePadding(20)).toBe(20)
        })

        test('converts [top, right, bottom, left] array to object', () => {
            expect(resolvePadding([10, 20, 30, 40])).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
        })

        test('passes through an object unchanged', () => {
            const pad = { top: 5, right: 10, bottom: 15, left: 20 }
            expect(resolvePadding(pad)).toEqual(pad)
        })
    })

    test.describe('resolveLayerId', () => {
        test('returns a string id as-is', () => {
            expect(resolveLayerId('my-layer')).toBe('my-layer')
        })

        test('extracts id from a layer object', () => {
            expect(resolveLayerId({ id: 'tile-layer-1' })).toBe('tile-layer-1')
        })
    })

    test.describe('pickInfoToResult', () => {
        test('returns {feature: null} when not picked', () => {
            expect(pickInfoToResult({ picked: false })).toEqual({ feature: null })
        })

        test('maps a picked PickingInfo to FeaturePickResult', () => {
            const info = {
                picked: true,
                coordinate: [-120, 40],
                object: { type: 'Feature', properties: { name: 'test' } },
                layer: { id: 'my-layer' },
                x: 100,
                y: 200,
            }
            const result = pickInfoToResult(info)
            expect(result.latlng).toEqual({ lat: 40, lng: -120 })
            expect(result.layerId).toBe('my-layer')
            expect(result.pixel).toEqual({ x: 100, y: 200 })
            expect(result.feature).toEqual(info.object)
        })

        test('handles missing layer id', () => {
            const info = {
                picked: true,
                coordinate: [0, 0],
                object: {},
                x: 0,
                y: 0,
            }
            const result = pickInfoToResult(info)
            expect(result.layerId).toBeUndefined()
        })
    })

    test.describe('buildDeckLayer', () => {
        test('throws for unsupported layer type', () => {
            expect(() => buildDeckLayer('id', { type: 'unsupported' })).toThrow(
                'buildDeckLayer: unsupported layer type "unsupported"'
            )
        })
    })
})
