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
        try {
            stacCatalogs = JSON.parse(env.STAC_CATALOGS)
        } catch {
            throw new Error('STAC_CATALOGS must be a JSON object of {name: url}')
        }
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
