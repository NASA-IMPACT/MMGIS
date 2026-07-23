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

export async function listAvailableTools(repoRoot: string): Promise<string[]> {
    const minimal = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'mission-profiles', 'minimal.json'), 'utf8')
    )
    const probe = JSON.parse(JSON.stringify(minimal))
    probe.tools = 'all'
    probe.on = []
    delete probe.output
    const config = await generateConfig(probe, repoRoot)
    return config.tools.map((t: { name: string }) => t.name)
}
