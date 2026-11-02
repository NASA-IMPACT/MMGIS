import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    toPointUrl,
    readPointValue,
    fetchPointValue,
    boundsContain,
} from '../../src/essence/Basics/Layers_/layerValueAt'

/**
 * A raster's value at a point is asked of the service that serves its tiles,
 * at a URL deduced from the tile URL. The deduction is a TiTiler-family
 * convention and nothing wider, so what matters here is that every TiTiler
 * shape the dashboards use rewrites cleanly, that anything else is refused,
 * and that both answer shapes read to one number or nothing.
 */

const NAQFC =
    'https://svc.example/tiles/WebMercatorQuad/{z}/{x}/{y}?url=s3://b/o3_conus&url=s3://b/o3_ak&variable=ozcon&sel=reference_time%3Dnearest::2025-01-01T06:00:00&sel=lead%3D1'
const TEMPO =
    'https://host/api/titiler-multidim/tiles/WebMercatorQuad/{z}/{x}/{y}?url=s3://b/no2/&variable=vertical_column_troposphere&sel=time=nearest::2026-08-25T18:00:00Z&algorithm=mean&where=eff_cloud_fraction%3C%3D0.5&tilesize=512'
const VEDA_COLLECTION =
    'https://host/api/raster/collections/nbr/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?assets=nbr&bidx=1&rescale=-1,1&colormap_name=gray&resampling=nearest&nodata=-9999&datetime=2024-12-18T00:00:00Z/2025-01-12T00:00:00Z'
const VEDA_ITEM =
    'https://host/api/raster/collections/c/items/i/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=b1'
const COG =
    'https://titiler.example/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.webp?url=https%3A%2F%2Fdata%2Fa.tif&bidx=1&rescale=0,100&colormap_name=viridis'

describe('toPointUrl', () => {
    test('swaps the tile path for the point path and keeps the query as written', () => {
        expect(toPointUrl(NAQFC, -97.5, 35)).toBe(
            'https://svc.example/point/-97.5,35?url=s3://b/o3_conus&url=s3://b/o3_ak&variable=ozcon&sel=reference_time%3Dnearest::2025-01-01T06:00:00&sel=lead%3D1'
        )
    })

    test('drops tile-only parameters and leaves the rest untouched', () => {
        expect(toPointUrl(TEMPO, -97.5, 35)).toBe(
            'https://host/api/titiler-multidim/point/-97.5,35?url=s3://b/no2/&variable=vertical_column_troposphere&sel=time=nearest::2026-08-25T18:00:00Z&algorithm=mean&where=eff_cloud_fraction%3C%3D0.5'
        )
        expect(toPointUrl(VEDA_COLLECTION, -118.5, 34.2)).toBe(
            'https://host/api/raster/collections/nbr/point/-118.5,34.2?assets=nbr&bidx=1&resampling=nearest&nodata=-9999&datetime=2024-12-18T00:00:00Z/2025-01-12T00:00:00Z'
        )
    })

    test('handles the item, scale-suffix, format-suffix and cog shapes', () => {
        expect(toPointUrl(VEDA_ITEM, 1, 2)).toBe(
            'https://host/api/raster/collections/c/items/i/point/1,2?assets=b1'
        )
        expect(toPointUrl(COG, 1, 2)).toBe(
            'https://titiler.example/cog/point/1,2?url=https%3A%2F%2Fdata%2Fa.tif&bidx=1'
        )
    })

    test('asks TiTiler for a bare GeoTIFF when a base is known, and refuses without one', () => {
        expect(toPointUrl('https://data/a_2025-01-01.tif', -1.5, 2, 'https://titiler.example/')).toBe(
            'https://titiler.example/cog/point/-1.5,2?url=https%3A%2F%2Fdata%2Fa_2025-01-01.tif'
        )
        expect(toPointUrl('https://data/a.tif', 1, 2, null)).toBeNull()
    })

    test('refuses tile URLs of any other shape', () => {
        expect(toPointUrl('https://tile.osm.org/{z}/{x}/{y}.png', 1, 2)).toBeNull()
        expect(
            toPointUrl('https://wms.example/?service=WMS&request=GetMap&layers=a&bbox={bbox}', 1, 2)
        ).toBeNull()
        expect(toPointUrl('https://host/tiles/{z}/{x}/{y}/extra', 1, 2)).toBeNull()
    })
})

