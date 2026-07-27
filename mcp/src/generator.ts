import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MMGISError } from './mmgisClient.js'

const execFileAsync = promisify(execFile)

export async function generateConfig(profile: any, repoRoot: string): Promise<any> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgis-mcp-'))
    const profilePath = path.join(tmpDir, 'profile.json')
    try {
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))
        const { stdout } = await execFileAsync(
            process.execPath,
            ['scripts/generate-mission-config.js', profilePath, '--stdout'],
            { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 }
        )
        return JSON.parse(stdout)
    } catch (err: any) {
        if (err instanceof SyntaxError) {
            throw new MMGISError('Config generator produced unparseable output', 'Run the generator manually to debug.')
        }
        const detail = String(err?.stderr || err?.message || err).trim()
        throw new MMGISError(`Config generation failed: ${detail}`, 'Fix the profile fields named in the error and retry.')
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
    }
}

export function resolvePlaceholders(config: any, mapboxToken: string): any {
    // Tokens are URL-safe (alphanumeric + dots); plain string replace is safe here
    return JSON.parse(JSON.stringify(config).split('{{MAPBOX_TOKEN}}').join(mapboxToken))
}

// Substitutes {{MAPBOX_TOKEN}} (single stringify, reused for both the
// placeholder check and the replace) and, when the config needed a token
// that isn't configured, swaps a mapbox basemap for the token-free MapLibre
// demo style so the map still renders.
export function finalizeBasemap(config: any, mapboxToken: string): { config: any; warnings: string[] } {
    const serialized = JSON.stringify(config)
    const neededMapboxToken = serialized.includes('{{MAPBOX_TOKEN}}')
    const resolved = JSON.parse(serialized.split('{{MAPBOX_TOKEN}}').join(mapboxToken))
    const warnings: string[] = []
    if (neededMapboxToken && mapboxToken === '' && resolved?.msv?.basemap?.provider === 'mapbox') {
        resolved.msv.basemap = {
            provider: 'maplibre',
            style: 'https://demotiles.maplibre.org/style.json',
        }
        warnings.push('MAPBOX_TOKEN is not set — using the free MapLibre demo basemap instead')
    }
    return { config: resolved, warnings }
}

export function loadMinimalProfile(repoRoot: string): any {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'mission-profiles', 'minimal.json'), 'utf8'))
}

// listAvailableTools shells out to the generator to build a full-tools probe
// config — that's deterministic per repoRoot within a process, so cache it.
const availableToolsCache = new Map<string, string[]>()

export async function listAvailableTools(repoRoot: string): Promise<string[]> {
    const cached = availableToolsCache.get(repoRoot)
    if (cached) return cached
    const probe = JSON.parse(JSON.stringify(loadMinimalProfile(repoRoot)))
    probe.tools = 'all'
    probe.on = []
    delete probe.output
    const config = await generateConfig(probe, repoRoot)
    const names = config.tools.map((t: { name: string }) => t.name)
    availableToolsCache.set(repoRoot, names)
    return names
}
