import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { flyToResult } from '../adapters/handlers'
import type { GeocodeResult } from '../lib'

let request: ReturnType<typeof vi.fn>

const kathmandu: GeocodeResult = {
    id: '1',
    displayName: 'Kathmandu, Nepal',
    lat: 27.7,
    lng: 85.3,
    // Nominatim order: [min_lat, max_lat, min_lon, max_lon]
    bbox: [27.6, 27.8, 85.2, 85.4],
}

beforeEach(() => {
    request = vi.fn(async () => null)
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request,
        emit: vi.fn(),
        on: () => () => {},
    }
})

afterEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
})

describe('flyToResult', () => {
    test('fits the map to the result bbox as [[south, west], [north, east]]', () => {
        flyToResult(kathmandu)
        expect(request).toHaveBeenCalledWith('map:fitBounds', [
            [27.6, 85.2],
            [27.8, 85.4],
        ])
    })

    test('draws nothing on the map', () => {
        flyToResult(kathmandu)
        expect(request).toHaveBeenCalledTimes(1)
        expect(request.mock.calls.map(([name]) => name)).not.toContain('map:createLayer')
    })
})
