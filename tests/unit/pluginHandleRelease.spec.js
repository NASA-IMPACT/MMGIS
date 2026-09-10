import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'
import L_ from '../../src/essence/Basics/Layers_/Layers_'

// Issue #414 - a handle registers providers on a bus that outlives the plugin
// holding it, so whoever hands the handle out needs a way to take those
// registrations back when the plugin goes away.
describe('plugin handle release', () => {
    let api
    let next
    let savedTools

    beforeEach(() => {
        savedTools = L_.tools
        // getToolVars walks the configured tool list; an empty one is the
        // no-vars case every unconfigured plugin is in.
        L_.tools = []
        api = mmgisAPI.forPlugin('rel-test')
    })

    // The bus is a module singleton, so a handle left registered would answer
    // for the next test's — including after a failed assertion.
    afterEach(() => {
        api.release()
        next?.release()
        next = undefined
        L_.tools = savedTools
    })

    it('takes the mint-time getVars provider off the bus', async () => {
        await expect(
            mmgisAPI.request('plugin:rel-test:getVars')
        ).resolves.toEqual({})
        api.release()
        await expect(
            mmgisAPI.request('plugin:rel-test:getVars')
        ).rejects.toThrow(/No handler/)
    })

    it('takes providers registered through the handle off the bus', async () => {
        api.provide('answer', () => 42)
        await expect(mmgisAPI.request('plugin:rel-test:answer')).resolves.toBe(
            42
        )
        api.release()
        await expect(
            mmgisAPI.request('plugin:rel-test:answer')
        ).rejects.toThrow(/No handler/)
    })

    // A reload mints the successor's handle before the outgoing one is
    // released, so the two overlap on the same names. A cleanup keyed on the
    // name alone would unregister the live successor here.
    it('a stale release leaves a successor holding the same name alone', async () => {
        api.provide('answer', () => 1)
        next = mmgisAPI.forPlugin('rel-test')
        next.provide('answer', () => 42)
        api.release()

        await expect(mmgisAPI.request('plugin:rel-test:answer')).resolves.toBe(
            42
        )
    })

    // A released handle belongs to a plugin that no longer exists; anything it
    // still does is a dead plugin acting on a live map.
    it('is inert once released, and releasing twice is harmless', async () => {
        const seen = []
        const off = mmgisAPI.on('plugin:rel-test:ping', (d) => seen.push(d))
        api.release()

        api.emit('ping', 1)
        expect(seen).toEqual([])

        expect(api.provide('answer', () => 42)()).toBeUndefined()
        expect(mmgisAPI.hasHandler('plugin:rel-test:answer')).toBe(false)
        expect(api.on('plugin:rel-test:ping', () => {})()).toBeUndefined()

        await expect(api.request('map:getViewState')).resolves.toBeNull()
        expect(() => api.release()).not.toThrow()
        off()
    })

    // The token that stamps a request is what core resolves to an address, so
    // a handle that exposed it would let a plugin hand out its own identity.
    it('exposes no token', () => {
        expect(Object.values(api).some((v) => typeof v === 'symbol')).toBe(false)
    })

    // getToolVars answers a miss with a truthy `{__noVars: true}` marker, so a
    // plugin checking "did I get any configuration?" would pass on nothing.
    it('reads an unconfigured plugin as an empty configuration', () => {
        expect(api.getVars()).toEqual({})
    })

    it('reads a configured plugin as its variables', () => {
        L_.tools = [{ name: 'rel-test', variables: { zoom: 4 } }]
        expect(api.getVars()).toEqual({ zoom: 4 })
    })
})
