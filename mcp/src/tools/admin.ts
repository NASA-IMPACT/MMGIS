import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import { MMGISError } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

const MAX_GEOJSON_BYTES = 20 * 1024 * 1024

function isFeatureCollection(v: any): boolean {
    return v != null && v.type === 'FeatureCollection' && Array.isArray(v.features)
}

export function makeAdminTools(client: MmgisClient, fetchFn: typeof fetch = fetch): ToolDef[] {
    return [
        {
            name: 'mission_list',
            description: 'List all mission (dashboard) names in this MMGIS deployment.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ missions: await client.listMissions() })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'mission_get',
            description: "Get a mission's full configuration JSON and current version.",
            schema: { mission: z.string().describe('Mission name (see mission_list)') },
            handler: async ({ mission }: { mission: string }) => {
                try {
                    const out = await client.getMission(mission)
                    return toToolResult({ mission: out.mission, version: out.version, config: out.config })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'mission_clone',
            description: 'Clone an existing mission (dashboard) to a new name.',
            schema: {
                fromMission: z.string().describe('Existing mission to copy'),
                toMission: z.string().describe('Name for the new mission'),
            },
            handler: async ({ fromMission, toMission }: any) => {
                try {
                    const out = await client.cloneMission(fromMission, toMission)
                    return toToolResult({ mission: toMission, ...out })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'mission_delete',
            description: 'DESTRUCTIVE: delete a mission and all its config versions. Requires confirm: true — without it returns a preview. Always show the preview to the user and get their explicit yes first.',
            schema: {
                missionName: z.string(),
                confirm: z.boolean().optional().describe('Must be true to actually delete'),
            },
            handler: async ({ missionName, confirm }: any) => {
                try {
                    if (confirm !== true) {
                        return toToolResult({
                            needsConfirmation: true,
                            wouldDelete: `Mission "${missionName}" and every config version of it (the Missions/ folder is renamed, not erased).`,
                        })
                    }
                    return toToolResult(await client.destroyMission(missionName))
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'geodataset_list',
            description: 'List geodatasets (uploaded vector datasets) and which missions use them.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ geodatasets: await client.geodatasetEntries() })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'geodataset_ingest',
            description: 'Create or replace a geodataset from GeoJSON — inline `geojson` OR a `url` to fetch (max 20MB). Use it in a layer with type "vector" and url "geodatasets:<name>".',
            schema: {
                name: z.string().describe('Geodataset name'),
                geojson: z.record(z.any()).optional().describe('Inline GeoJSON FeatureCollection'),
                url: z.string().optional().describe('URL of a GeoJSON file to fetch'),
            },
            handler: async ({ name, geojson, url }: any) => {
                try {
                    if (!geojson === !url) {
                        return toErrorResult(new MMGISError('Provide exactly one of geojson or url'))
                    }
                    let data = geojson
                    if (url) {
                        const res = await fetchFn(url)
                        if (!res.ok) throw new MMGISError(`Fetch failed (${res.status}) for ${url}`)
                        const len = Number(res.headers.get('content-length') || 0)
                        if (len > MAX_GEOJSON_BYTES) throw new MMGISError(`File too large (${len} bytes; max ${MAX_GEOJSON_BYTES})`)
                        const text = await res.text()
                        if (text.length > MAX_GEOJSON_BYTES) throw new MMGISError(`File too large (max ${MAX_GEOJSON_BYTES} bytes)`)
                        try {
                            data = JSON.parse(text)
                        } catch {
                            throw new MMGISError(`${url} is not valid JSON`)
                        }
                    }
                    if (!isFeatureCollection(data)) {
                        return toErrorResult(new MMGISError('GeoJSON must be a FeatureCollection with a features array'))
                    }
                    await client.geodatasetRecreate(name, data)
                    return toToolResult({ name, features: data.features.length, layerUrl: `geodatasets:${name}` })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'geodataset_delete',
            description: 'DESTRUCTIVE: delete a geodataset and its data table. Requires confirm: true — without it returns a preview. Get the user\'s explicit yes first.',
            schema: { name: z.string(), confirm: z.boolean().optional() },
            handler: async ({ name, confirm }: any) => {
                try {
                    if (confirm !== true) {
                        return toToolResult({ needsConfirmation: true, wouldDelete: `Geodataset "${name}" and its feature table. Layers referencing geodatasets:${name} will break.` })
                    }
                    return toToolResult(await client.geodatasetRemove(name))
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
