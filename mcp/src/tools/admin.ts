import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import { MMGISError } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult, wrap } from './result.js'

const MAX_GEOJSON_BYTES = 20 * 1024 * 1024

const CONFIRM_RETRY_HINT = 'After the user explicitly agrees, retry the SAME call with confirm: true.'

function isFeatureCollection(v: any): boolean {
    return v != null && v.type === 'FeatureCollection' && Array.isArray(v.features)
}

function confirmationNeeded(preview: Record<string, string>) {
    return toToolResult({ needsConfirmation: true, ...preview, hint: CONFIRM_RETRY_HINT })
}

export function makeAdminTools(client: MmgisClient, fetchFn: typeof fetch = fetch): ToolDef[] {
    return [
        {
            name: 'mission_list',
            description: 'List all mission (dashboard) names in this MMGIS deployment.',
            schema: {},
            handler: () =>
                wrap(async () => toToolResult({ missions: await client.listMissions() })),
        },
        {
            name: 'mission_get',
            description: "Get a mission's full configuration JSON and current version.",
            schema: { mission: z.string().describe('Mission name (see mission_list)') },
            handler: ({ mission }: { mission: string }) =>
                wrap(async () => {
                    const out = await client.getMission(mission)
                    return toToolResult({ mission: out.mission, version: out.version, config: out.config })
                }),
        },
        {
            name: 'mission_clone',
            description: 'Clone an existing mission (dashboard) to a new name.',
            schema: {
                fromMission: z.string().describe('Existing mission to copy'),
                toMission: z.string().describe('Name for the new mission'),
            },
            handler: ({ fromMission, toMission }: any) =>
                wrap(async () => {
                    const out = await client.cloneMission(fromMission, toMission)
                    return toToolResult({ mission: toMission, ...out })
                }),
        },
        {
            name: 'mission_delete',
            description: 'DESTRUCTIVE: delete a mission and all its config versions. Requires confirm: true — without it returns a preview. Always show the preview to the user and get their explicit yes first.',
            schema: {
                mission: z.string(),
                confirm: z.boolean().optional().describe('Must be true to actually delete'),
            },
            handler: ({ mission, confirm }: any) =>
                wrap(async () => {
                    const missions = await client.listMissions()
                    if (!missions.includes(mission)) {
                        return toErrorResult(
                            Object.assign(new Error(`Unknown mission: ${mission}`), {
                                hint: `Missions: ${missions.join(', ') || '(none)'}`,
                            })
                        )
                    }
                    if (confirm !== true) {
                        return confirmationNeeded({
                            wouldDelete: `Mission "${mission}" and every config version of it (the Missions/ folder is renamed, not erased).`,
                        })
                    }
                    return toToolResult(await client.destroyMission(mission))
                }),
        },
        {
            name: 'geodataset_list',
            description: 'List geodatasets (uploaded vector datasets) and which missions use them.',
            schema: {},
            handler: () =>
                wrap(async () => toToolResult({ geodatasets: await client.geodatasetEntries() })),
        },
        {
            name: 'geodataset_ingest',
            description: 'Create or replace a geodataset from GeoJSON — inline `geojson` OR a `url` to fetch (max 20MB). Use it in a layer with type "vector" and url "geodatasets:<name>".',
            schema: {
                name: z.string().describe('Geodataset name'),
                geojson: z.record(z.any()).optional().describe('Inline GeoJSON FeatureCollection'),
                url: z.string().optional().describe('URL of a GeoJSON file to fetch'),
                confirm: z.boolean().optional().describe('Must be true to overwrite an existing geodataset'),
            },
            handler: ({ name, geojson, url, confirm }: any) =>
                wrap(async () => {
                    if (!geojson === !url) {
                        return toErrorResult(new MMGISError('Provide exactly one of geojson or url'))
                    }
                    if (confirm !== true) {
                        const existing = await client.geodatasetEntries()
                        const match = (existing as any[]).find((e: any) => e.name === name)
                        if (match) {
                            return confirmationNeeded({
                                wouldReplace: `Geodataset "${name}" already exists with ${match.num_features} features — ingesting replaces ALL of them.`,
                            })
                        }
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
                }),
        },
        {
            name: 'geodataset_delete',
            description: 'DESTRUCTIVE: delete a geodataset and its data table. Requires confirm: true — without it returns a preview. Get the user\'s explicit yes first.',
            schema: { name: z.string(), confirm: z.boolean().optional() },
            handler: ({ name, confirm }: any) =>
                wrap(async () => {
                    if (confirm !== true) {
                        return confirmationNeeded({
                            wouldDelete: `Geodataset "${name}" and its feature table. Layers referencing geodatasets:${name} will break.`,
                        })
                    }
                    return toToolResult(await client.geodatasetRemove(name))
                }),
        },
        {
            name: 'user_list',
            description: 'List MMGIS user accounts (id, username, permission: 111=SuperAdmin, 110=Admin, 001=Viewer).',
            schema: {},
            handler: () =>
                wrap(async () => toToolResult({ users: await client.accountEntries() })),
        },
        {
            name: 'user_create',
            description: "Create a user account (created as Viewer '001'; use user_set_permission to promote to Admin '110'). Password needs 8+ chars with upper, lower, number, symbol. Requires confirm: true after the user agrees. Never repeat the password back in chat.",
            schema: {
                username: z.string(),
                password: z.string().describe('8+ chars with upper, lower, number, symbol'),
                confirm: z.boolean().optional(),
            },
            handler: ({ username, password, confirm }: any) =>
                wrap(async () => {
                    if (confirm !== true) {
                        return confirmationNeeded({
                            wouldCreate: `User "${username}" with Viewer (001) permission.`,
                        })
                    }
                    const out = await client.userSignup(username, password)
                    return toToolResult({ username: out.username ?? username, created: true })
                }),
        },
        {
            name: 'user_set_permission',
            description: "Change a user's permission: '110' (Admin, optionally with missionsManaging list) or '001' (Viewer). SuperAdmin (111) cannot be granted, and user id 1 cannot be changed (backend rules). Requires confirm: true.",
            schema: {
                username: z.string(),
                permission: z.enum(['110', '001']),
                missionsManaging: z.array(z.string()).optional().describe("Missions an Admin ('110') manages"),
                confirm: z.boolean().optional(),
            },
            handler: ({ username, permission, missionsManaging, confirm }: any) =>
                wrap(async () => {
                    if (confirm !== true) {
                        return confirmationNeeded({
                            wouldChange: `Set "${username}" permission to ${permission}${missionsManaging ? ` managing [${missionsManaging.join(', ')}]` : ''}.`,
                        })
                    }
                    const users = await client.accountEntries()
                    const user = users.find((u: any) => u.username === username)
                    if (!user) {
                        return toErrorResult(Object.assign(new Error(`Unknown user: ${username}`), { hint: `Users: ${users.map((u: any) => u.username).join(', ')}` }))
                    }
                    await client.accountUpdate({ id: user.id, permission, ...(missionsManaging ? { missionsManaging } : {}) })
                    return toToolResult({ username, permission, ...(missionsManaging ? { missionsManaging } : {}) })
                }),
        },
    ]
}
