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

// Mirrors the mission-name validation in API/Backend/Config/routes/configs.js's
// `add()` handler (~line 265: "Bad mission name."). Checked here too so a bad
// name fails fast, before the (expensive) profile-build + config-generation
// work, instead of surfacing only after /api/configure/add rejects it.
const MISSION_NAME_FORBIDDEN_CHARS = /[`~!@#$%^&*()|+\-=?;:'",.<>{}[\]\\/]/gi
const MISSION_NAME_RULE =
    'Mission names must be non-empty, must not start with a digit, must not contain "../" or "..\\\\", ' +
    'and must not contain any of: ` ~ ! @ # $ % ^ & * ( ) | + - = ? ; : \' " , . < > { } [ ] \\ /'

function validateMissionName(missionName: string): { message: string; hint: string } | null {
    const isInvalid =
        missionName !== missionName.replace(MISSION_NAME_FORBIDDEN_CHARS, '') ||
        missionName.length === 0 ||
        !isNaN(missionName[0] as any) ||
        missionName.includes('../') ||
        missionName.includes('..\\')
    if (!isInvalid) return null
    return {
        message: `Invalid mission name: "${missionName}"`,
        hint: MISSION_NAME_RULE,
    }
}

async function installMission(
    client: MmgisClient,
    missionName: string,
    config: any,
    updateExisting: boolean | undefined
): Promise<{ mission: string; version: number }> {
    try {
        return await client.addMission(missionName, config)
    } catch (err: any) {
        if (/already exists/i.test(err?.message || '')) {
            if (updateExisting) return await client.upsertMission(missionName, config)
            err.hint = 'Pass updateExisting: true to replace the existing mission config.'
        }
        throw err
    }
}

const dashboardGenerateSchema = {
    missionName: z.string().describe(`Name for the new mission/dashboard. ${MISSION_NAME_RULE}`),
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
    returnConfig: z
        .boolean()
        .optional()
        .describe('Include the full generated mission config JSON in the result'),
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
                        missionName: `string (required). ${MISSION_NAME_RULE}`,
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
            handler: async (args: DashboardSpec & { updateExisting?: boolean; returnConfig?: boolean }) => {
                try {
                    const nameError = validateMissionName(args.missionName)
                    if (nameError) return toErrorResult(nameError)
                    const profile = buildProfile(args, cfg.repoRoot)
                    let config = await generateConfig(profile, cfg.repoRoot)
                    const neededMapboxToken = JSON.stringify(config).includes('{{MAPBOX_TOKEN}}')
                    config = resolvePlaceholders(config, cfg.mapboxToken)
                    // Injected after generation: `components` is not a template key,
                    // and /api/configure/add does not run backend validation.
                    config.components = [AGENT_BRIDGE_COMPONENT]
                    const out = await installMission(client, args.missionName, config, args.updateExisting)
                    const warnings: string[] = []
                    if (neededMapboxToken && cfg.mapboxToken === '') {
                        warnings.push('MAPBOX_TOKEN is not set — the basemap will not render')
                    }
                    return toToolResult({
                        mission: out.mission,
                        version: out.version,
                        url: `${cfg.mmgisUrl}/?mission=${encodeURIComponent(args.missionName)}`,
                        ...(warnings.length > 0 ? { warnings } : {}),
                        ...(args.returnConfig ? { config } : {}),
                    })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'dashboard_create_from_config',
            description:
                'Install an MMGIS mission (dashboard) from a complete raw mission config JSON — use when the user provides or edits config JSON directly. Returns the mission URL.',
            schema: {
                missionName: z.string().describe(`Name for the mission. ${MISSION_NAME_RULE}`),
                config: z.record(z.any()).describe('Complete MMGIS mission config object (e.g. from dashboard_generate with returnConfig)'),
                updateExisting: z.boolean().optional().describe('If the mission exists, replace its config (new version)'),
            },
            handler: async (args: { missionName: string; config: any; updateExisting?: boolean }) => {
                try {
                    const nameError = validateMissionName(args.missionName)
                    if (nameError) return toErrorResult(nameError)
                    const neededMapboxToken = JSON.stringify(args.config).includes('{{MAPBOX_TOKEN}}')
                    const config = resolvePlaceholders(args.config, cfg.mapboxToken)
                    if (!Array.isArray(config.components)) {
                        config.components = [AGENT_BRIDGE_COMPONENT]
                    }
                    const out = await installMission(client, args.missionName, config, args.updateExisting)
                    const warnings: string[] = []
                    if (neededMapboxToken && cfg.mapboxToken === '') {
                        warnings.push('MAPBOX_TOKEN is not set — the basemap will not render')
                    }
                    return toToolResult({
                        mission: out.mission,
                        version: out.version,
                        url: `${cfg.mmgisUrl}/?mission=${encodeURIComponent(args.missionName)}`,
                        ...(warnings.length > 0 ? { warnings } : {}),
                    })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
