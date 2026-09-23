import { describe, it, expect, vi, beforeEach } from 'vitest'

const mmgisFitBounds = vi.fn()
const mmgisGetLayerBounds = vi.fn()
const mmgisRequest = vi.fn()

vi.mock('../../_shared/adapters/mmgisAPI', () => ({
    mmgisFitBounds: (...args: unknown[]) => mmgisFitBounds(...args),
    mmgisGetLayerBounds: (...args: unknown[]) => mmgisGetLayerBounds(...args),
    mmgisRequest: (...args: unknown[]) => mmgisRequest(...args),
}))

const {
    fitToMatches,
    readAuthoredView,
    unionBounds,
    boundsFromGeometry,
} = await import('./fitToMatches')

beforeEach(() => {
    mmgisFitBounds.mockReset().mockResolvedValue(true)
    mmgisGetLayerBounds.mockReset().mockResolvedValue(null)
    mmgisRequest.mockReset().mockResolvedValue(true)
})

describe('readAuthoredView', () => {
    it('reads a well-formed view', () => {
        expect(readAuthoredView({ view: { center: [30.3, -97.7], zoom: 9 } })).toEqual({
            center: [30.3, -97.7],
            zoom: 9,
        })
    })

    it('omits zoom when it is absent, rather than inventing one', () => {
        expect(readAuthoredView({ view: { center: [1, 2] } })).toEqual({ center: [1, 2] })
    })

    // A half-applied camera is worse than none: it would move the map
    // somewhere arbitrary and look like a bug in the data.
    it.each([
        ['no view', {}],
        ['center missing', { view: { zoom: 4 } }],
        ['center too short', { view: { center: [1] } }],
        ['center not numeric', { view: { center: ['a', 'b'] } }],
        ['center holds NaN', { view: { center: [Number.NaN, 2] } }],
        ['edge is null', null],
    ])('rejects %s', (_label, edge) => {
        expect(readAuthoredView(edge)).toBeNull()
    })
})

describe('unionBounds', () => {
    it('grows to contain both extents', () => {
        expect(
            unionBounds(
                [
                    [10, -20],
                    [20, -10],
                ],
                [
                    [5, -30],
                    [15, -25],
                ],
            ),
        ).toEqual([
            [5, -30],
            [20, -10],
        ])
    })

    it('passes through when one side is missing', () => {
        const bounds = [
            [1, 2],
            [3, 4],
        ] as [[number, number], [number, number]]
        expect(unionBounds(null, bounds)).toEqual(bounds)
        expect(unionBounds(bounds, null)).toEqual(bounds)
        expect(unionBounds(null, null)).toBeNull()
    })
})

