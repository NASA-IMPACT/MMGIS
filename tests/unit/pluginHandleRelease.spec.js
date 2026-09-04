import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'
import L_ from '../../src/essence/Basics/Layers_/Layers_'

/**
 * A handle registers providers on a bus that outlives the tool holding it, so
 * whoever hands the handle out needs a way to take those registrations back
 * when the tool goes away. Without it a mission reload leaves the previous
 * load's providers answering for tools that no longer exist.
 */
describe('forPlugin handle release', () => {
    let api

    beforeEach(() => {
        // getToolVars walks the configured tool list; an empty one is the
        // no-vars case every fresh plugin starts in.
        L_.tools = []
        api = mmgisAPI.forPlugin('rel-test')
    })

    // The bus is a module singleton, so a handle left registered would answer
    // for the next test's. Releasing an already-released handle is a no-op.
    afterEach(() => {
        api.release()
    })

    it('registers a getVars provider the release removes', async () => {
        await expect(
            mmgisAPI.request('plugin:rel-test:getVars')
        ).resolves.toEqual({})
        api.release()
        await expect(
            mmgisAPI.request('plugin:rel-test:getVars')
        ).rejects.toThrow(/No handler/)
    })

    it('releases providers registered through the handle', async () => {
        api.provide('answer', () => 42)
        await expect(mmgisAPI.request('plugin:rel-test:answer')).resolves.toBe(
            42
        )
        api.release()
        await expect(
            mmgisAPI.request('plugin:rel-test:answer')
        ).rejects.toThrow(/No handler/)
    })

    // A reload hands out the successor's handle before the outgoing one is
    // released, so the two overlap on the same names. The stale release has to
    // take back only its own registrations: a cleanup keyed on the name alone
    // would unregister the live successor and leave the plugin unanswerable.
    it('a stale handle does not unregister the successor that took its names', async () => {
        const next = mmgisAPI.forPlugin('rel-test')
        api.release()
        await expect(
            mmgisAPI.request('plugin:rel-test:getVars')
        ).resolves.toEqual({})
        next.release()
    })

    // getToolVars answers a miss with a truthy `{__noVars: true}` sentinel, so
    // a plugin reading `vars.someSetting` off it would see the sentinel rather
    // than the empty configuration it means.
    it('getVars maps the no-vars sentinel to an empty object', () => {
        expect(api.getVars()).toEqual({})
    })

    it('getVars passes configured tool variables through', () => {
        L_.tools = [{ name: 'rel-test', variables: { zoom: 4 } }]
        expect(api.getVars()).toEqual({ zoom: 4 })
    })

    // getToolVars lowercases the configured name and compares, so a handle
    // whose id carries capitals has to lowercase on the way in or it reads an
    // empty configuration off a tool that is in fact configured.
    it('getVars finds the configuration of a plugin whose id is not lowercase', () => {
        L_.tools = [{ name: 'RelTest', variables: { zoom: 4 } }]
        const mixed = mmgisAPI.forPlugin('RelTest')
        expect(mixed.getVars()).toEqual({ zoom: 4 })
        mixed.release()
    })
})
