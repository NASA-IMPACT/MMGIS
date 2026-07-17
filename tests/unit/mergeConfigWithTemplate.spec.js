import { test, expect } from 'vitest'

import mergeConfigWithTemplate from '../../API/Backend/Config/mergeConfigWithTemplate.js'
import configTemplate from '../../API/templates/config_template.js'

// Issue #194: the starter template must act as fallback defaults only. For
// list-shaped sections (tools, layers) the original merge concatenated the
// template's arrays onto the posted ones, so a full config gained duplicate
// tools and cloning compounded the duplication every generation. These tests
// pin the fallback-only contract: posted arrays REPLACE, posted scalars win,
// omitted keys gap-fill from the template.

// Fresh clone of the shipped template for each case — add() clones before
// merging, so tests mirror that (and never mutate the shared module export).
const freshTemplate = () => JSON.parse(JSON.stringify(configTemplate))

test.describe('mergeConfigWithTemplate', () => {
    test('template ships the minimal default tools (fixture sanity)', () => {
        // #109 swapped config_template.js to the generated minimal template:
        // Title + LayerManager (both on), no layers, modern mode.
        const tools = configTemplate.tools.map((t) => t.name)
        expect(tools).toEqual(['LayerManager', 'Title'])
    })

    test('partial post with no arrays: template tools survive, scalars win', () => {
        // Shape the NewMissionModal posts: a few msv scalars, no arrays.
        const posted = {
            msv: {
                radius: { major: '1737400', minor: '1737400' },
                mapEngine: 'cesium',
                mode: '3d',
            },
        }
        const merged = mergeConfigWithTemplate(freshTemplate(), posted)

        // Gap-fill unchanged: the template's default tools are still present.
        expect(merged.tools.map((t) => t.name)).toEqual([
            'LayerManager',
            'Title',
        ])
        // Posted scalars win.
        expect(merged.msv.mapEngine).toBe('cesium')
        expect(merged.msv.mode).toBe('3d')
        expect(merged.msv.radius).toEqual({ major: '1737400', minor: '1737400' })
        // Untouched template scalars remain.
        expect(merged.msv.mission).toBe(configTemplate.msv.mission)
    })

    test('full post with its own tools: exactly the posted tools, none appended', () => {
        const posted = {
            tools: [
                { name: 'Draw', icon: 'draw', js: 'DrawTool' },
                { name: 'Measure', icon: 'ruler', js: 'MeasureTool' },
            ],
        }
        const merged = mergeConfigWithTemplate(freshTemplate(), posted)

        expect(merged.tools.map((t) => t.name)).toEqual(['Draw', 'Measure'])
        // None of the template's defaults (Title / LayerManager) leaked in.
        expect(merged.tools.map((t) => t.name)).not.toContain('LayerManager')
        expect(merged.tools.map((t) => t.name)).not.toContain('Title')
        expect(merged.tools).toHaveLength(2)
    })

    test('posted empty tools array yields zero tools', () => {
        const merged = mergeConfigWithTemplate(freshTemplate(), { tools: [] })
        expect(merged.tools).toEqual([])
    })

    test('re-merging an already-merged config is idempotent (clone scenario)', () => {
        const posted = {
            tools: [{ name: 'Draw', icon: 'draw', js: 'DrawTool' }],
            layers: [{ name: 'Basemap', type: 'tile' }],
        }
        // First creation.
        const once = mergeConfigWithTemplate(freshTemplate(), posted)
        // Clone re-submits the full merged config through add() again.
        const twice = mergeConfigWithTemplate(freshTemplate(), once)
        // Clone-of-a-clone.
        const thrice = mergeConfigWithTemplate(freshTemplate(), twice)

        expect(once.tools).toHaveLength(1)
        expect(twice.tools).toHaveLength(1)
        expect(thrice.tools).toHaveLength(1)
        expect(thrice.tools.map((t) => t.name)).toEqual(['Draw'])
        expect(thrice.layers.map((l) => l.name)).toEqual(['Basemap'])
        // No accumulation anywhere.
        expect(thrice).toEqual(once)
    })

    test('nested posted arrays elsewhere (layers) also replace', () => {
        const posted = {
            layers: [
                { name: 'A', type: 'tile' },
                { name: 'B', type: 'vector' },
            ],
        }
        const merged = mergeConfigWithTemplate(freshTemplate(), posted)
        expect(merged.layers.map((l) => l.name)).toEqual(['A', 'B'])
        expect(merged.layers).toHaveLength(2)
    })

    test('does not mutate the template or the posted config', () => {
        const template = freshTemplate()
        const templateSnapshot = JSON.parse(JSON.stringify(template))
        const posted = { tools: [{ name: 'Draw', icon: 'draw', js: 'DrawTool' }] }
        const postedSnapshot = JSON.parse(JSON.stringify(posted))

        mergeConfigWithTemplate(template, posted)

        expect(template).toEqual(templateSnapshot)
        expect(posted).toEqual(postedSnapshot)
    })

    test('no posted config returns the template untouched', () => {
        const template = freshTemplate()
        expect(mergeConfigWithTemplate(template, undefined)).toBe(template)
    })
})
