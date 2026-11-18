import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    fetchColormapList,
    fetchColormapTable,
    peekColormapTable,
    clearColormapCache,
} from '../../src/essence/Basics/Colormaps/titilerColormaps'
import { colormapTableToCss } from '../../src/essence/Basics/Colormaps/colormapTable'

const BASE = 'https://titiler.test'

const timeoutError = () =>
    new DOMException('The operation timed out.', 'TimeoutError')

beforeEach(() => {
    clearColormapCache()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('fetchColormapTable: failures', () => {
    // A service that accepts the connection and never answers would leave the
    // lookup pending forever, and every bulk legend request with it. The fetch
    // carries a deadline, so it rejects instead.
    test('gives the request a deadline', async () => {
        const fetch = vi.fn(async () => {
            throw timeoutError()
        })
        vi.stubGlobal('fetch', fetch)
        const timeout = vi.spyOn(AbortSignal, 'timeout')

        await fetchColormapTable('custom_ramp', BASE)

        expect(timeout).toHaveBeenCalledWith(5000)
        expect(fetch).toHaveBeenCalledWith(`${BASE}/colorMaps/custom_ramp`, {
            signal: expect.any(AbortSignal),
        })
    })

    // A lookup that timed out is a failed one: null to the caller, and
    // remembered for the failure TTL so the service is not re-dialled — and
    // every legend re-blocked on it — straight away.
    test('a timed-out lookup resolves to null and is remembered', async () => {
        const fetch = vi.fn(async () => {
            throw timeoutError()
        })
        vi.stubGlobal('fetch', fetch)

        expect(await fetchColormapTable('custom_ramp', BASE)).toBeNull()
        expect(await fetchColormapTable('custom_ramp', BASE)).toBeNull()
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    // The same for an abort raised by the signal itself.
    test('an aborted lookup resolves to null and is remembered', async () => {
        const fetch = vi.fn(async () => {
            throw new DOMException('The operation was aborted.', 'AbortError')
        })
        vi.stubGlobal('fetch', fetch)

        expect(await fetchColormapTable('custom_ramp', BASE)).toBeNull()
        expect(await fetchColormapTable('custom_ramp', BASE)).toBeNull()
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    // A deployment's own ramp, read into the shared table format.
    test('reads a ramp into 256 colours, transparency kept', async () => {
        const response = JSON.parse(
            readFileSync('tests/unit/fixtures/colormaps/veda/epa-ghgi-ch4.json', 'utf8')
        )
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })))

        const table = await fetchColormapTable('epa-ghgi-ch4', BASE)
        expect(Array.from(table.subarray(0, 4))).toEqual(response['0'])
        const colors = colormapTableToCss(await fetchColormapTable('epa-ghgi-ch4', BASE))
        expect(colors).toHaveLength(256)
        expect(colors[0]).toBe('rgba(111, 76, 155, 0)')
    })

    // A response that is not a 256-colour table is not painted: the lookup
    // fails like any other, with a warning that names the ramp.
    test('a malformed ramp resolves to null with a warning naming it', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: true, json: async () => ({ 0: [0, 0, 0, 255] }) }))
        )

        expect(await fetchColormapTable('custom_ramp', BASE)).toBeNull()
        const [, error] = console.warn.mock.calls[0]
        expect(error.message).toBe(
            'Colormap "custom_ramp": expected 256 colours, got 1'
        )
    })

    // An error answer is reported with the service's own detail.
    test('a lookup the service refuses is reported with its detail', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: false,
                status: 404,
                json: async () => ({ detail: 'Unknown colormap' }),
            }))
        )

        expect(await fetchColormapTable('custom_ramp', BASE)).toBeNull()
        const [, error] = console.warn.mock.calls[0]
        expect(error.message).toBe('Failed to fetch colormap custom_ramp: 404 Unknown colormap')
    })
})


const fixture = (path) =>
    JSON.parse(readFileSync(`tests/unit/fixtures/colormaps/${path}`, 'utf8'))

const respondWith = (data) =>
    vi.fn(async () => ({ ok: true, json: async () => data }))

describe('fetchColormapTable', () => {
    // A service's reversed ramp is its own table, which is not always the
    // forward one mirrored, so a `_r` name is requested as written.
    test('fetches a `_r` ramp under its own name', async () => {
        const fetch = respondWith(fixture('veda/viridis.json'))
        vi.stubGlobal('fetch', fetch)

        await fetchColormapTable('Viridis_r', BASE)

        expect(fetch).toHaveBeenCalledWith(`${BASE}/colorMaps/viridis_r`, {
            signal: expect.any(AbortSignal),
        })
    })

    test('several callers of one ramp share one request', async () => {
        const fetch = respondWith(fixture('veda/viridis.json'))
        vi.stubGlobal('fetch', fetch)

        const [a, b] = await Promise.all([
            fetchColormapTable('viridis', BASE),
            fetchColormapTable('viridis', BASE),
        ])
        expect(a).toBe(b)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    test('asks nothing when there is no service', async () => {
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)

        expect(await fetchColormapTable('viridis', null)).toBeNull()
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('peekColormapTable', () => {
    // A renderer that cannot wait reads whatever is known: nothing yet while
    // the request is out, the table once it lands, null once it has failed.
    test('reports a lookup as unknown, then loaded', async () => {
        vi.stubGlobal('fetch', respondWith(fixture('veda/viridis.json')))

        expect(peekColormapTable('viridis', BASE)).toBeUndefined()
        const pending = fetchColormapTable('viridis', BASE)
        expect(peekColormapTable('viridis', BASE)).toBeUndefined()
        const table = await pending
        expect(peekColormapTable('viridis', BASE)).toBe(table)
    })

    test('reports a failed lookup as null', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new TypeError('Failed to fetch')
            })
        )

        await fetchColormapTable('custom_ramp', BASE)
        expect(peekColormapTable('custom_ramp', BASE)).toBeNull()
    })

    test('never starts a request', () => {
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)

        peekColormapTable('viridis', BASE)
        expect(fetch).not.toHaveBeenCalled()
        expect(peekColormapTable('viridis', null)).toBeNull()
    })
})

describe('fetchColormapList', () => {
    test.each([['veda'], ['eic']])(
        "reads %s's ramp list, `_r` variants included",
        async (service) => {
            vi.stubGlobal('fetch', respondWith(fixture(`${service}/colorMaps.json`)))

            const names = await fetchColormapList(BASE)
            expect(names).toContain('viridis')
            expect(names).toContain('viridis_r')
        }
    )

    test('is fetched once per service', async () => {
        const fetch = respondWith(fixture('eic/colorMaps.json'))
        vi.stubGlobal('fetch', fetch)

        await fetchColormapList(BASE)
        await fetchColormapList(`${BASE}/`)
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(fetch).toHaveBeenCalledWith(`${BASE}/colorMaps`, {
            signal: expect.any(AbortSignal),
        })
    })

    test('a list that will not load is null, and asks nothing without a service', async () => {
        const fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
        vi.stubGlobal('fetch', fetch)

        expect(await fetchColormapList(BASE)).toBeNull()
        expect(await fetchColormapList(null)).toBeNull()
        expect(fetch).toHaveBeenCalledTimes(1)
    })
})
