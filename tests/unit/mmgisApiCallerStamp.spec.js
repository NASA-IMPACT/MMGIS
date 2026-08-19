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

    test('is the id of the handle the request went through', async () => {
        const calls = recorder('test:stamped')

        await mmgisAPI.forPlugin('aoi').request('test:stamped', { a: 1 })

        expect(calls).toEqual([{ data: { a: 1 }, caller: 'aoi' }])
    })

    // `map:hidePopup` takes no payload at all, and the caller still has to
    // reach the provider — it is the only thing that call carries.
    test('reaches a provider that was sent no payload', async () => {
        const calls = recorder('test:payloadless')

        await mmgisAPI.forPlugin('aoi').request('test:payloadless')

        expect(calls).toEqual([{ data: undefined, caller: 'aoi' }])
    })

    // Travelling beside the payload rather than inside it is what lets a
    // payload of any shape through unchanged — there is nothing to spread a
    // field into, and nothing of the author's to overwrite.
    test('leaves a payload that is not an object alone', async () => {
        const calls = recorder('test:scalar')
        const api = mmgisAPI.forPlugin('aoi')

        await api.request('test:scalar', 'some text')
        await api.request('test:scalar', [1, 2, 3])

        expect(calls).toEqual([
            { data: 'some text', caller: 'aoi' },
            { data: [1, 2, 3], caller: 'aoi' },
        ])
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

        await mmgisAPI.forPlugin('aoi').request('map:somethingCoreOwns')

        expect(calls).toHaveLength(1)
        expect(mmgisAPI.hasHandler('plugin:aoi:map:somethingCoreOwns')).toBe(false)
    })
})
