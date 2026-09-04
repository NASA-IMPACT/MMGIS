import { test, expect, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'

/**
 * A provider that records exactly what it was handed, so a spec can tell the
 * payload and the caller apart.
 */
function recorder(name) {
    const calls = []
    mmgisAPI.provide(name, (data, caller) => {
        calls.push({ data, caller })
        return true
    })
    return calls
}

// The id has to come from the handle rather than from the payload the plugin
// wrote, or it says only what the plugin wanted core to believe.
test.describe('the caller a request arrives with', () => {

    // Travelling beside the payload rather than inside it is what lets a
    // payload of any shape through unchanged — an object, a scalar, or none
    // at all, the way `map:hidePopup` sends nothing but its caller.
    test('is the id of the handle the request went through, beside any payload', async () => {
        const calls = recorder('test:stamped')
        const api = mmgisAPI.forPlugin('aoi')

        await api.request('test:stamped', { a: 1 })
        await api.request('test:stamped', 'some text')
        await api.request('test:stamped')

        expect(calls).toEqual([
            { data: { a: 1 }, caller: 'aoi' },
            { data: 'some text', caller: 'aoi' },
            { data: undefined, caller: 'aoi' },
        ])
    })

    // The id is the reason the third argument became an object: the sandbox
    // bridge wants a per-request timeout in the same slot, and a number handed
    // to a positional caller would quietly become the popup's owner.
    test('travels in the options object a request made by hand can also fill', async () => {
        const calls = recorder('test:options')

        await mmgisAPI.request('test:options', { a: 1 }, { caller: 'aoi' })

        expect(calls).toEqual([{ data: { a: 1 }, caller: 'aoi' }])
    })

    // Reading a stray id as no caller at all would hand back the very failure
    // the options object exists to prevent, with nothing said about it.
    test('is refused, not ignored, when passed positionally', async () => {
        const calls = recorder('test:positional')

        await expect(mmgisAPI.request('test:positional', { a: 1 }, 'aoi'))
            .rejects.toThrow(/options must be an object/)

        expect(calls).toEqual([])
    })

    test('is absent for a request made without a handle', async () => {
        const calls = recorder('test:anonymous')

        await mmgisAPI.request('test:anonymous', { a: 1 })

        expect(calls).toEqual([{ data: { a: 1 }, caller: undefined }])
    })

    // Unlike emit and provide, which name the plugin's own events and
    // handlers, a request names someone else's provider and so is not
    // prefixed. Prefixing it would put `map:showPopup` out of reach.
    test('does not come with the plugin prefix emit and provide add', async () => {
        const calls = recorder('map:somethingCoreOwns')
        // Standing where a prefixed request would land instead.
        const prefixed = recorder('plugin:aoi:map:somethingCoreOwns')

        await mmgisAPI.forPlugin('aoi').request('map:somethingCoreOwns')

        expect(calls).toHaveLength(1)
        expect(prefixed).toEqual([])
    })
})
