import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface McpConfig {
    mmgisUrl: string
    mmgisToken: string
    wsUrl: string
    repoRoot: string
    mapboxToken: string
    stacCatalogs: Record<string, string>
    titilerUrl: string
}

const DEFAULT_STAC_CATALOGS: Record<string, string> = {
    veda: 'https://openveda.cloud/api/stac',
    'earth-search': 'https://earth-search.aws.element84.com/v1',
}

const STAC_CATALOGS_SHAPE_ERROR =
    'STAC_CATALOGS must be a JSON object mapping catalog name (string) to URL (string), ' +
    'e.g. {"veda": "https://openveda.cloud/api/stac"}'

// JSON.parse alone doesn't guarantee the *shape* we depend on elsewhere
// (stac.ts indexes it as Record<string, string>) — an array or an object with
// non-string values would parse fine but blow up downstream in a confusing way.
function assertStacCatalogsShape(value: unknown): asserts value is Record<string, string> {
    const isPlainObject = typeof value === 'object' && value !== null && !Array.isArray(value)
    if (!isPlainObject || Object.values(value as Record<string, unknown>).some((v) => typeof v !== 'string')) {
        throw new Error(STAC_CATALOGS_SHAPE_ERROR)
    }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
    if (!env.MMGIS_TOKEN) {
        throw new Error(
            'MMGIS_TOKEN is required. Mint a long-term token: log into MMGIS as an admin, then POST /api/longtermtoken/generate (see mcp/README.md).'
        )
    }
    const mmgisUrl = (env.MMGIS_URL || 'http://localhost:8888').replace(/\/+$/, '')
    // MMGIS's WS upgrade only accepts path (WEBSOCKET_ROOT_PATH || ROOT_PATH || '') + '/'
    const rawWsUrl = env.MMGIS_WS_URL || mmgisUrl.replace(/^http/, 'ws') + '/'
    const wsUrl = rawWsUrl.replace(/\/+$/, '') + '/'
    // mcp/src (dev) and mcp/dist (built) are both one level below mcp/
    const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    let stacCatalogs = DEFAULT_STAC_CATALOGS
    if (env.STAC_CATALOGS) {
        let parsed: unknown
        try {
            parsed = JSON.parse(env.STAC_CATALOGS)
        } catch {
            throw new Error(STAC_CATALOGS_SHAPE_ERROR)
        }
        assertStacCatalogsShape(parsed)
        stacCatalogs = parsed
    }
    return {
        mmgisUrl,
        mmgisToken: env.MMGIS_TOKEN,
        wsUrl,
        repoRoot: env.MMGIS_REPO_ROOT || defaultRoot,
        mapboxToken: env.MAPBOX_TOKEN || '',
        stacCatalogs,
        titilerUrl: (env.TITILER_URL || 'https://titiler.xyz').replace(/\/+$/, ''),
    }
}
