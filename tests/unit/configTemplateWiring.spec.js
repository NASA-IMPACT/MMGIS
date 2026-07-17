import { test, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import mergeConfigWithTemplate from '../../API/Backend/Config/mergeConfigWithTemplate.js'
import configTemplate from '../../API/templates/config_template.js'

// Issue #109: config_template.js re-exports the generated config_template.json
// (produced from mission-profiles/minimal.json by #157's generator), resolving
// {{MAPBOX_TOKEN}} from the environment at require time. These tests pin the
// WIRING: the module export IS the generated JSON (placeholders resolved), and
// the create-path merge over it yields the minimal, modern starter
// (Title + LayerManager) while letting the NewMissionModal's posted picks win.

// cwd is the repo root under vitest (mirrors generateMissionConfig.spec.js).
const generatedJson = JSON.parse(
    readFileSync('API/templates/config_template.json', 'utf8')
)

// add() clones the shared template before merging; mirror that here.
const freshTemplate = () => JSON.parse(JSON.stringify(configTemplate))

test.describe('config_template.js wiring (#109)', () => {
    test('requiring config_template.js yields the generated JSON, placeholders resolved', () => {
        const expected = JSON.parse(JSON.stringify(generatedJson))
        expected.msv.basemap.accessToken = process.env.MAPBOX_TOKEN || ''
        expect(configTemplate).toEqual(expected)
    })

    test('the wired template is the minimal, modern starter', () => {
        // Exactly Title + LayerManager, both on, each carrying its metadata block.
        expect(configTemplate.tools.map((t) => t.name)).toEqual([
            'LayerManager',
            'Title',
        ])
        for (const t of configTemplate.tools) {
            expect(t.on).toBe(true)
            expect(t.metadata).toBeTruthy()
        }
        // No layers, modern mode, Earth radius.
        expect(configTemplate.layers).toEqual([])
        expect(configTemplate.msv.mode).toBe('modern')
        expect(configTemplate.msv.radius).toEqual({
            major: 6371008,
            minor: 6371008,
        })
        // panelSettings scaffold: a top panel for Title, a left panel for LayerManager.
        const panels = configTemplate.panelSettings.panels
        const top = panels.find((p) => p.position === 'top')
        const left = panels.find((p) => p.position === 'left')
        expect(top.panelTools).toEqual(['Title'])
        expect(left.panelTools).toEqual(['LayerManager'])
    })

    test('NewMissionModal-shaped partial: Title + LayerManager survive, posted picks win', () => {
        // The dialog posts only a handful of msv scalars — no arrays.
        const posted = {
            msv: {
                radius: { major: '1737400', minor: '1737400' },
                mapEngine: 'cesium',
            },
        }
        const merged = mergeConfigWithTemplate(freshTemplate(), posted)

        // Gap-fill: the template's default tools are still there, still modern.
        expect(merged.tools.map((t) => t.name)).toEqual(['LayerManager', 'Title'])
        expect(merged.msv.mode).toBe('modern')
        // Posted radius/engine win.
        expect(merged.msv.mapEngine).toBe('cesium')
        expect(merged.msv.radius).toEqual({ major: '1737400', minor: '1737400' })
        // Untouched template scalars remain.
        expect(merged.msv.mission).toBe(configTemplate.msv.mission)
    })

    test('explicit classic-mode pick wins over the modern default', () => {
        const merged = mergeConfigWithTemplate(freshTemplate(), {
            msv: { mode: 'classic' },
        })
        expect(merged.msv.mode).toBe('classic')
        // Tools still gap-fill; classic mounts them in the classic toolPanel.
        expect(merged.tools.map((t) => t.name)).toEqual(['LayerManager', 'Title'])
    })

    test("a creator's full config comes through untouched (no injected tools)", () => {
        const posted = {
            tools: [
                { name: 'Draw', icon: 'draw', js: 'DrawTool' },
                { name: 'Measure', icon: 'ruler', js: 'MeasureTool' },
            ],
        }
        const merged = mergeConfigWithTemplate(freshTemplate(), posted)

        // Exactly the posted tools; the template's defaults never re-add.
        expect(merged.tools.map((t) => t.name)).toEqual(['Draw', 'Measure'])
        expect(merged.tools.map((t) => t.name)).not.toContain('LayerManager')
        expect(merged.tools.map((t) => t.name)).not.toContain('Title')
        expect(merged.tools).toHaveLength(2)
    })
})

test.describe('placeholder resolution at require time (#109)', () => {
    // Fresh require of the template with the module cache cleared, so the
    // load-time env read happens under this test's stubbed environment.
    async function freshRequire() {
        vi.resetModules()
        const mod = await import('../../API/templates/config_template.js')
        return mod.default
    }

    test('the committed JSON keeps the placeholder — no baked token', () => {
        // The artifact must never carry a real token; resolution happens only
        // at require time. (Guards against "fixing" a blank basemap by
        // committing a token into the generated JSON.)
        expect(generatedJson.msv.basemap.accessToken).toBe('{{MAPBOX_TOKEN}}')
    })

    test('MAPBOX_TOKEN set: a fresh require substitutes the token', async () => {
        vi.stubEnv('MAPBOX_TOKEN', 'pk.test-token-109')
        try {
            const template = await freshRequire()
            expect(template.msv.basemap.accessToken).toBe('pk.test-token-109')
        } finally {
            vi.unstubAllEnvs()
            vi.resetModules()
        }
    })

    test('MAPBOX_TOKEN unset: empty string, and no literal {{ survives anywhere', async () => {
        vi.stubEnv('MAPBOX_TOKEN', undefined) // delete for this test
        try {
            const template = await freshRequire()
            // Empty string is falsy: DeckGLAdapter skips it, exactly as if the
            // user had left the token field blank. The literal "{{MAPBOX_TOKEN}}"
            // is truthy and would reach mapbox-gl -> 401/blank basemap.
            expect(template.msv.basemap.accessToken).toBe('')
            expect(JSON.stringify(template)).not.toContain('{{')
        } finally {
            vi.unstubAllEnvs()
            vi.resetModules()
        }
    })
})
