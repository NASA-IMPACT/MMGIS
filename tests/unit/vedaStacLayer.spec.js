import { describe, test, expect } from 'vitest'
import {
    pickRender,
    resolveBidx,
    resolveRescale,
    temporalExtent,
    suggestTimeMode,
    buildTileUrl,
    buildLegend,
    boundingBoxOf,
    buildLayer,
    VedaStacError,
} from '../../scripts/lib/vedaStacLayer'

const RASTER = 'https://dev.disasters.openveda.cloud/api/raster'

// Recorded from the live dev disasters catalog — the shapes the VEDA/eoAPI
// profile is built against, dashboard:* fields included.
const NBR_RENDERS = {
    nbr: {
        assets: ['nbr'],
        nodata: -9999,
        rescale: [[-1, 1]],
        resampling: 'bilinear',
        colormap_name: 'gray',
    },
    dashboard: {
        assets: ['nbr'],
        nodata: -9999,
        rescale: [[-1, 1]],
        resampling: 'bilinear',
        colormap_name: 'gray',
    },
}

const TRUECOLOR_RENDER = { bidx: [1, 2, 3], assets: ['truecolor'], nodata: 0 }

const GRAY_COLORMAP = (() => {
    const def = {}
    for (let i = 0; i <= 255; i++) def[String(i)] = [i, i, i, 255]
    return def
})()

function nbrCollection(over = {}) {
    return {
        id: 'sentinel2-nbr-daily',
        title: 'Sentinel-2 NBR',
        description: 'Normalized Burn Ratio.',
        'dashboard:time_interval': 'P1D',
        'dashboard:is_periodic': false,
        extent: {
            spatial: { bbox: [[-119.17, 33.32, -117.94, 34.34]] },
            temporal: {
                interval: [['2024-12-18 00:00:00+00', '2025-01-12 23:59:59+00']],
            },
        },
        renders: NBR_RENDERS,
        ...over,
    }
}

/** The live catalogs' way of saying "ongoing": a null interval end. */
function ongoingCollection(over = {}) {
    return nbrCollection({
        extent: {
            spatial: { bbox: [[-119.17, 33.32, -117.94, 34.34]] },
            temporal: { interval: [['2024-12-18 00:00:00+00', null]] },
        },
        ...over,
    })
}

