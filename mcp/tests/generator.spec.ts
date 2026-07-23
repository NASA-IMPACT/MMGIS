import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProfile } from '../src/profileBuilder.js'
import { generateConfig, resolvePlaceholders, listAvailableTools } from '../src/generator.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('generateConfig (integration with scripts/generate-mission-config.js)', () => {
    it('generates a validated config from a built profile', async () => {
        const profile = buildProfile(
            {
                missionName: 'MCP Test',
                view: { lat: 33.75, lon: -84.39, zoom: 10 },
                layers: [
                    {
                        name: 'Basemap Test',
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
            },
            repoRoot
        )
        const config = await generateConfig(profile, repoRoot)
        expect(config.msv.mission).toBe('MCP Test')
        expect(config.tools.map((t: any) => t.name)).toContain('Title')
        expect(config.layers[0].name).toBe('Basemap Test')
    }, 30000)

    it('surfaces generator validation errors with a hint', async () => {
        const profile = buildProfile({ missionName: 'Bad' }, repoRoot)
        delete profile.scaffold.projection // break the template superset
        const err = await generateConfig(profile, repoRoot).catch((e) => e)
        expect(err.name).toBe('MMGISError')
        expect(err.hint).toMatch(/profile/i)
    }, 30000)
})

describe('resolvePlaceholders', () => {
    it('replaces {{MAPBOX_TOKEN}} everywhere', () => {
        const out = resolvePlaceholders({ a: { token: '{{MAPBOX_TOKEN}}' } }, 'pk.test')
        expect(out.a.token).toBe('pk.test')
    })
})

describe('listAvailableTools', () => {
    it('returns the generatable tool names', async () => {
        const names = await listAvailableTools(repoRoot)
        expect(names).toContain('Title')
        expect(names).toContain('LayerManager')
    }, 30000)
})
