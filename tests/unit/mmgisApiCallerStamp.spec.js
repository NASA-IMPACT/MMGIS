import { describe, it, expect, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'

const cleanups = []

// A provider that records exactly what it was handed, so a case can tell the
// payload and the caller apart.
function recorder(name) {
    const calls = []
    cleanups.push(
        mmgisAPI.provide(name, (data, caller) => {
            calls.push({ data, caller })
            return true
        })
    )
    return calls
}

// Issue #414 - the caller has to come from the handle core minted, not from
// anything the caller wrote, or it says only what the caller wanted core to
// believe.
describe('the caller a request arrives with', () => {
    let api

    // The bus is a module singleton, so a handle or provider left behind would
    // answer for the next case's — including after a failed assertion.
    afterEach(() => {
        api?.release()
        api = undefined
        while (cleanups.length) cleanups.pop()()
    })

    // Riding beside the payload rather than inside it is what lets a payload of
    // any shape through unchanged — an object, a scalar, or none at all.
    it('is the address of the handle the request went through', async () => {
        const calls = recorder('test:stamped')
        api = mmgisAPI.forPlugin('aoi')

        await api.request('test:stamped', { a: 1 })
        await api.request('test:stamped', 'some text')
        await api.request('test:stamped')

        expect(calls).toEqual([
            { data: { a: 1 }, caller: 'aoi' },
            { data: 'some text', caller: 'aoi' },
            { data: undefined, caller: 'aoi' },
        ])
    })

    it('is absent for a request made without a handle', async () => {
        const calls = recorder('test:anonymous')

        await mmgisAPI.request('test:anonymous', { a: 1 })

        expect(calls).toEqual([{ data: { a: 1 }, caller: undefined }])
    })

    // The whole point of resolving the stamp through a token map core keeps to
    // itself: naming yourself in a request buys nothing.
    it('is absent when a request names itself instead of holding a handle', async () => {
        const calls = recorder('test:forged')

        await mmgisAPI.request('test:forged', { a: 1 }, { caller: 'aoi' })
        await mmgisAPI.request('test:forged', { a: 2 }, { __token: 'aoi' })
        await mmgisAPI.request('test:forged', { a: 3 }, 'aoi')

        expect(calls.map((c) => c.caller)).toEqual([
            undefined,
            undefined,
            undefined,
        ])
        expect(calls.map((c) => c.data)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
    })
})