describe('boundsFromGeometry', () => {
    it('handles a Polygon, returning [[s, w], [n, e]] from [lng, lat] input', () => {
        expect(
            boundsFromGeometry({
                type: 'Polygon',
                coordinates: [
                    [
                        [-118.95, 33.7],
                        [-117.65, 33.7],
                        [-117.65, 34.55],
                        [-118.95, 34.55],
                        [-118.95, 33.7],
                    ],
                ],
            }),
        ).toEqual([
            [33.7, -118.95],
            [34.55, -117.65],
        ])
    })

    it('handles a Point as a zero-area extent', () => {
        expect(boundsFromGeometry({ type: 'Point', coordinates: [-97.7, 30.3] })).toEqual([
            [30.3, -97.7],
            [30.3, -97.7],
        ])
    })

    it('handles MultiPolygon nesting', () => {
        expect(
            boundsFromGeometry({
                type: 'MultiPolygon',
                coordinates: [
                    [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                    [[[10, 10], [11, 10], [11, 11], [10, 10]]],
                ],
            }),
        ).toEqual([
            [0, 0],
            [11, 11],
        ])
    })

    it('handles GeometryCollection', () => {
        expect(
            boundsFromGeometry({
                type: 'GeometryCollection',
                geometries: [
                    { type: 'Point', coordinates: [-5, -5] },
                    { type: 'Point', coordinates: [5, 5] },
                ],
            }),
        ).toEqual([
            [-5, -5],
            [5, 5],
        ])
    })

    it.each([
        ['null', null],
        ['no coordinates', { type: 'Polygon' }],
        ['empty coordinates', { type: 'Polygon', coordinates: [] }],
    ])('returns null for %s', (_label, geometry) => {
        expect(boundsFromGeometry(geometry)).toBeNull()
    })
})

describe('fitToMatches', () => {
    it('prefers an authored view over computing an extent', async () => {
        const outcome = await fitToMatches({
            matchedLayerUUIDs: ['a'],
            edgesByLayerUUID: { a: { view: { center: [30.3, -97.7], zoom: 9 } } },
        })

        expect(outcome).toBe('view')
        expect(mmgisRequest).toHaveBeenCalledWith('map:setView', {
            center: [30.3, -97.7],
            zoom: 9,
        })
        expect(mmgisFitBounds).not.toHaveBeenCalled()
    })

    it('fits the union of the matched layers when no view is authored', async () => {
        mmgisGetLayerBounds.mockImplementation(async (uuid: string) =>
            uuid === 'a'
                ? [
                      [10, -20],
                      [20, -10],
                  ]
                : [
                      [5, -30],
                      [15, -25],
                  ],
        )

        const outcome = await fitToMatches({
            matchedLayerUUIDs: ['a', 'b'],
            edgesByLayerUUID: {},
        })

        expect(outcome).toBe('layers')
        expect(mmgisFitBounds).toHaveBeenCalledWith(
            [
                [5, -30],
                [20, -10],
            ],
            expect.objectContaining({ padding: expect.any(Number), maxZoom: expect.any(Number) }),
        )
    })

    // A layer whose extent core cannot work out must not drag the union to
    // null and lose the layers that do have one.
    it('ignores layers with no extent rather than collapsing the union', async () => {
        mmgisGetLayerBounds.mockImplementation(async (uuid: string) =>
            uuid === 'a'
                ? null
                : [
                      [1, 2],
                      [3, 4],
                  ],
        )

        const outcome = await fitToMatches({
            matchedLayerUUIDs: ['a', 'b'],
            edgesByLayerUUID: {},
        })

        expect(outcome).toBe('layers')
        expect(mmgisFitBounds).toHaveBeenCalledWith(
            [
                [1, 2],
                [3, 4],
            ],
            expect.anything(),
        )
    })

    it('falls back to the entry geometry when no layer has an extent', async () => {
        const outcome = await fitToMatches({
            matchedLayerUUIDs: ['a'],
            edgesByLayerUUID: {},
            entryGeometry: {
                type: 'Polygon',
                coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, -1]]],
            },
        })

        expect(outcome).toBe('entry')
        expect(mmgisFitBounds).toHaveBeenCalledWith(
            [
                [-1, -1],
                [1, 1],
            ],
            expect.anything(),
        )
    })

    it('leaves the map alone when nothing resolves', async () => {
        const outcome = await fitToMatches({
            matchedLayerUUIDs: [],
            edgesByLayerUUID: {},
        })

        expect(outcome).toBe('none')
        expect(mmgisFitBounds).not.toHaveBeenCalled()
        expect(mmgisRequest).not.toHaveBeenCalled()
    })

    // Against a core without the handler the request resolves falsey; the
    // caller should keep going rather than reporting a move that never happened.
    it('falls through to bounds when setView is unavailable', async () => {
        mmgisRequest.mockResolvedValue(null)
        mmgisGetLayerBounds.mockResolvedValue([
            [1, 2],
            [3, 4],
        ])

        const outcome = await fitToMatches({
            matchedLayerUUIDs: ['a'],
            edgesByLayerUUID: { a: { view: { center: [0, 0], zoom: 3 } } },
        })

        expect(outcome).toBe('layers')
    })
})
