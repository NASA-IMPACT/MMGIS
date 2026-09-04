import { describe, it, expect, beforeEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// The hermetic stub the rest of the unit suite aliases in carries an empty
// `toolIds`, which only ever exercises the derived half of the rule. The
// interesting case here is a tool whose declared id is not its lowercased
// name, so stand in a registry that carries one.
vi.mock('../../src/pre/tools', () => ({
    Kinds: {},
    toolConfigs: {},
    toolModules: {},
    toolIds: {
        FetchStatsTool: 'fetch-stats',
        LayersTool: 'layers',
    },
    testModules: {},
}))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_'
)

/**
 * A tool's variables are configured under its entry in the mission config, but
 * the id it is known by everywhere else — on the bus, in the modern
 * controller's registries — comes from its module binding. Those two only
 * coincide for tools whose declared id happens to be their lowercased name, so
 * the lookup matches the canonical id first and keeps the name as a fallback.
 */
describe('getToolVars', () => {
    beforeEach(() => {
        L_.tools = []
    })

    it('finds a tool by the id it declared, not its name', () => {
        L_.tools = [
            { name: 'FetchStats', js: 'FetchStatsTool', variables: { url: '/s' } },
        ]

        // 'FetchStats'.toLowerCase() is 'fetchstats', so only the canonical id
        // reaches this entry.
        expect(L_.getToolVars('fetch-stats')).toEqual({ url: '/s' })
    })

    // The lowercased-name fallback exists for callers predating declared ids,
    // which ask by a key derived from the display name. Where the two agree —
    // a single-word name whose tool declares that same id — both paths reach
    // the entry, which is exactly why those callers keep working unchanged.
    it('finds a tool whose declared id and lowercased name agree', () => {
        L_.tools = [
            { name: 'Layers', js: 'LayersTool', variables: { search: true } },
        ]

        expect(L_.getToolVars('layers')).toEqual({ search: true })
    })

    it('derives the id of a binding the registry does not carry', () => {
        L_.tools = [
            { name: 'Not Plain', js: 'PlainTool', variables: { a: 1 } },
        ]

        expect(L_.getToolVars('plain')).toEqual({ a: 1 })
    })

    // An entry with no module binding is named after itself, hyphenated — the
    // same id the controller mints its handle under, so its variables are
    // reachable by that handle. No handle ever carries the spaced form (a
    // sanitized id cannot hold spaces); the name fallback keeps answering it
    // for callers that ask by display name.
    it('names an entry with no binding after itself', () => {
        L_.tools = [{ name: 'Legacy Thing', variables: { b: 2 } }]

        expect(L_.getToolVars('legacy-thing')).toEqual({ b: 2 })
        expect(L_.getToolVars('legacy thing')).toEqual({ b: 2 })
    })

    // The generated `toolIds` is a plain object literal at runtime, so without
    // an own-property check a binding named after a prototype member would read
    // an inherited function as its id and the entry would go unfound.
    it('derives rather than reading a prototype member as an id', () => {
        L_.tools = [{ name: 'Odd', js: 'constructor', variables: { c: 3 } }]

        expect(L_.getToolVars('constructor')).toEqual({ c: 3 })
    })

    // External consumers reach this through the `tool:getVars` provider, which
    // hands the sentinel straight back; only the plugin handle's getVars maps
    // it to an empty object.
    it('answers a miss with the no-vars sentinel', () => {
        L_.tools = [
            { name: 'FetchStats', js: 'FetchStatsTool', variables: { url: '/s' } },
        ]

        expect(L_.getToolVars('nothing-configured')).toEqual({ __noVars: true })
        // The module binding is not an id and never was one.
        expect(L_.getToolVars('FetchStatsTool')).toEqual({ __noVars: true })
    })

    it('answers a miss for a configured tool that declares no variables', () => {
        L_.tools = [{ name: 'FetchStats', js: 'FetchStatsTool' }]

        expect(L_.getToolVars('fetch-stats')).toEqual({ __noVars: true })
    })
})
