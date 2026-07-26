import { describe, it, expect, vi } from 'vitest'
import { makeEditTools } from '../src/tools/edit.js'

function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}

function fakeClient(config: any) {
    return {
        getMission: vi.fn(async () => ({ mission: 'M', config, version: 1 })),
        upsertMission: vi.fn(async (_m: string, cfg: any) => ({ mission: 'M', version: 2, _sent: cfg })),
    } as any
}

const baseConfig = () => ({
    look: { pagename: 'Old' },
    layers: [{ name: 'OSM', uuid: 'u1', visibility: true }],
    tools: [{ name: 'LayerManager', on: true }, { name: 'Chart', on: false }],
})

describe('edit tools', () => {
    const tools = (client: any) => Object.fromEntries(makeEditTools(client).map((t) => [t.name, t]))

    it('exposes exactly the five editing tools', () => {
        expect(Object.keys(tools(fakeClient({}))).sort()).toEqual([
            'layer_add', 'layer_remove', 'layer_update', 'mission_update_config', 'tool_toggle',
        ])
    })

    it('mission_update_config applies a merge patch and upserts with reload info', async () => {
        const client = fakeClient(baseConfig())
        const out = parse(await tools(client).mission_update_config.handler({
            mission: 'M', patch: { look: { pagename: 'New' } },
        }))
        expect(out.version).toBe(2)
        expect(out.refresh).toMatch(/reload/i)
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.look.pagename).toBe('New')
        expect(sent.layers).toHaveLength(1)
        expect(client.upsertMission.mock.calls[0][2]).toEqual({ forceClientUpdate: true, info: { type: 'upsert' } })
    })

    it('layer_add appends (or inserts at position), mints uuid, and sends addLayer info', async () => {
        const client = fakeClient(baseConfig())
        const out = parse(await tools(client).layer_add.handler({
            mission: 'M', layer: { name: 'NewLayer', type: 'vector', url: 'geodatasets:g1' }, position: 0,
        }))
        expect(out.layer.uuid).toMatch(/^[0-9a-f-]{36}$/)
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.layers[0].name).toBe('NewLayer')
        expect(client.upsertMission.mock.calls[0][2].info).toEqual({ type: 'addLayer', layerName: 'NewLayer' })
    })

    it('layer_add errors early when layer.name is missing', async () => {
        const client = fakeClient(baseConfig())
        const res = await tools(client).layer_add.handler({ mission: 'M', layer: { type: 'vector' } })
        expect(res.isError).toBe(true)
        expect(parse(res).hint).toBe('Layer entries need a name.')
        expect(client.upsertMission).not.toHaveBeenCalled()
    })

    it('layer_update merge-patches one layer found by name or uuid', async () => {
        const client = fakeClient(baseConfig())
        await tools(client).layer_update.handler({ mission: 'M', layer: 'u1', patch: { visibility: false } })
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.layers[0]).toEqual({ name: 'OSM', uuid: 'u1', visibility: false })
        expect(client.upsertMission.mock.calls[0][2].info).toEqual({ type: 'updateLayer', layerName: 'OSM' })
    })

    it('layer_remove deletes by name and sends removeLayer info', async () => {
        const client = fakeClient(baseConfig())
        await tools(client).layer_remove.handler({ mission: 'M', layer: 'OSM' })
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.layers).toHaveLength(0)
        expect(client.upsertMission.mock.calls[0][2].info).toEqual({ type: 'removeLayer', layerName: 'OSM' })
    })

    it('unknown layers error with the available names and no upsert', async () => {
        const client = fakeClient(baseConfig())
        const res = await tools(client).layer_update.handler({ mission: 'M', layer: 'Nope', patch: {} })
        expect(res.isError).toBe(true)
        expect(parse(res).hint).toContain('OSM')
        expect(client.upsertMission).not.toHaveBeenCalled()
    })

    it('tool_toggle flips the named tool and errors on unknown tools', async () => {
        const client = fakeClient(baseConfig())
        await tools(client).tool_toggle.handler({ mission: 'M', toolName: 'Chart', on: true })
        const sent = client.upsertMission.mock.calls[0][1]
        expect(sent.tools.find((t: any) => t.name === 'Chart').on).toBe(true)
        const res = await tools(client).tool_toggle.handler({ mission: 'M', toolName: 'Nope', on: true })
        expect(res.isError).toBe(true)
    })
})
