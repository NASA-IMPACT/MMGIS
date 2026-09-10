import { describe, it, expect, beforeEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// Stand in the generated registry the build writes, so the lookup resolves
// addresses the way it does in a browser rather than only through the
// frontend's fallback derivation.
vi.mock('../../src/pre/tools', () => ({
    Kinds: {},
    toolConfigs: {},
    toolModules: {},
    toolIds: { FetchStatsTool: 'fetchstats' },
    testModules: {},
}))

const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_')

/**
 * A tool's variables are configured under its entry in the mission config, but
 * the address it is known by everywhere else comes from its module binding.
 * Those two only coincide when the configured display name happens to be the
 * binding minus its "Tool", so the lookup matches the address first and keeps
 * the lowercased name as a fallback.
 */
describe('getToolVars', () => {
    beforeEach(() => {
        L_.tools = []
    })

    it('finds a tool by its address, whatever it was named', () => {
        L_.tools = [
            { name: 'Statistics', js: 'FetchStatsTool', variables: { url: '/s' } },
        ]

        expect(L_.getToolVars('fetchstats')).toEqual({ url: '/s' })
    })

    // The fallback is what keeps callers that ask by display name working.
    it('still finds a tool by its lowercased name', () => {
        L_.tools = [
            { name: 'Layers', js: 'LayersTool', variables: { search: true } },
        ]

        expect(L_.getToolVars('layers')).toEqual({ search: true })
    })

    // An entry with no module binding is named after itself, hyphenated — the
    // same address the controller would mint its handle under.
    it('names an entry with no binding after itself', () => {
        L_.tools = [{ name: 'Legacy Thing', variables: { b: 2 } }]

        expect(L_.getToolVars('legacy-thing')).toEqual({ b: 2 })
    })

    // External consumers reach this through the `tool:getVars` provider, which
    // hands the marker straight back; only a plugin handle's getVars maps it to
    // an empty object.
    it('answers a miss with the no-vars marker', () => {
        L_.tools = [
            { name: 'Statistics', js: 'FetchStatsTool', variables: { url: '/s' } },
        ]

        expect(L_.getToolVars('nothing-configured')).toEqual({ __noVars: true })
        // The module binding is not an address and never was one.
        expect(L_.getToolVars('FetchStatsTool')).toEqual({ __noVars: true })
    })
})