describe('vedaStacLayer mapping', () => {
    describe('pickRender', () => {
        test('prefers the dashboard render (VEDA convention)', () => {
            expect(pickRender(NBR_RENDERS)).toEqual({
                key: 'dashboard',
                render: NBR_RENDERS.dashboard,
            })
        })

        test('falls back to the first render when dashboard is absent', () => {
            expect(pickRender({ truecolor: TRUECOLOR_RENDER })).toEqual({
                key: 'truecolor',
                render: TRUECOLOR_RENDER,
            })
        })

        test('null when the collection has no renders', () => {
            expect(pickRender(undefined)).toBeNull()
            expect(pickRender({})).toBeNull()
        })
    })

    describe('render parameter resolution', () => {
        test('bidx: only declared values, never inferred', () => {
            expect(resolveBidx(TRUECOLOR_RENDER)).toEqual([1, 2, 3])
            expect(resolveBidx(NBR_RENDERS.dashboard)).toBeNull()
        })

        test('rescale: first pair of the per-band list', () => {
            expect(resolveRescale({ rescale: [[-1, 1]] })).toEqual([-1, 1])
            expect(resolveRescale({})).toBeNull()
        })
    })

    describe('temporalExtent / suggestTimeMode', () => {
        test('normalizes pgSTAC datetimes and keeps a null end as null', () => {
            expect(temporalExtent(nbrCollection())).toEqual({
                start: '2024-12-18T00:00:00Z',
                end: '2025-01-12T23:59:59Z',
            })
            expect(temporalExtent(ongoingCollection())).toEqual({
                start: '2024-12-18T00:00:00Z',
                end: null,
            })
            expect(temporalExtent({})).toEqual({ start: null, end: null })
        })

        test('a span or an open end suggests time; an instant or nothing suggests static', () => {
            expect(suggestTimeMode({ start: 'a', end: 'b' })).toBe('time')
            expect(suggestTimeMode({ start: 'a', end: null })).toBe('time')
            expect(suggestTimeMode({ start: 'a', end: 'a' })).toBe('static')
            expect(suggestTimeMode({ start: null, end: null })).toBe('static')
        })
    })

    describe('buildTileUrl', () => {
        test('time-enabled: collection mosaic with {starttime}/{endtime}', () => {
            expect(
                buildTileUrl({
                    rasterRoot: RASTER,
                    collectionId: 'sentinel2-nbr-daily',
                    render: NBR_RENDERS.dashboard,
                    timeEnabled: true,
                }),
            ).toBe(
                `${RASTER}/collections/sentinel2-nbr-daily/tiles/WebMercatorQuad/{z}/{x}/{y}@1x` +
                    '?assets=nbr&rescale=-1,1&colormap_name=gray&resampling=bilinear&nodata=-9999' +
                    '&datetime={starttime}/{endtime}',
            )
        })

        test('static: same mosaic, no datetime filter', () => {
            const url = buildTileUrl({
                rasterRoot: RASTER,
                collectionId: 'gaia-january2025-composite',
                render: TRUECOLOR_RENDER,
                timeEnabled: false,
            })
            expect(url).toBe(
                `${RASTER}/collections/gaia-january2025-composite/tiles/WebMercatorQuad/{z}/{x}/{y}@1x` +
                    '?assets=truecolor&bidx=1&bidx=2&bidx=3&nodata=0',
            )
        })
    })

    describe('buildLegend', () => {
        test('11 continuous stops valued across the rescale range', () => {
            const legend = buildLegend(GRAY_COLORMAP, [-1, 1])
            expect(legend).toHaveLength(11)
            expect(legend[0]).toEqual({ shape: 'continuous', color: '#000000', value: -1 })
            expect(legend[10]).toEqual({ shape: 'continuous', color: '#ffffff', value: 1 })
            expect(legend[5].value).toBe(0)
        })

        test('null for interval colormaps and missing rescale', () => {
            expect(buildLegend([[[0, 128], [255, 0, 0, 255]]], [-1, 1])).toBeNull()
            expect(buildLegend(GRAY_COLORMAP, null)).toBeNull()
        })
    })

    describe('boundingBoxOf', () => {
        test('takes the first spatial bbox and flattens 3D extents', () => {
            expect(boundingBoxOf(nbrCollection())).toEqual([-119.17, 33.32, -117.94, 34.34])
            expect(
                boundingBoxOf({ extent: { spatial: { bbox: [[0, 1, -5, 2, 3, 40]] } } }),
            ).toEqual([0, 1, 2, 3])
            expect(boundingBoxOf({})).toBeNull()
        })
    })

    describe('buildLayer', () => {
        const build = (over = {}) =>
            buildLayer({
                collection: nbrCollection(),
                colormapDef: GRAY_COLORMAP,
                endpoints: { raster: RASTER },
                ...over,
            })

        test('a closed collection maps to a fully dated time block', () => {
            const { layer, warnings } = build()
            expect(warnings).toEqual([])
            expect(layer).toMatchObject({
                name: 'Sentinel-2 NBR',
                type: 'TileLayer',
                tileformat: 'wmts',
                boundingBox: [-119.17, 33.32, -117.94, 34.34],
                time: {
                    enabled: true,
                    type: 'global',
                    format: '%Y-%m-%dT%H:%M:%SZ',
                    start: '2024-12-18T00:00:00Z',
                    dataStartTime: '2024-12-18T00:00:00Z',
                    end: '2025-01-12T23:59:59Z',
                    dataEndTime: '2025-01-12T23:59:59Z',
                    interval: 'P1D',
                    isPeriodic: false,
                },
                properties: { key: 'sentinel2-nbr-daily' },
                description: 'Normalized Burn Ratio.',
            })
            expect(layer.url).toContain('datetime={starttime}/{endtime}')
            expect(layer.variables.legend).toHaveLength(11)
            // The form owns identity and analysis: neither is written here.
            expect(layer.uuid).toBeUndefined()
            expect(layer.variables.analysis).toBeUndefined()
        })

        test('an ongoing collection writes the "now" policy, not a timestamp', () => {
            const { layer } = build({ collection: ongoingCollection() })
            expect(layer.time.end).toBe('now')
            expect(layer.time.dataEndTime).toBe('now')
            expect(layer.time.dataStartTime).toBe('2024-12-18T00:00:00Z')
            expect(layer.time.interval).toBe('P1D')
            expect(layer.time.isPeriodic).toBe(false)
        })

        test('an explicit renderKey wins over the dashboard default', () => {
            const { layer } = build({
                collection: nbrCollection({
                    renders: {
                        dashboard: NBR_RENDERS.dashboard,
                        truecolor: TRUECOLOR_RENDER,
                    },
                }),
                renderKey: 'truecolor',
                colormapDef: null,
            })
            expect(layer.url).toContain('assets=truecolor')
            expect(layer.url).toContain('bidx=1&bidx=2&bidx=3')
        })

        test('an unknown renderKey names the available entries', () => {
            expect(() => build({ renderKey: 'nope' })).toThrow(/has: nbr, dashboard/)
        })

        test('no renders is a named refusal — no guessing', () => {
            expect(() =>
                build({ collection: nbrCollection({ renders: undefined }) }),
            ).toThrow(VedaStacError)
        })

        test('timeMode static overrides the suggestion: no time block, no datetime filter', () => {
            const { layer } = build({ timeMode: 'static' })
            expect(layer.time).toEqual({ enabled: false })
            expect(layer.url).not.toContain('datetime')
        })

        test('timeMode time is honored even on an instant extent', () => {
            const instant = nbrCollection({
                extent: {
                    spatial: { bbox: [[0, 0, 1, 1]] },
                    temporal: {
                        interval: [['2025-01-01 00:00:00+00', '2025-01-01 00:00:00+00']],
                    },
                },
            })
            const { layer } = build({ collection: instant, timeMode: 'time' })
            expect(layer.time.enabled).toBe(true)
            expect(layer.time.dataStartTime).toBe('2025-01-01T00:00:00Z')
            expect(layer.time.dataEndTime).toBe('2025-01-01T00:00:00Z')
        })

        test('an unbuildable legend degrades to a warning, not a failure', () => {
            const { layer, warnings } = build({ colormapDef: null })
            expect(layer.variables.legend).toBeUndefined()
            expect(warnings.some((w) => w.includes("colormap 'gray'"))).toBe(true)
        })

        test('missing spatial extent omits boundingBox with a warning', () => {
            const { layer, warnings } = build({
                collection: nbrCollection({
                    extent: { temporal: nbrCollection().extent.temporal },
                }),
            })
            expect(layer.boundingBox).toBeUndefined()
            expect(warnings.some((w) => w.includes('boundingBox omitted'))).toBe(true)
        })
    })
})
