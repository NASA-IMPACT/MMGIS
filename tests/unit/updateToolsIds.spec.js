import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildToolIds } from '../../API/updateTools'
import { toolCanonicalId } from '../../src/essence/Basics/ToolController_/ToolMetadataUtils'

// Issue #350: every tool has exactly one canonical id. A manifest declares it
// top-level; tools that declare none get one derived from their module binding.
// buildToolIds is the pure half of the generator, so it can be pinned directly.

const manifest = (paths, id) => ({ paths, ...(id ? { id } : {}) })

describe('buildToolIds', () => {
    it('maps module bindings to declared ids', () => {
        expect(
            buildToolIds({
                FetchStats: manifest({ FetchStatsTool: 'x' }, 'fetch-stats'),
            })
        ).toEqual({ FetchStatsTool: 'fetch-stats' })
    })

    it('derives an id when none is declared', () => {
        expect(buildToolIds({ Draw: manifest({ DrawTool: 'x' }) })).toEqual({
            DrawTool: 'draw',
        })
    })

    it('rejects malformed ids', () => {
        expect(() =>
            buildToolIds({ Bad: manifest({ BadTool: 'x' }, 'Bad Id!') })
        ).toThrow(/id/i)
    })

    // The shape check hangs off the manifest, not its bindings, so a tool that
    // lists no paths still has its declared id validated.
    it('rejects a malformed id on a tool with no bindings', () => {
        expect(() => buildToolIds({ Bad: { id: 'Bad Id!' } })).toThrow(/id/i)
    })

    // `id` present but not a conforming string is always an authoring mistake;
    // only an absent field means "derive one for me".
    it.each([
        ['null', null],
        ['true', true],
        ['an array', ['aoi']],
        ['the empty string', ''],
    ])('rejects an id declared as %s', (_label, id) => {
        expect(() =>
            buildToolIds({ Bad: { id, paths: { BadTool: 'x' } } })
        ).toThrow(/id/i)
    })

    it('rejects duplicate ids', () => {
        expect(() =>
            buildToolIds({
                A: manifest({ ATool: 'x' }, 'same'),
                B: manifest({ BTool: 'x' }, 'same'),
            })
        ).toThrow(/duplicate/i)
    })

    it('rejects two tools whose derived ids collide', () => {
        expect(() =>
            buildToolIds({
                Draw: manifest({ DrawTool: 'x' }),
                DrawCopy: manifest({ DrawTool: 'y' }),
            })
        ).toThrow(/duplicate/i)
    })

    // Legacy 3D tools list helper modules beside their entry point
    // (ShadeTool_Manager, ViewshedTool_Algorithm, ...). Those bindings derive
    // ids carrying an underscore, which the declared-id shape does not allow;
    // the shape is enforced on declared ids only so the build still runs.
    it('accepts an underscore in a derived id', () => {
        expect(
            buildToolIds({
                Viewshed: manifest({
                    ViewshedTool: 'x',
                    ViewshedTool_Manager: 'y',
                }),
            })
        ).toEqual({
            ViewshedTool: 'viewshed',
            ViewshedTool_Manager: 'viewshedtool_manager',
        })
    })

    // A tool's own bindings all belong to it, so they share its declared id
    // rather than colliding with each other.
    it('gives every binding of a multi-binding tool the declared id', () => {
        expect(
            buildToolIds({
                Shade: manifest(
                    { ShadeTool: 'x', ShadeTool_Manager: 'y' },
                    'shade'
                ),
            })
        ).toEqual({ ShadeTool: 'shade', ShadeTool_Manager: 'shade' })
    })

    // Both sides of the map are keyed by author-supplied strings, so neither
    // may fall through to Object.prototype: an id of "constructor" must not
    // read as an already-taken id, and a "__proto__" binding must survive.
    it('keeps ids and bindings that collide with Object.prototype keys', () => {
        const ids = buildToolIds({
            A: manifest({ ATool: 'x' }, 'constructor'),
            // A computed key makes __proto__ an own property rather than
            // setting the literal's prototype.
            B: manifest({ ['__proto__']: 'y' }, 'proto'),
        })
        expect(ids.ATool).toBe('constructor')
        expect(ids['__proto__']).toBe('proto')
    })
})

// The regression that will actually happen is someone adding a manifest with a
// malformed or already-taken id. updateTools() throws on it at server start;
// this makes it fail at `npm test` instead. cwd is the repo root under vitest.
describe('the checked-in tool manifests', () => {
    const toolsDir = 'src/essence/Tools'
    const tools = {}
    for (const dir of fs.readdirSync(toolsDir)) {
        if (dir[0] === '_' || dir[0] === '.') continue
        const configPath = path.join(toolsDir, dir, 'config.json')
        if (!fs.existsSync(configPath)) continue
        tools[dir] = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }

    it('declare ids the build accepts', () => {
        expect(Object.keys(tools).length).toBeGreaterThan(0)
        expect(() => buildToolIds(tools)).not.toThrow()
    })

    // The rule for a manifest that declares no id is written twice — once here
    // for the build, once in toolCanonicalId for the browser — because the two
    // run in different processes. They must land on the same string, or a tool
    // the registry names one thing answers the bus as another. The frontend
    // half reads an empty toolIds under the hermetic pre/tools stub, which is
    // exactly the derived branch this pins.
    it('derive the same ids the frontend does', () => {
        const ids = buildToolIds(tools)
        const undeclared = Object.values(tools)
            .filter((manifest) => manifest.id == null)
            .flatMap((manifest) => Object.keys(manifest.paths || {}))

        expect(undeclared.length).toBeGreaterThan(0)
        for (const binding of undeclared) {
            expect(toolCanonicalId({ js: binding })).toBe(ids[binding])
        }
    })

    it('give the modern tools their canonical ids', () => {
        expect(buildToolIds(tools)).toMatchObject({
            AOITool: 'aoi',
            FetchStatsTool: 'fetch-stats',
            ChartTool: 'chart',
            CardTool: 'card',
            LayerFilterTool: 'layerfilter',
            LayerFilterThemesTool: 'layerfilterthemes',
            LayerManagerTool: 'layermanager',
            MapControlTool: 'mapcontrol',
            ShareExportTool: 'shareexport',
            TimelineTool: 'timeline',
            TitleTool: 'title',
            AddTempLayerTool: 'addtemplayer',
        })
    })
})
