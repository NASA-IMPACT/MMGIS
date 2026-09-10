import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildToolIds } from '../../API/updateTools'
import { toolCanonicalId } from '../../src/essence/Basics/ToolController_/ToolMetadataUtils'

// Issue #350: a tool's address is derived from its module binding at build
// time and written into the generated registry. buildToolIds is the pure half
// of the generator, so it can be pinned directly.

describe('buildToolIds', () => {
    it('derives an address from each binding', () => {
        expect(buildToolIds({ Draw: { paths: { DrawTool: 'x' } } })).toEqual({
            DrawTool: 'draw',
        })
    })

    // Kinds is special-cased out of `toolModules` — it is imported under its
    // own export rather than loaded as a tool — but it is still a binding with
    // an address, and nothing about the derivation treats it differently.
    it('names the Kinds binding after itself', () => {
        expect(buildToolIds({ Kinds: { paths: { Kinds: 'x' } } })).toEqual({
            Kinds: 'kinds',
        })
    })

    // Legacy 3D tools list helper modules beside their entry point. Only a
    // trailing "Tool" is dropped, so a helper keeps the underscore that makes
    // it a separate address from the tool it belongs to.
    it('keeps the underscore in a helper binding', () => {
        expect(
            buildToolIds({
                Viewshed: {
                    paths: { ViewshedTool: 'x', ViewshedTool_Manager: 'y' },
                },
            })
        ).toEqual({
            ViewshedTool: 'viewshed',
            ViewshedTool_Manager: 'viewshedtool_manager',
        })
    })

    // Dropping a trailing "Tool" lets two bindings land on one address, where
    // the second would quietly take over the first's events and providers.
    // The generator throws instead, so the collision fails the build.
    it('rejects two bindings that derive the same address', () => {
        expect(() =>
            buildToolIds({
                Foo: { paths: { Foo: 'x', FooTool: 'y' } },
            })
        ).toThrow(/"Foo" and "FooTool" both derive the address "foo"/)
    })

    // The derivation is written twice — here for the build, and in
    // toolCanonicalId for the browser, which falls back to it for a binding
    // the generated registry does not carry. The two run in different
    // processes and must land on the same string, or a tool the registry names
    // one thing answers the bus as another. cwd is the repo root under vitest.
    it('agrees with the frontend derivation on the checked-in manifests', () => {
        const toolsDir = 'src/essence/Tools'
        const tools = {}
        for (const dir of fs.readdirSync(toolsDir)) {
            if (dir[0] === '_' || dir[0] === '.') continue
            const configPath = path.join(toolsDir, dir, 'config.json')
            if (!fs.existsSync(configPath)) continue
            tools[dir] = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        }

        const ids = buildToolIds(tools)
        expect(Object.keys(ids).length).toBeGreaterThan(0)
        expect(ids).toMatchObject({ AOITool: 'aoi', FetchStatsTool: 'fetchstats' })
        for (const binding of Object.keys(ids)) {
            expect(toolCanonicalId({ js: binding })).toBe(ids[binding])
        }
    })
})
