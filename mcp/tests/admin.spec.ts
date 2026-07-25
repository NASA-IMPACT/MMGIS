import { describe, it, expect, vi } from 'vitest'
import { makeAdminTools } from '../src/tools/admin.js'
import { MMGISError } from '../src/mmgisClient.js'

const fakeClient = {
    listMissions: async () => ['Demo', 'Mars2020'],
    getMission: async (m: string) => ({ mission: m, config: { msv: { mission: m } }, version: 2 }),
} as any

function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}

describe('admin tools', () => {
    const tools = Object.fromEntries(makeAdminTools(fakeClient).map((t) => [t.name, t]))

    it('exposes mission_list and mission_get', () => {
        expect(Object.keys(tools).sort()).toEqual(['geodataset_delete', 'geodataset_ingest', 'geodataset_list', 'mission_clone', 'mission_delete', 'mission_get', 'mission_list', 'user_create', 'user_list', 'user_set_permission'])
    })
    it('mission_list returns mission names', async () => {
        expect(parse(await tools.mission_list.handler({}))).toEqual({ missions: ['Demo', 'Mars2020'] })
    })
    it('mission_get returns config and version', async () => {
        const out = parse(await tools.mission_get.handler({ mission: 'Demo' }))
        expect(out.version).toBe(2)
        expect(out.config.msv.mission).toBe('Demo')
    })
    it('errors become structured {error, hint} results with isError', async () => {
        const failing = { listMissions: async () => { throw new MMGISError('boom', 'try this') } } as any
        const t = Object.fromEntries(makeAdminTools(failing).map((x) => [x.name, x]))
        const res = await t.mission_list.handler({})
        expect(res.isError).toBe(true)
        expect(parse(res)).toEqual({ error: 'boom', hint: 'try this' })
    })

    it('mission_clone calls the clone endpoint', async () => {
        const client = { cloneMission: vi.fn(async () => ({ status: 'success', mission: 'B', version: 0 })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const out = parse(await t.mission_clone.handler({ fromMission: 'A', toMission: 'B' }))
        expect(out.mission).toBe('B')
        expect(client.cloneMission).toHaveBeenCalledWith('A', 'B')
    })

    it('mission_delete requires confirm and previews first', async () => {
        const client = { destroyMission: vi.fn(async () => ({ message: 'Successfully Deleted Mission: A' })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const preview = parse(await t.mission_delete.handler({ missionName: 'A' }))
        expect(preview.needsConfirmation).toBe(true)
        expect(client.destroyMission).not.toHaveBeenCalled()
        const done = parse(await t.mission_delete.handler({ missionName: 'A', confirm: true }))
        expect(done.message).toContain('Deleted')
        expect(client.destroyMission).toHaveBeenCalledWith('A')
    })

    it('geodataset_list returns entries', async () => {
        const client = { geodatasetEntries: vi.fn(async () => [{ name: 'g1', num_features: 5 }]) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        expect(parse(await t.geodataset_list.handler({})).geodatasets).toEqual([{ name: 'g1', num_features: 5 }])
    })

    it('geodataset_ingest accepts inline FeatureCollections and rejects bad shapes', async () => {
        const client = { geodatasetRecreate: vi.fn(async () => ({ status: 'success' })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }] }
        const out = parse(await t.geodataset_ingest.handler({ name: 'g1', geojson: fc }))
        expect(out.name).toBe('g1')
        expect(out.features).toBe(1)
        expect(client.geodatasetRecreate).toHaveBeenCalledWith('g1', fc)
        const bad = await t.geodataset_ingest.handler({ name: 'g1', geojson: { type: 'Point' } })
        expect(bad.isError).toBe(true)
    })

    it('geodataset_ingest fetches from a url with a size cap', async () => {
        const fc = { type: 'FeatureCollection', features: [] }
        const fetcher = vi.fn(async () => ({
            ok: true, headers: { get: () => null }, text: async () => JSON.stringify(fc),
        })) as any
        const client = { geodatasetRecreate: vi.fn(async () => ({ status: 'success' })) } as any
        const t = Object.fromEntries(makeAdminTools(client, fetcher).map((x) => [x.name, x]))
        const out = parse(await t.geodataset_ingest.handler({ name: 'g2', url: 'https://x/y.geojson' }))
        expect(out.features).toBe(0)
        expect(fetcher).toHaveBeenCalledWith('https://x/y.geojson')
        const big = vi.fn(async () => ({ ok: true, headers: { get: () => String(30 * 1024 * 1024) }, text: async () => '' })) as any
        const t2 = Object.fromEntries(makeAdminTools(client, big).map((x) => [x.name, x]))
        expect((await t2.geodataset_ingest.handler({ name: 'g3', url: 'https://x/big.geojson' })).isError).toBe(true)
    })

    it('geodataset_delete requires confirm', async () => {
        const client = { geodatasetRemove: vi.fn(async () => ({ message: "Successfully deleted geodataset 'g1'." })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        expect(parse(await t.geodataset_delete.handler({ name: 'g1' })).needsConfirmation).toBe(true)
        expect(client.geodatasetRemove).not.toHaveBeenCalled()
        parse(await t.geodataset_delete.handler({ name: 'g1', confirm: true }))
        expect(client.geodatasetRemove).toHaveBeenCalledWith('g1')
    })

    it('user_list returns account entries without passwords', async () => {
        const client = { accountEntries: vi.fn(async () => [{ id: 1, username: 'admin', permission: '111' }]) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        expect(parse(await t.user_list.handler({})).users).toEqual([{ id: 1, username: 'admin', permission: '111' }])
    })

    it('user_create requires confirm, calls signup, and never echoes the password', async () => {
        const client = { userSignup: vi.fn(async () => ({ status: 'success', username: 'alice' })) } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const preview = parse(await t.user_create.handler({ username: 'alice', password: 'Str0ng!Pass' }))
        expect(preview.needsConfirmation).toBe(true)
        expect(client.userSignup).not.toHaveBeenCalled()
        const res = await t.user_create.handler({ username: 'alice', password: 'Str0ng!Pass', confirm: true })
        expect(res.content[0].text).not.toContain('Str0ng!Pass')
        expect(parse(res).username).toBe('alice')
        expect(client.userSignup).toHaveBeenCalledWith('alice', 'Str0ng!Pass')
    })

    it('user_set_permission resolves username to id and requires confirm', async () => {
        const client = {
            accountEntries: vi.fn(async () => [{ id: 1, username: 'admin', permission: '111' }, { id: 2, username: 'bob', permission: '001' }]),
            accountUpdate: vi.fn(async () => ({ status: 'success' })),
        } as any
        const t = Object.fromEntries(makeAdminTools(client).map((x) => [x.name, x]))
        const preview = parse(await t.user_set_permission.handler({ username: 'bob', permission: '110', missionsManaging: ['Demo'] }))
        expect(preview.needsConfirmation).toBe(true)
        await t.user_set_permission.handler({ username: 'bob', permission: '110', missionsManaging: ['Demo'], confirm: true })
        expect(client.accountUpdate).toHaveBeenCalledWith({ id: 2, permission: '110', missionsManaging: ['Demo'] })
        const unknown = await t.user_set_permission.handler({ username: 'nope', permission: '001', confirm: true })
        expect(unknown.isError).toBe(true)
    })
})
