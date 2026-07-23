import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeDashboardTools } from '../src/tools/dashboard.js'
import { MMGISError } from '../src/mmgisClient.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cfg = {
    mmgisUrl: 'http://mm:8888',
    mmgisToken: 't',
    wsUrl: 'ws://mm:8888/',
    repoRoot,
    mapboxToken: 'pk.test',
    stacCatalogs: {},
    titilerUrl: 'https://titiler.xyz',
} as any

function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}

describe('dashboard tools', () => {
    it('dashboard_profile_schema documents the DashboardSpec shape with layer examples', async () => {
        const tools = Object.fromEntries(makeDashboardTools({} as any, cfg).map((t) => [t.name, t]))
        const schema = parse(await tools.dashboard_profile_schema.handler({}))
        expect(schema.spec.missionName).toBeDefined()
        expect(schema.layerExamples.tile.type).toBe('TileLayer')
        expect(schema.layerExamples.geojson.type).toBe('GeoJsonLayer')
    })

    it('dashboard_generate builds, generates, injects AgentBridge, resolves tokens, and adds the mission', async () => {
        const calls: any[] = []
        const client = {
            addMission: async (mission: string, config: any) => {
                calls.push({ mission, config })
                return { mission, version: 0 }
            },
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const out = parse(
            await tools.dashboard_generate.handler({
                missionName: 'AQ Test',
                view: { lat: 33.7, lon: -84.4, zoom: 9 },
                layers: [
                    {
                        name: 'NO2',
                        type: 'TileLayer',
                        sourceType: 'url',
                        url: 'https://tiles.example.com/{z}/{x}/{y}.png',
                        tileformat: 'wmts',
                        controlled: false,
                        initialOpacity: 1,
                        minZoom: 0,
                        maxNativeZoom: 18,
                        maxZoom: 22,
                    },
                ],
            })
        )
        expect(out.mission).toBe('AQ Test')
        expect(out.url).toBe('http://mm:8888/?mission=AQ%20Test')
        const posted = calls[0].config
        expect(posted.components).toEqual([{ name: 'AgentBridge', js: 'AgentBridge', on: true, variables: {} }])
        expect(JSON.stringify(posted)).not.toContain('{{MAPBOX_TOKEN}}')
        expect(posted.msv.basemap.accessToken).toBe('pk.test')
    }, 30000)

    it('falls back to upsert when the mission exists and updateExisting is set', async () => {
        const client = {
            addMission: async () => {
                throw new MMGISError('Mission already exists.')
            },
            upsertMission: async (mission: string) => ({ mission, version: 4 }),
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const out = parse(await tools.dashboard_generate.handler({ missionName: 'AQ Test', updateExisting: true }))
        expect(out.version).toBe(4)
    }, 30000)

    it('rejects an invalid mission name before doing any generation or client work', async () => {
        const calls: any[] = []
        const client = {
            addMission: async (mission: string, config: any) => {
                calls.push({ mission, config })
                return { mission, version: 0 }
            },
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        // Hyphens are in configs.js's forbidden-character set (`add()`, ~line 265),
        // so this mirrors what /api/configure/add would reject — but preflighted
        // here instead of after an expensive generate.
        const res = await tools.dashboard_generate.handler({ missionName: 'air-quality-atlanta' })
        expect(res.isError).toBe(true)
        const parsed = parse(res)
        expect(parsed.error).toMatch(/air-quality-atlanta/)
        expect(parsed.hint).toBeTruthy()
        expect(calls).toHaveLength(0)
    })

    it('dashboard_profile_schema and the missionName schema describe the mission-name character rule', async () => {
        const tools = Object.fromEntries(makeDashboardTools({} as any, cfg).map((t) => [t.name, t]))
        const schema = parse(await tools.dashboard_profile_schema.handler({}))
        expect(schema.spec.missionName).toMatch(/must not contain/)
    })

    it('warns when MAPBOX_TOKEN is unset and the generated config needed it', async () => {
        const calls: any[] = []
        const client = {
            addMission: async (mission: string, config: any) => {
                calls.push({ mission, config })
                return { mission, version: 0 }
            },
        } as any
        const noTokenCfg = { ...cfg, mapboxToken: '' }
        const tools = Object.fromEntries(makeDashboardTools(client, noTokenCfg).map((t) => [t.name, t]))
        const out = parse(await tools.dashboard_generate.handler({ missionName: 'AQ Test' }))
        expect(out.warnings).toEqual(['MAPBOX_TOKEN is not set — the basemap will not render'])
    }, 30000)

    it('does not warn about MAPBOX_TOKEN when it is set', async () => {
        const client = {
            addMission: async (mission: string) => ({ mission, version: 0 }),
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const out = parse(await tools.dashboard_generate.handler({ missionName: 'AQ Test' }))
        expect(out.warnings).toBeUndefined()
    }, 30000)

    it('reports exists-error with a hint when updateExisting is not set', async () => {
        const client = {
            addMission: async () => {
                throw new MMGISError('Mission already exists.')
            },
        } as any
        const tools = Object.fromEntries(makeDashboardTools(client, cfg).map((t) => [t.name, t]))
        const res = await tools.dashboard_generate.handler({ missionName: 'AQ Test' })
        expect(res.isError).toBe(true)
        expect(parse(res).hint).toMatch(/updateExisting/)
    }, 30000)
})
