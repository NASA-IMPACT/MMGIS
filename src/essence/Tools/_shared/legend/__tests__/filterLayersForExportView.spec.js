import { describe, test, expect } from 'vitest'
import {
    boundsIntersect,
    isWithinConfiguredZoomRange,
    filterLayersForExportView,
} from '../filterLayersForExportView.ts'

const baseLayer = (overrides) => ({
    id: 'layer',
    title: 'Layer',
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
    ...overrides,
})

describe('boundsIntersect', () => {
    test('overlapping bounds intersect', () => {
        const viewport = {
            southWest: { lat: -10, lng: -10 },
            northEast: { lat: 10, lng: 10 },
        }
        const layerBounds = [
            [-5, -5],
            [5, 5],
        ]
        expect(boundsIntersect(viewport, layerBounds)).toBe(true)
    })

    test('drops a layer whose bounds provably do not intersect the viewport', () => {
        const viewport = {
            southWest: { lat: -10, lng: -10 },
            northEast: { lat: 10, lng: 10 },
        }
        const layerBounds = [
            [40, 40],
            [50, 50],
        ]
        expect(boundsIntersect(viewport, layerBounds)).toBe(false)
    })

    test('a viewport spanning >= 360 degrees of longitude is treated as whole-world', () => {
        // Repeated panning can push Leaflet's reported bounds well past
        // ±180 (e.g. -214..214); that must read as "everything visible",
        // not get normalized into a deceptively narrow antimeridian band.
        const viewport = {
            southWest: { lat: -10, lng: -214 },
            northEast: { lat: 10, lng: 214 },
        }
        const layerBounds = [
            [0, 170],
            [1, 175],
        ]
        expect(boundsIntersect(viewport, layerBounds)).toBe(true)
    })

    test('a viewport straddling the antimeridian intersects a layer on the far side', () => {
        // Viewport spans 170..200 (i.e. 170 to -160), a layer sits at
        // 175..185 (175 to -175) — they overlap near 180.
        const viewport = {
            southWest: { lat: -5, lng: 170 },
            northEast: { lat: 5, lng: 200 },
        }
        const layerBounds = [
            [-1, 175],
            [1, -175],
        ]
        expect(boundsIntersect(viewport, layerBounds)).toBe(true)
    })

    test('a viewport straddling the antimeridian does not intersect a layer well away from it', () => {
        const viewport = {
            southWest: { lat: -5, lng: 170 },
            northEast: { lat: 5, lng: 200 },
        }
        const layerBounds = [
            [-1, 0],
            [1, 10],
        ]
        expect(boundsIntersect(viewport, layerBounds)).toBe(false)
    })

    test('latitude bounds beyond ±90 are clamped before comparing', () => {
        const viewport = {
            southWest: { lat: -95, lng: -10 },
            northEast: { lat: 95, lng: 10 },
        }
        const layerBounds = [
            [80, -1],
            [100, 1],
        ]
        expect(boundsIntersect(viewport, layerBounds)).toBe(true)
    })
})

describe('isWithinConfiguredZoomRange', () => {
    test('no config at all keeps the layer', () => {
        expect(isWithinConfiguredZoomRange(null, 5)).toBe(true)
        expect(isWithinConfiguredZoomRange(undefined, 5)).toBe(true)
    })

    test('a config with neither minZoom/maxZoom nor visibilitycutoff keeps the layer', () => {
        expect(isWithinConfiguredZoomRange({}, 5)).toBe(true)
    })

    test('minZoom only gates the low side', () => {
        expect(isWithinConfiguredZoomRange({ minZoom: 8 }, 5)).toBe(false)
        expect(isWithinConfiguredZoomRange({ minZoom: 8 }, 8)).toBe(true)
        expect(isWithinConfiguredZoomRange({ minZoom: 8 }, 50)).toBe(true)
    })

    test('an explicit config maxZoom gates the high side', () => {
        expect(isWithinConfiguredZoomRange({ maxZoom: 10 }, 15)).toBe(false)
        expect(isWithinConfiguredZoomRange({ maxZoom: 10 }, 10)).toBe(true)
        expect(isWithinConfiguredZoomRange({ maxZoom: 10 }, 0)).toBe(true)
    })

    test('legacy visibilitycutoff: a positive value sets a minZoom floor', () => {
        expect(
            isWithinConfiguredZoomRange({ visibilitycutoff: 8 }, 5),
        ).toBe(false)
        expect(
            isWithinConfiguredZoomRange({ visibilitycutoff: 8 }, 8),
        ).toBe(true)
        expect(
            isWithinConfiguredZoomRange({ visibilitycutoff: 8 }, 20),
        ).toBe(true)
    })

    test('legacy visibilitycutoff: a negative value becomes maxZoom unchanged (not its absolute value)', () => {
        // Mirrors enforceVisibilityCutoffs's exact arithmetic — a negative
        // visibilitycutoff is assigned straight to maxZoom (not abs()'d)
        // while minZoom still defaults to 0, so no zoom can satisfy both
        // ends at once: the layer reads as never in range.
        expect(
            isWithinConfiguredZoomRange({ visibilitycutoff: -10 }, 15),
        ).toBe(false)
        expect(
            isWithinConfiguredZoomRange({ visibilitycutoff: -10 }, 5),
        ).toBe(false)
        expect(
            isWithinConfiguredZoomRange({ visibilitycutoff: -10 }, -20),
        ).toBe(false)
    })

    test('minZoom/maxZoom presence wins over visibilitycutoff when both are set', () => {
        expect(
            isWithinConfiguredZoomRange(
                { minZoom: 0, maxZoom: 20, visibilitycutoff: -1 },
                15,
            ),
        ).toBe(true)
    })
})

describe('filterLayersForExportView', () => {
    test('drops a layer with opacity 0', () => {
        const layers = [baseLayer({ id: 'a', opacity: 0 })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: null,
            viewportBounds: null,
            zoom: null,
            layerBounds: null,
        })
        expect(result).toEqual([])
    })

    test('keeps everything when every view signal is unavailable', () => {
        const layers = [
            baseLayer({ id: 'a' }),
            baseLayer({ id: 'b', opacity: 0.01 }),
        ]
        const result = filterLayersForExportView(layers, {
            layerConfigs: null,
            viewportBounds: null,
            zoom: null,
            layerBounds: null,
        })
        expect(result).toHaveLength(2)
    })

    test('drops a layer zoomed out of its configured range', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { minZoom: 10 } },
            viewportBounds: null,
            zoom: 5,
            layerBounds: null,
        })
        expect(result).toEqual([])
    })

    test('drops a layer whose bounds are outside the viewport', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: null,
            viewportBounds: {
                southWest: { lat: -10, lng: -10 },
                northEast: { lat: 10, lng: 10 },
            },
            zoom: null,
            layerBounds: {
                a: [
                    [40, 40],
                    [50, 50],
                ],
            },
        })
        expect(result).toEqual([])
    })

    test('a layer with no bounds entry is kept even with a known viewport', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: null,
            viewportBounds: {
                southWest: { lat: -10, lng: -10 },
                northEast: { lat: 10, lng: 10 },
            },
            zoom: null,
            layerBounds: { a: null },
        })
        expect(result).toHaveLength(1)
    })
})
