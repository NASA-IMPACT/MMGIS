import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import type { McpConfig } from '../config.js'
import { buildProfile, AGENT_BRIDGE_COMPONENT, type DashboardSpec } from '../profileBuilder.js'
import { generateConfig, resolvePlaceholders, listAvailableTools } from '../generator.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

const LAYER_EXAMPLES = {
    tile: {
        name: 'Sentinel-2 True Color',
        type: 'TileLayer',
        sourceType: 'url',
        url: 'https://example.com/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png',
        tileformat: 'wmts',
        controlled: false,
        initialOpacity: 1,
        minZoom: 0,
        maxNativeZoom: 18,
        maxZoom: 22,
        boundingBox: [-88.1, 36.0, -86.8, 37.1],
        style: { brightness: 1, contrast: 1, saturation: 1, blend: 'none' },
        time: { enabled: false },
        variables: {},
    },
    geojson: {
        name: 'Monitoring Stations',
        type: 'GeoJsonLayer',
        sourceType: 'url',
        url: 'https://example.com/stations.geojson',
        controlled: false,
        initialOpacity: 1,
        visibility: true,
        style: {},
        variables: {},
    },
}

const dashboardGenerateSchema = {
    missionName: z.string().describe('Name for the new mission/dashboard'),
    layers: z
        .array(z.record(z.any()))
        .optional()
        .describe('MMGIS layer entries (see dashboard_profile_schema layerExamples). uuids are minted automatically.'),
    view: z
        .object({ lat: z.number(), lon: z.number(), zoom: z.number() })
        .optional()
        .describe('Initial map view'),
    tools: z.array(z.string()).optional().describe('Extra tools beyond Title+LayerManager (see dashboard_tool_options)'),
    on: z.array(z.string()).optional().describe('Tools that start opened'),
    time: z.record(z.any()).optional().describe('Time config, e.g. {"enabled": true}'),
    overrides: z.record(z.object({ variables: z.record(z.any()) })).optional(),
    pageName: z.string().optional().describe('Browser page title / branding'),
    updateExisting: z.boolean().optional().describe('If the mission exists, replace its config (new version)'),
}

export function makeDashboardTools(client: MmgisClient, cfg: McpConfig): ToolDef[] {
    return [
        {
            name: 'dashboard_profile_schema',
            description:
                'Get the input schema and layer-entry examples for dashboard_generate. Call this before generating a dashboard.',
            schema: {},
            handler: async () =>
                toToolResult({
                    spec: {
                        missionName: 'string (required)',
                        layers: 'array of MMGIS layer entries — see layerExamples',
                        view: '{lat, lon, zoom} initial map view',
                        tools: 'string[] extra tools (dashboard_tool_options lists valid names)',
                        on: 'string[] tools opened at start',
                        time: 'object, e.g. {"enabled": true} for time-enabled layers',
                        overrides: '{ToolName: {variables: {...}}} per-tool settings',
                        pageName: 'string page title',
                        updateExisting: 'boolean — replace config if mission exists',
                    },
                    layerExamples: LAYER_EXAMPLES,
                }),
        },
        {
            name: 'dashboard_tool_options',
            description: 'List tool names that dashboard_generate can include in a dashboard.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ tools: await listAvailableTools(cfg.repoRoot) })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'dashboard_generate',
            description:
                'Generate a complete MMGIS mission (dashboard) from a description of layers, view, and tools, and install it. Returns the mission URL.',
            schema: dashboardGenerateSchema,
            handler: async (args: DashboardSpec & { updateExisting?: boolean }) => {
                try {
                    const profile = buildProfile(args, cfg.repoRoot)
                    let config = await generateConfig(profile, cfg.repoRoot)
                    config = resolvePlaceholders(config, cfg.mapboxToken)
                    // Injected after generation: `components` is not a template key,
                    // and /api/configure/add does not run backend validation.
                    config.components = [AGENT_BRIDGE_COMPONENT]
                    let out
                    try {
                        out = await client.addMission(args.missionName, config)
                    } catch (err: any) {
                        if (/already exists/i.test(err?.message || '') && args.updateExisting) {
                            out = await client.upsertMission(args.missionName, config)
                        } else if (/already exists/i.test(err?.message || '')) {
                            err.hint = 'Pass updateExisting: true to replace the existing mission config.'
                            throw err
                        } else {
                            throw err
                        }
                    }
                    return toToolResult({
                        mission: out.mission,
                        version: out.version,
                        url: `${cfg.mmgisUrl}/?mission=${encodeURIComponent(args.missionName)}`,
                    })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
