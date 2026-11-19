import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    getPaging,
    fetchAllPages,
    fetchJson,
} from '../../src/essence/Basics/Layers_/vectorPaging'

const URL_TEMPLATE =
    'https://example.com/query?where=1%3D1&resultOffset={offset}&resultRecordCount={limit}&f=geojson'

const feature = (id) => ({
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
})

// A service holding `total` features that reads offset/limit from the query,
// capped at `serverCap` per response.
function fakeService(total, serverCap = Infinity) {
    return vi.fn(async (url) => {
        const q = new URL(url).searchParams
        const offset = Number(q.get('resultOffset'))
        const limit = Math.min(Number(q.get('resultRecordCount')), serverCap)
        const features = []
        for (let i = offset; i < Math.min(offset + limit, total); i++)
            features.push(feature(i + 1))
        return { type: 'FeatureCollection', features }
    })
}

describe('getPaging', () => {
    it('reads pageSize and maxPages from layer variables', () => {
        expect(
            getPaging({
                variables: { pagination: { pageSize: 2000, maxPages: 10 } },
            })
        ).toEqual({ pageSize: 2000, maxPages: 10 })
    })

    it('accepts numeric strings', () => {
        expect(
            getPaging({
                variables: { pagination: { pageSize: '500', maxPages: '3' } },
            })
        ).toEqual({ pageSize: 500, maxPages: 3 })
    })

    it('defaults maxPages when only pageSize is set', () => {
        expect(
            getPaging({ variables: { pagination: { pageSize: 100 } } }).maxPages
        ).toBe(50)
    })

    it('is off without a positive pageSize', () => {
        expect(getPaging({})).toBeNull()
        expect(getPaging({ variables: { pagination: {} } })).toBeNull()
        expect(
            getPaging({ variables: { pagination: { pageSize: 0 } } })
        ).toBeNull()
        expect(
            getPaging({ variables: { pagination: { pageSize: 'abc' } } })
        ).toBeNull()
    })
})

describe('fetchAllPages', () => {
    it('gathers every page in order until a short page', async () => {
        const fetchJson = fakeService(26571)
        const { data, complete } = await fetchAllPages(
            URL_TEMPLATE,
            { pageSize: 2000, maxPages: 50 },
            fetchJson
        )
        expect(complete).toBe(true)
        expect(data.features).toHaveLength(26571)
        expect(data.features.map((f) => f.id)).toEqual(
            Array.from({ length: 26571 }, (_, i) => i + 1)
        )
    })

    it('fills {offset} and {limit} on each page', async () => {
        const fetchJson = fakeService(250)
        await fetchAllPages(
            URL_TEMPLATE,
            { pageSize: 100, maxPages: 50 },
            fetchJson
        )
        const urls = fetchJson.mock.calls.map(([u]) => new URL(u).searchParams)
        expect(urls.slice(0, 3).map((q) => q.get('resultOffset'))).toEqual([
            '0',
            '100',
            '200',
        ])
        expect(urls.every((q) => q.get('resultRecordCount') === '100')).toBe(
            true
        )
    })

    it('stops after an empty page when the total is an exact multiple', async () => {
        const fetchJson = fakeService(300)
        const { data, complete } = await fetchAllPages(
            URL_TEMPLATE,
            { pageSize: 100, maxPages: 50 },
            fetchJson
        )
        expect(complete).toBe(true)
        expect(data.features).toHaveLength(300)
    })

    it('reports incomplete when maxPages is reached on a full page', async () => {
        const fetchJson = fakeService(1000)
        const { data, complete } = await fetchAllPages(
            URL_TEMPLATE,
            { pageSize: 100, maxPages: 3 },
            fetchJson
        )
        expect(complete).toBe(false)
        expect(data.features).toHaveLength(300)
        expect(fetchJson).toHaveBeenCalledTimes(3)
    })

    it('rejects when the first page fails', async () => {
        const fetchJson = vi.fn(async () => {
            throw new Error('HTTP 500')
        })
        await expect(
            fetchAllPages(
                URL_TEMPLATE,
                { pageSize: 10, maxPages: 5 },
                fetchJson
            )
        ).rejects.toThrow('HTTP 500')
    })

    it('keeps earlier pages and reports incomplete when a later page fails', async () => {
        const fetchJson = vi.fn(async (url) => {
            const offset = Number(new URL(url).searchParams.get('resultOffset'))
            if (offset > 0) throw new Error('boom')
            return { features: [feature(1), feature(2)] }
        })
        const { data, complete } = await fetchAllPages(
            URL_TEMPLATE,
            { pageSize: 2, maxPages: 5 },
            fetchJson
        )
        expect(complete).toBe(false)
        expect(data.features).toHaveLength(2)
    })

    it('fetches once when the URL has no {offset}', async () => {
        const fetchJson = vi.fn(async () => ({
            features: [feature(1), feature(2)],
        }))
        const { data, complete } = await fetchAllPages(
            'https://example.com/all.geojson?limit={limit}',
            { pageSize: 2, maxPages: 5 },
            fetchJson
        )
        expect(fetchJson).toHaveBeenCalledTimes(1)
        expect(fetchJson.mock.calls[0][0]).toBe(
            'https://example.com/all.geojson?limit=2'
        )
        expect(complete).toBe(false)
        expect(data.features).toHaveLength(2)
    })

    it('fetches once when the URL has {offset} but no {limit}', async () => {
        const fetchJson = vi.fn(async () => ({
            features: [feature(1), feature(2), feature(3)],
        }))
        const { data, complete } = await fetchAllPages(
            'https://example.com/query?resultOffset={offset}',
            { pageSize: 2, maxPages: 5 },
            fetchJson
        )
        expect(fetchJson).toHaveBeenCalledTimes(1)
        expect(fetchJson.mock.calls[0][0]).toBe(
            'https://example.com/query?resultOffset=0'
        )
        expect(complete).toBe(false)
        expect(data.features).toHaveLength(3)
    })
})

// The layer's load error reads `status` to tell an HTTP failure from a
// blocked or lost request.
describe('fetchJson', () => {
    afterEach(() => vi.unstubAllGlobals())

    const respond = (status, body) =>
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(body, { status }))
        )

    it('parses a JSON response', async () => {
        respond(200, '{"features":[]}')
        await expect(fetchJson('https://example.com/a')).resolves.toEqual({
            features: [],
        })
    })

    it('rejects an HTTP error with its status', async () => {
        respond(404, 'not found')
        await expect(fetchJson('https://example.com/a')).rejects.toMatchObject({
            status: 404,
        })
    })

    it('rejects an unparseable body with its status', async () => {
        respond(200, '<html>')
        await expect(fetchJson('https://example.com/a')).rejects.toMatchObject({
            status: 200,
        })
    })

    it('rejects a network failure without a status', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('Failed to fetch')
            })
        )
        const err = await fetchJson('https://example.com/a').catch((e) => e)
        expect(err.status).toBeUndefined()
    })
})
