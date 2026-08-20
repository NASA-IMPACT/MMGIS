import { describe, test, expect, vi } from 'vitest'
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

    test('a layer spanning >= 360 degrees of longitude (a global basemap) is treated as whole-world', () => {
        // Normalizing [-180, 180] the same way a normal interval is
        // normalized collapses it to the single point at the antimeridian
        // (normalizeLng(180) === -180), which would wrongly report "no
        // overlap" against a viewport nowhere near the dateline.
        const viewport = {
            southWest: { lat: 35, lng: 0 },
            northEast: { lat: 60, lng: 40 },
        }
        const layerBounds = [
            [-90, -180],
            [90, 180],
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

    test('drops a vector layer zoomed out of its configured range', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'vector', minZoom: 10 } },
            viewportBounds: null,
            zoom: 5,
            layerBounds: null,
        })
        expect(result).toEqual([])
    })

    // Live repro: a `tile` layer configured maxZoom 8, viewed at zoom 8.6 —
    // core's enforceVisibilityCutoffs only zoom-gates `type === 'vector'`,
    // so a raster keeps painting past its configured maxZoom and the export
    // must not drop its legend row.
    test('does not zoom-gate a non-vector layer, even overzoomed past its configured maxZoom', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'tile', maxZoom: 8 } },
            viewportBounds: null,
            zoom: 8.6,
            layerBounds: null,
        })
        expect(result).toHaveLength(1)
    })

    test('the same maxZoom config zoom-gates a vector layer', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'vector', maxZoom: 8 } },
            viewportBounds: null,
            zoom: 8.6,
            layerBounds: null,
        })
        expect(result).toEqual([])
    })

    test('drops a layer whose bounds are far outside the viewport, even padded (raster path)', () => {
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

    // Live-diagnosed regression: a raster (COG) painted ~40% of its
    // footprint span past its declared bbox, so a viewport just outside the
    // declared box — but well within a generously padded one — had real
    // painted pixels on screen while the row was dropped. A raster-ish
    // (non-vector) layer's footprint is advisory, so it must be padded
    // before testing rather than treated as a hard edge.
    test('keeps a non-vector layer whose declared bbox the viewport just misses but the padded footprint reaches', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'tile' } },
            viewportBounds: {
                southWest: { lat: 1.5, lng: 1.5 },
                northEast: { lat: 2, lng: 2 },
            },
            zoom: null,
            layerBounds: {
                a: [
                    [0, 0],
                    [1, 1],
                ],
            },
        })
        expect(result).toHaveLength(1)
    })

    // Same geometry as above, but on a vector layer: its bounds come from
    // real rendered geometry, so they stay a hard edge — no padding.
    test('drops a vector layer at the same geometry a padded raster would keep', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'vector' } },
            viewportBounds: {
                southWest: { lat: 1.5, lng: 1.5 },
                northEast: { lat: 2, lng: 2 },
            },
            zoom: null,
            layerBounds: {
                a: [
                    [0, 0],
                    [1, 1],
                ],
            },
        })
        expect(result).toEqual([])
    })

    // A footprint with ~zero span (e.g. a point-like layer) still gets the
    // 0.5° minimum pad per side, not 100% of a ~0 span (which would pad by
    // ~0 and behave like no padding at all).
    test('applies the 0.5 degree minimum pad to a footprint with near-zero span', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'tile' } },
            viewportBounds: {
                southWest: { lat: 10.3, lng: 10.3 },
                northEast: { lat: 10.6, lng: 10.6 },
            },
            zoom: null,
            layerBounds: {
                a: [
                    [10, 10],
                    [10, 10],
                ],
            },
        })
        expect(result).toHaveLength(1)
    })

    // Padding a wide-but-not-whole-world footprint can itself push its span
    // past 360°; that reuses boundsIntersect's whole-world guard and keeps
    // the layer regardless of the viewport's longitude.
    test('keeps a non-vector layer whose padded footprint wraps past 360 degrees of longitude', () => {
        const layers = [baseLayer({ id: 'a' })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: { a: { type: 'tile' } },
            viewportBounds: {
                southWest: { lat: -5, lng: 170 },
                northEast: { lat: 5, lng: 175 },
            },
            zoom: null,
            layerBounds: {
                a: [
                    [-5, -100],
                    [5, 100],
                ],
            },
        })
        expect(result).toHaveLength(1)
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

    test('logs the dropped layers when filtering empties a non-empty layer set', () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
        const layers = [baseLayer({ id: 'a', title: 'Only layer', opacity: 0 })]
        const result = filterLayersForExportView(layers, {
            layerConfigs: null,
            viewportBounds: null,
            zoom: null,
            layerBounds: null,
        })
        expect(result).toEqual([])
        expect(infoSpy).toHaveBeenCalledTimes(1)
        expect(infoSpy.mock.calls[0][1]).toEqual(
            expect.arrayContaining([expect.stringContaining('Only layer')]),
        )
        infoSpy.mockRestore()
    })

    test('does not log when nothing was filtered out, or when there was nothing to filter', () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
        filterLayersForExportView([baseLayer({ id: 'a' })], {
            layerConfigs: null,
            viewportBounds: null,
            zoom: null,
            layerBounds: null,
        })
        filterLayersForExportView([], {
            layerConfigs: null,
            viewportBounds: null,
            zoom: null,
            layerBounds: null,
        })
        expect(infoSpy).not.toHaveBeenCalled()
        infoSpy.mockRestore()
    })
})
