import { test, expect, vi, afterEach } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'

afterEach(() => vi.restoreAllMocks())

test('a throwing listener does not reach the emitter', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const off = mmgisAPI.on('test:isolation', () => { throw new Error('boom') })
    expect(() => mmgisAPI.emit('test:isolation', { a: 1 })).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('test:isolation'),
        expect.any(Error)
    )
    off()
})

test('a throwing listener does not stop later listeners', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = []
    const off1 = mmgisAPI.on('test:order', () => { throw new Error('boom') })
    const off2 = mmgisAPI.on('test:order', () => { seen.push('second') })
    mmgisAPI.emit('test:order', {})
    expect(seen).toEqual(['second'])
    off1(); off2()
})

test('wildcard listeners still receive event name and payload', () => {
    const seen = []
    const off = mmgisAPI.on('*', (type, data) => { seen.push([type, data]) })
    mmgisAPI.emit('test:wildcard', { v: 7 })
    expect(seen).toEqual([['test:wildcard', { v: 7 }]])
    off()
})
