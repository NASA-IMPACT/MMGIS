import { describe, it, expect } from 'vitest'
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
        expect(Object.keys(tools).sort()).toEqual(['mission_get', 'mission_list'])
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
})
