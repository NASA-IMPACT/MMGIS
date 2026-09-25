import { describe, test, expect } from 'vitest'
import {
    inspectCollection,
    generateLayer,
} from '../../scripts/lib/vedaStacFetch'

const RASTER = 'https://dev.disasters.openveda.cloud/api/raster'

const NBR_RENDERS = {
    nbr: {
        assets: ['nbr'],
        nodata: -9999,
        rescale: [[-1, 1]],
        colormap_name: 'gray',
    },
    dashboard: {
        assets: ['nbr'],
        nodata: -9999,
        rescale: [[-1, 1]],
        colormap_name: 'gray',
    },
}

const TRUECOLOR_RENDER = { bidx: [1, 2, 3], assets: ['truecolor'], nodata: 0 }

const GRAY_COLORMAP = (() => {
    const def = {}
    for (let i = 0; i <= 255; i++) def[String(i)] = [i, i, i, 255]
    return def
})()

function ongoingCollection(over = {}) {
    return {
        id: 'sentinel2-nbr-daily',
        title: 'Sentinel-2 NBR',
        'dashboard:time_interval': 'P1D',
        'dashboard:is_periodic': false,
        extent: {
            spatial: { bbox: [[-119.17, 33.32, -117.94, 34.34]] },
            temporal: { interval: [['2024-12-18 00:00:00+00', null]] },
        },
        renders: NBR_RENDERS,
        ...over,
    }
}

/** Routes matched in order; unmatched URLs 404. */
const fakeApi = (routes) => async (url) => {
    for (const [match, body] of routes) {
        if (url.includes(match)) return { ok: true, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
}

describe('vedaStacFetch orchestration (fake fetch)', () => {
    test('inspectCollection reports renders, temporal facts, and preselections', async () => {
        const facts = await inspectCollection('sentinel2-nbr-daily', {
            stac: 'https://x/api/stac',
            fetchImpl: fakeApi([
                ['/collections/sentinel2-nbr-daily', ongoingCollection()],
            ]),
        })
        expect(facts.title).toBe('Sentinel-2 NBR')
        expect(facts.renders.map((r) => r.key)).toEqual(['nbr', 'dashboard'])
        expect(facts.defaultRender).toBe('dashboard')
        expect(facts.temporal).toEqual({
            start: '2024-12-18T00:00:00Z',
            end: null,
        })
        expect(facts.interval).toBe('P1D')
        expect(facts.isPeriodic).toBe(false)
        expect(facts.suggestedTimeMode).toBe('time')
        expect(facts.hasBbox).toBe(true)
    })

    test('inspectCollection surfaces an unknown collection as a rejection', async () => {
        await expect(
            inspectCollection('nope', {
                stac: 'https://x/api/stac',
                fetchImpl: fakeApi([]),
            }),
        ).rejects.toThrow(/HTTP 404/)
    })

    test('generateLayer: collection fetch plus the colormap, then maps', async () => {
        const warnings = []
        const layer = await generateLayer(
            'sentinel2-nbr-daily',
            {
                stac: 'https://x/api/stac',
                raster: RASTER,
                fetchImpl: fakeApi([
                    ['/colorMaps/gray', GRAY_COLORMAP],
                    ['/collections/sentinel2-nbr-daily', ongoingCollection()],
                ]),
            },
            (w) => warnings.push(w),
        )
        expect(warnings).toEqual([])
        expect(layer.time.dataEndTime).toBe('now')
        expect(layer.time.interval).toBe('P1D')
        expect(layer.variables.legend).toHaveLength(11)
        expect(layer.url).toContain('datetime={starttime}/{endtime}')
    })

    test('generateLayer: the dialog choices (render, timeMode) pass through', async () => {
        const layer = await generateLayer(
            'sentinel2-nbr-daily',
            {
                stac: 'https://x/api/stac',
                raster: RASTER,
                render: 'truecolor',
                timeMode: 'static',
                fetchImpl: fakeApi([
                    [
                        '/collections/sentinel2-nbr-daily',
                        ongoingCollection({
                            renders: {
                                dashboard: NBR_RENDERS.dashboard,
                                truecolor: TRUECOLOR_RENDER,
                            },
                        }),
                    ],
                ]),
            },
            () => {},
        )
        expect(layer.url).toContain('assets=truecolor')
        expect(layer.url).not.toContain('datetime')
        expect(layer.time).toEqual({ enabled: false })
    })

    test('an unreachable colormap degrades to a warning, not a failure', async () => {
        const warnings = []
        const layer = await generateLayer(
            'sentinel2-nbr-daily',
            {
                stac: 'https://x/api/stac',
                raster: RASTER,
                fetchImpl: fakeApi([
                    ['/collections/sentinel2-nbr-daily', ongoingCollection()],
                ]),
            },
            (w) => warnings.push(w),
        )
        expect(layer.url).toContain('colormap_name=gray')
        expect(layer.variables.legend).toBeUndefined()
        expect(warnings.some((w) => w.includes("colormap 'gray'"))).toBe(true)
    })

    test('a chosen render without a colormap skips the colormap fetch entirely', async () => {
        const urls = []
        const spyFetch = async (url) => {
            urls.push(url)
            return {
                ok: true,
                json: async () =>
                    ongoingCollection({
                        renders: { dashboard: TRUECOLOR_RENDER },
                    }),
            }
        }
        await generateLayer(
            'sentinel2-nbr-daily',
            { stac: 'https://x/api/stac', raster: RASTER, fetchImpl: spyFetch },
            () => {},
        )
        expect(urls).toHaveLength(1)
        expect(urls[0]).toContain('/collections/sentinel2-nbr-daily')
    })
})
