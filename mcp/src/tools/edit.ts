import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import { mergePatch, editConfig, findLayerIndex } from '../configEdit.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

const LIVE_NOTE =
    'Change saved. Classic sessions apply it live; modern sessions auto-reload within about a second (AgentBridge).'
const RELOAD_NOTE =
    'Change saved. Modern sessions auto-reload within about a second (AgentBridge); classic sessions show a RELOAD button. view_reload is a manual fallback.'

function layerNames(config: any): string {
    return (config?.layers ?? []).map((l: any) => l.name).join(', ') || '(none)'
}

export function makeEditTools(client: MmgisClient): ToolDef[] {
    const mission = z.string().describe('Mission to edit (see mission_list)')
    return [
        {
            name: 'mission_update_config',
            description:
                'Edit ANY part of a mission config with an RFC 7386 JSON merge-patch (objects merge, null deletes a key, arrays replace). Backend validation runs server-side. Prefer layer_*/tool_toggle for common edits.',
            schema: {
                mission,
                patch: z.record(z.any()).describe('Merge patch, e.g. {"look": {"pagename": "New Name"}} or {"msv": {"basemap": {...}}}'),
            },
            handler: async ({ mission, patch }: any) => {
                try {
                    const out = await editConfig(client, mission, (config) => {
                        const merged = mergePatch(config, patch)
                        for (const key of Object.keys(config)) delete config[key]
                        Object.assign(config, merged)
                    })
                    return toToolResult({ ...out, refresh: RELOAD_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'layer_add',
            description: 'Add a layer entry to a mission. Applies live in open sessions.',
            schema: {
                mission,
                layer: z.record(z.any()).describe('MMGIS layer entry (see dashboard_profile_schema layerExamples; vector layers can use url "geodatasets:<name>")'),
                position: z.number().optional().describe('Index to insert at (default: end)'),
            },
            handler: async ({ mission, layer, position }: any) => {
                try {
                    if (!layer || typeof layer.name !== 'string' || layer.name.trim() === '') {
                        return toErrorResult(
                            Object.assign(new Error('layer.name is required'), {
                                hint: 'Layer entries need a name.',
                            })
                        )
                    }
                    const entry = { uuid: randomUUID(), sublayers: [], visibility: true, ...layer }
                    const out = await editConfig(client, mission, (config) => {
                        config.layers = config.layers ?? []
                        const at = position === undefined ? config.layers.length : Math.max(0, Math.min(position, config.layers.length))
                        config.layers.splice(at, 0, entry)
                        return { info: { type: 'addLayer', layerName: entry.name } }
                    })
                    return toToolResult({ ...out, layer: entry, refresh: LIVE_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'layer_update',
            description: 'Merge-patch a single layer (found by name or uuid). Applies live in open sessions.',
            schema: {
                mission,
                layer: z.string().describe('Layer name or uuid'),
                patch: z.record(z.any()).describe('Merge patch for the layer entry, e.g. {"visibility": false} or {"initialOpacity": 0.5}'),
            },
            handler: async ({ mission, layer, patch }: any) => {
                try {
                    let updatedName = ''
                    const out = await editConfig(client, mission, (config) => {
                        const idx = findLayerIndex(config, layer)
                        if (idx === -1) {
                            throw Object.assign(new Error(`Unknown layer: ${layer}`), {
                                hint: `Available layers: ${layerNames(config)}`,
                            })
                        }
                        config.layers[idx] = mergePatch(config.layers[idx], patch)
                        updatedName = config.layers[idx].name
                        return { info: { type: 'updateLayer', layerName: updatedName } }
                    })
                    return toToolResult({ ...out, layer: updatedName, refresh: LIVE_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'layer_remove',
            description: 'Remove a layer (by name or uuid). Applies live in open sessions.',
            schema: { mission, layer: z.string().describe('Layer name or uuid') },
            handler: async ({ mission, layer }: any) => {
                try {
                    let removedName = ''
                    const out = await editConfig(client, mission, (config) => {
                        const idx = findLayerIndex(config, layer)
                        if (idx === -1) {
                            throw Object.assign(new Error(`Unknown layer: ${layer}`), {
                                hint: `Available layers: ${layerNames(config)}`,
                            })
                        }
                        removedName = config.layers[idx].name
                        config.layers.splice(idx, 1)
                        return { info: { type: 'removeLayer', layerName: removedName } }
                    })
                    return toToolResult({ ...out, removed: removedName, refresh: LIVE_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'tool_toggle',
            description: "Turn a mission's tool on or off (e.g. Chart, Measure).",
            schema: { mission, toolName: z.string(), on: z.boolean() },
            handler: async ({ mission, toolName, on }: any) => {
                try {
                    const out = await editConfig(client, mission, (config) => {
                        const tool = (config.tools ?? []).find((t: any) => t.name === toolName)
                        if (!tool) {
                            throw Object.assign(new Error(`Unknown tool: ${toolName}`), {
                                hint: `Configured tools: ${(config.tools ?? []).map((t: any) => t.name).join(', ') || '(none)'}`,
                            })
                        }
                        tool.on = on
                    })
                    return toToolResult({ ...out, tool: toolName, on, refresh: RELOAD_NOTE })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
