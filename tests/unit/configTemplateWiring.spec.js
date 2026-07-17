import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import mergeConfigWithTemplate from '../../API/Backend/Config/mergeConfigWithTemplate.js'
import configTemplate from '../../API/templates/config_template.js'

// Issue #109: config_template.js is now a one-line re-export of the generated
// config_template.json (produced from mission-profiles/minimal.json by #157's
// generator). These tests pin the WIRING: the module export IS the generated
// JSON, and the create-path merge over it yields the minimal, modern starter
// (Title + LayerManager) while letting the NewMissionModal's posted picks win.

// cwd is the repo root under vitest (mirrors generateMissionConfig.spec.js).
const generatedJson = JSON.parse(
    readFileSync('API/templates/config_template.json', 'utf8')
)

// add() clones the shared template before merging; mirror that here.
const freshTemplate = () => JSON.parse(JSON.stringify(configTemplate))

test.describe('config_template.js wiring (#109)', () => {
    test('requiring config_template.js yields the generated JSON object', () => {
        expect(configTemplate).toEqual(generatedJson)
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
