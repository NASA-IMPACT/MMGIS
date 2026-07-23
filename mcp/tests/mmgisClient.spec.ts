import { describe, it, expect, vi } from 'vitest'
import { MmgisClient, MMGISError } from '../src/mmgisClient.js'

function fakeFetch(status: number, json: unknown) {
    return vi.fn(async () => ({ ok: status < 400, status, json: async () => json })) as unknown as typeof fetch
}

describe('MmgisClient', () => {
    it('sends the Authorization header and returns mission names', async () => {
        const f = fakeFetch(200, { status: 'success', missions: ['Demo'] })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        expect(await client.listMissions()).toEqual(['Demo'])
        const [url, init] = (f as any).mock.calls[0]
        expect(url).toBe('http://mm:8888/api/configure/missions')
        expect(init.headers.Authorization).toBe('Bearer tok')
    })
    it('getMission requests full config with encoded name', async () => {
        const f = fakeFetch(200, { status: 'success', mission: 'A B', config: { msv: {} }, version: 3 })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        const out = await client.getMission('A B')
        expect(out.version).toBe(3)
        expect((f as any).mock.calls[0][0]).toBe('http://mm:8888/api/configure/get?mission=A%20B&full=true')
    })
    it('addMission POSTs {mission, config, makedir}', async () => {
        const f = fakeFetch(200, { status: 'success', mission: 'X', version: 0 })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        await client.addMission('X', { msv: {} })
        const [, init] = (f as any).mock.calls[0]
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ mission: 'X', config: { msv: {} }, makedir: true })
    })
    it('throws MMGISError with the server message on status:failure', async () => {
        const f = fakeFetch(200, { status: 'failure', message: 'Mission already exists.' })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        await expect(client.addMission('X', {})).rejects.toThrow('Mission already exists.')
    })
    it('throws MMGISError with a hint on HTTP errors', async () => {
        const f = fakeFetch(500, {})
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        const err = await client.listMissions().catch((e) => e)
        expect(err).toBeInstanceOf(MMGISError)
        expect(err.hint).toMatch(/MMGIS_URL/)
    })
    it('upsertMission POSTs {mission, config} with no makedir and returns the parsed response', async () => {
        const f = fakeFetch(200, { status: 'success', mission: 'X', version: 1 })
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        const out = await client.upsertMission('X', { msv: {} })
        const [url, init] = (f as any).mock.calls[0]
        expect(url).toBe('http://mm:8888/api/configure/upsert')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ mission: 'X', config: { msv: {} } })
        expect(out).toEqual({ status: 'success', mission: 'X', version: 1 })
    })
    it('throws MMGISError with the base URL and an MMGIS_URL hint when the transport fails', async () => {
        const f = vi.fn(async () => {
            throw new Error('ECONNREFUSED')
        }) as unknown as typeof fetch
        const client = new MmgisClient('http://mm:8888', 'tok', f)
        const err = await client.listMissions().catch((e) => e)
        expect(err).toBeInstanceOf(MMGISError)
        expect(err.message).toMatch('http://mm:8888')
        expect(err.hint).toMatch(/MMGIS_URL/)
    })
})
