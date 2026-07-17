import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import gen from '../../scripts/generate-mission-config.js'

const {
    generate,
    loadManifests,
    selectToolNames,
    buildToolEntry,
    deepMerge,
    assertTemplateSuperset,
    serialize,
} = gen

// A tiny profile that supplies every top-level template key (though not the
// nested ones — the recursive superset tests rely on that), so generate() can
// run end to end against the real on-disk tool manifests.
function baseProfile(overrides = {}) {
    return {
        tools: ['Title', 'LayerManager'],
        on: ['Title'],
        overrides: {},
        scaffold: {
            msv: { basemap: { accessToken: '{{MAPBOX_TOKEN}}' } },
            projection: {},
            look: {},
            panelSettings: {},
            panels: {},
            time: {},
            layers: [],
        },
        ...overrides,
    }
}

test.describe('generate-mission-config', () => {
    test.describe('selectToolNames (implicit-all vs explicit list)', () => {
        const manifests = {
            Alpha: { name: 'Alpha', defaults: { variables: {} } },
            Bravo: { name: 'Bravo', defaults: { variables: {} }, seedExclude: true },
            Charlie: { name: 'Charlie' }, // no defaults block
        }

        test('tools:"all" includes defaults-declaring tools, minus seedExclude', () => {
            expect(selectToolNames({ tools: 'all' }, manifests)).toEqual(['Alpha'])
        })

        test('missing tools defaults to "all"', () => {
            expect(selectToolNames({}, manifests)).toEqual(['Alpha'])
        })

        test('a tool without a defaults block is excluded from "all"', () => {
            expect(selectToolNames({ tools: 'all' }, manifests)).not.toContain('Charlie')
        })

        test('explicit list returns exactly the named tools', () => {
            expect(selectToolNames({ tools: ['Alpha'] }, manifests)).toEqual(['Alpha'])
        })

        test('explicit list may include a seedExclude tool (opt-out is only for "all")', () => {
            expect(selectToolNames({ tools: ['Bravo'] }, manifests)).toEqual(['Bravo'])
        })

        test('explicit list throws on an unknown tool', () => {
            expect(() => selectToolNames({ tools: ['Nope'] }, manifests)).toThrow(/unknown tool/)
        })

        test('explicit list throws on a tool that declares no defaults', () => {
            expect(() => selectToolNames({ tools: ['Charlie'] }, manifests)).toThrow(/no "defaults"/)
        })

        test('real manifests under "all" exclude Draw (seedExclude) and Kinds (hard-skip)', () => {
            const manifests = loadManifests()
            expect(manifests.Kinds).toBeUndefined()
            const names = selectToolNames({ tools: 'all' }, manifests)
            expect(names).not.toContain('Draw')
            expect(names).not.toContain('Kinds')
            // every selected tool declares defaults
            for (const n of names) expect(manifests[n].defaults).toBeTruthy()
        })
    })

    test.describe('buildToolEntry', () => {
        const manifest = {
            name: 'Widget',
            defaultIcon: 'star',
            paths: { WidgetTool: 'p/WidgetTool', WidgetTool_Extra: 'p/extra' },
            defaults: { variables: { a: 1, b: 2 } },
            metadata: { preferredPosition: 'left' },
        }

        test('fixed key order and js = first paths key', () => {
            const entry = buildToolEntry(manifest, true, undefined)
            expect(Object.keys(entry)).toEqual(['name', 'icon', 'js', 'on', 'variables', 'metadata'])
            expect(entry.js).toBe('WidgetTool')
            expect(entry.on).toBe(true)
        })

        test('override variables deep-merge over manifest defaults', () => {
            const entry = buildToolEntry(manifest, false, { b: 20, c: 30 })
            expect(entry.variables).toEqual({ a: 1, b: 20, c: 30 })
        })

        test('copies metadata verbatim as a clone (no aliasing to the manifest)', () => {
            const entry = buildToolEntry(manifest, true, undefined)
            expect(entry.metadata).toEqual({ preferredPosition: 'left' })
            entry.metadata.preferredPosition = 'mutated'
            expect(manifest.metadata.preferredPosition).toBe('left')
        })

        test('omits icon when the manifest has no defaultIcon', () => {
            const noIcon = { name: 'X', paths: { XTool: 'p' }, defaults: { variables: {} } }
            const entry = buildToolEntry(noIcon, false, undefined)
            expect(entry).not.toHaveProperty('icon')
        })

        test('omits metadata when the manifest has none', () => {
            const noMeta = { name: 'X', defaultIcon: 'i', paths: { XTool: 'p' }, defaults: { variables: {} } }
            const entry = buildToolEntry(noMeta, false, undefined)
            expect(entry).not.toHaveProperty('metadata')
        })
    })

    test.describe('deepMerge', () => {
        test('objects merge recursively', () => {
            expect(deepMerge({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({
                a: { x: 1, y: 3, z: 4 },
            })
        })

        test('arrays replace wholesale (no concatenation)', () => {
            expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] })
        })

        test('does not mutate the base', () => {
            const base = { a: { x: 1 } }
            deepMerge(base, { a: { y: 2 } })
            expect(base).toEqual({ a: { x: 1 } })
        })
    })

    test.describe('generate (integration against real manifests)', () => {
        test('canonical top-level key order', () => {
            const config = generate(baseProfile())
            expect(Object.keys(config)).toEqual([
                'msv',
                'projection',
                'look',
                'panelSettings',
                'panels',
                'time',
                'tools',
                'layers',
            ])
        })

        test('metadata block is copied from the manifest into the tool entry', () => {
            const config = generate(baseProfile())
            const title = config.tools.find((t) => t.name === 'Title')
            const manifests = loadManifests()
            expect(title.metadata).toEqual(manifests.Title.metadata)
            expect(title.metadata).toBeTruthy()
        })

        test('override merges onto manifest defaults', () => {
            const config = generate(
                baseProfile({ overrides: { Title: { variables: { showLogo: false } } } })
            )
            const title = config.tools.find((t) => t.name === 'Title')
            expect(title.variables.showLogo).toBe(false) // overridden
            expect(title.variables.showTitleText).toBe(true) // manifest default preserved
        })

        test('on-flags come from the profile', () => {
            const config = generate(baseProfile())
            expect(config.tools.find((t) => t.name === 'Title').on).toBe(true)
            expect(config.tools.find((t) => t.name === 'LayerManager').on).toBe(false)
        })

        test('tools sort by toolbarPriority then name', () => {
            // LayerManager (priority 2) sorts before Title (priority 3).
            const config = generate(baseProfile())
            expect(config.tools.map((t) => t.name)).toEqual(['LayerManager', 'Title'])
        })

        test('deterministic: two runs serialize byte-identically', () => {
            expect(serialize(generate(baseProfile()))).toBe(serialize(generate(baseProfile())))
        })

        test('placeholder tokens survive serialization verbatim', () => {
            const text = serialize(generate(baseProfile()))
            expect(text).toContain('{{MAPBOX_TOKEN}}')
            expect(text).not.toMatch(/pk\.eyJ/) // no real token
        })
    })

    test.describe('assertTemplateSuperset (recursive)', () => {
        test('passes for both committed profiles', () => {
            const seed = JSON.parse(
                readFileSync('mission-profiles/seed.json', 'utf8')
            )
            const minimal = JSON.parse(
                readFileSync('mission-profiles/minimal.json', 'utf8')
            )
            expect(() => assertTemplateSuperset(generate(seed))).not.toThrow()
            expect(() => assertTemplateSuperset(generate(minimal))).not.toThrow()
        })

        test('throws when a top-level template key is missing', () => {
            const partial = { msv: {}, tools: [], layers: [] } // missing projection/look/etc.
            expect(() => assertTemplateSuperset(partial)).toThrow(/missing template keys/)
        })

        test('throws when a NESTED template key is missing (deep merge would gap-fill it)', () => {
            const config = generate(JSON.parse(
                readFileSync('mission-profiles/minimal.json', 'utf8')
            ))
            delete config.msv.radius.major // nested inside msv.radius
            expect(() => assertTemplateSuperset(config)).toThrow(/msv\.radius\.major/)
        })

        test('skeletal nested objects fail: presence of msv alone is not enough', () => {
            const config = generate(baseProfile()) // baseProfile msv carries only basemap
            expect(() => assertTemplateSuperset(config)).toThrow(/msv\.mission/)
        })

        test('array keys need presence only, never their template contents', () => {
            const config = generate(JSON.parse(
                readFileSync('mission-profiles/minimal.json', 'utf8')
            ))
            config.layers = [] // template's layers is [] too; empty array must pass
            config.tools = [{ different: 'shape' }] // replaces wholesale under the merge
            expect(() => assertTemplateSuperset(config)).not.toThrow()
        })
    })
})