describe('readPointValue', () => {
    test('reads a single dataset answer, with the slice the service chose', () => {
        expect(
            readPointValue({
                coordinates: [-97.5, 35],
                values: [2357965151504032],
                band_names: ['b1'],
                band_descriptions: ['2026-08-25T17:40:45.032527616'],
            })
        ).toEqual({ value: 2357965151504032, band: 'b1', asOf: '2026-08-25T17:40:45Z' })
    })

    test('ignores a band description that is not a datetime', () => {
        expect(
            readPointValue({
                values: [27.005],
                band_names: ['b1'],
                band_descriptions: ['[[12.19 12.20 ... 14.33]]'],
            })
        ).toEqual({ value: 27.005, band: 'b1' })
    })

    test('a masked pixel is null, not nothing', () => {
        expect(readPointValue({ values: [null], band_names: ['b1'] })).toEqual({
            value: null,
            band: 'b1',
        })
        expect(readPointValue({ values: [] })).toEqual({ value: null })
    })

    test('reads a mosaic answer from the first item holding a value', () => {
        expect(
            readPointValue({
                coordinates: [-118.5, 34.2],
                values: [
                    ['c/newest', [null], ['nbr_b1']],
                    ['c/older', [0.0556], ['nbr_b1']],
                    ['c/oldest', [0.0031], ['nbr_b1']],
                ],
            })
        ).toEqual({ value: 0.0556, item: 'c/older', band: 'nbr_b1' })
    })

    test('a mosaic with no value anywhere is null', () => {
        expect(readPointValue({ values: [['a', [null], ['b1']]] })).toEqual({ value: null })
    })

    test('anything else is unreadable', () => {
        expect(readPointValue(null)).toBeUndefined()
        expect(readPointValue({ detail: 'Not Found' })).toBeUndefined()
        expect(readPointValue({ values: ['27'] })).toBeUndefined()
    })
})

describe('fetchPointValue', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    const answering = (body, ok = true, status = 200) =>
        vi.fn(async () => ({ ok, status, json: async () => body }))

    test('returns the read answer', async () => {
        const fetchImpl = answering({ values: [27], band_names: ['b1'] })
        expect(await fetchPointValue('https://svc/point/1,2?a=b', { fetchImpl })).toEqual({
            value: 27,
            band: 'b1',
        })
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://svc/point/1,2?a=b',
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        )
    })

    test('a failed, unreadable or throwing request is null, never a rejection', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(
            await fetchPointValue('u', { fetchImpl: answering({ detail: 'x' }, false, 400) })
        ).toBeNull()
        expect(await fetchPointValue('u', { fetchImpl: answering({ detail: 'x' }) })).toBeNull()
        expect(
            await fetchPointValue('u', {
                fetchImpl: vi.fn(async () => {
                    throw new Error('offline')
                }),
            })
        ).toBeNull()
        expect(console.warn).toHaveBeenCalledTimes(3)
    })

    test('a stalled request is abandoned at the deadline', async () => {
        vi.useFakeTimers()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const fetchImpl = vi.fn(
            (url, { signal }) =>
                new Promise((_, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('aborted')))
                })
        )
        const pending = fetchPointValue('u', { fetchImpl, timeoutMs: 50 })
        await vi.advanceTimersByTimeAsync(60)
        expect(await pending).toBeNull()
        expect(console.warn.mock.calls[0][0]).toContain('timed out after 50 ms')
    })
})

describe('boundsContain', () => {
    test('reads [west, south, east, north] and holds the edges', () => {
        expect(boundsContain([-130, 20, -60, 55], -97.5, 35)).toBe(true)
        expect(boundsContain([-130, 20, -60, 55], -60, 55)).toBe(true)
        expect(boundsContain([-130, 20, -60, 55], -150, 35)).toBe(false)
    })

    test('a missing or unreadable box covers everywhere', () => {
        expect(boundsContain(undefined, 0, 0)).toBe(true)
        expect(boundsContain([1, 2], 0, 0)).toBe(true)
        expect(boundsContain(['a', 2, 3, 4], 0, 0)).toBe(true)
    })
})
