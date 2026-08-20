import { test, expect, vi, afterEach } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'

// The bus is a module-level singleton, so a subscription outliving its test is
// heard by the next one. Collected here so a test that fails partway through
// still unsubscribes.
const cleanups = []
const listen = (event, fn) => {
    cleanups.push(mmgisAPI.on(event, fn))
}

afterEach(() => {
    cleanups.splice(0).forEach((off) => off())
    vi.restoreAllMocks()
})

test('a listener receives the emitted payload', () => {
    const seen = []
    listen('test:payload', (data) => seen.push(data))
    mmgisAPI.emit('test:payload', { a: 1 })
    expect(seen).toEqual([{ a: 1 }])
})

test('a throwing listener does not reach the emitter', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    listen('test:isolation', () => { throw new Error('boom') })
    expect(() => mmgisAPI.emit('test:isolation', { a: 1 })).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('test:isolation'),
        expect.any(Error)
    )
})

test('a throwing listener does not stop later listeners', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = []
    listen('test:order', () => { throw new Error('boom') })
    listen('test:order', () => { seen.push('second') })
    mmgisAPI.emit('test:order', {})
    expect(seen).toEqual(['second'])
})

test('wildcard listeners still receive event name and payload', () => {
    const seen = []
    listen('*', (type, data) => { seen.push([type, data]) })
    mmgisAPI.emit('test:wildcard', { v: 7 })
    expect(seen).toEqual([['test:wildcard', { v: 7 }]])
})

test('a throwing wildcard listener is isolated too', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = []
    listen('*', () => { throw new Error('boom') })
    listen('test:wildcard-isolation', () => seen.push('specific'))

    expect(() => mmgisAPI.emit('test:wildcard-isolation', {})).not.toThrow()

    expect(seen).toEqual(['specific'])
    expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('wildcard listener'),
        expect.any(Error)
    )
})

test('a listener that unsubscribes mid-emit does not disturb the rest', () => {
    // Every listener registered when the emit began still receives it.
    const seen = []
    let offSecond
    listen('test:mutation', () => seen.push('first'))
    listen('test:mutation', () => {
        seen.push('second')
        offSecond()
    })
    offSecond = cleanups[cleanups.length - 1]
    listen('test:mutation', () => seen.push('third'))

    mmgisAPI.emit('test:mutation', {})
    expect(seen).toEqual(['first', 'second', 'third'])

    seen.length = 0
    mmgisAPI.emit('test:mutation', {})
    expect(seen).toEqual(['first', 'third'])
})

test('a listener that subscribes mid-emit is not called by that same emit', () => {
    const seen = []
    listen('test:late-subscribe', () => {
        seen.push('first')
        listen('test:late-subscribe', () => seen.push('added-during-emit'))
    })

    mmgisAPI.emit('test:late-subscribe', {})
    expect(seen).toEqual(['first'])

    seen.length = 0
    mmgisAPI.emit('test:late-subscribe', {})
    expect(seen).toEqual(['first', 'added-during-emit'])
})

test('specific listeners run before wildcards', () => {
    const order = []
    listen('*', () => order.push('wildcard'))
    listen('test:precedence', () => order.push('specific'))

    mmgisAPI.emit('test:precedence', {})
    expect(order).toEqual(['specific', 'wildcard'])
})
