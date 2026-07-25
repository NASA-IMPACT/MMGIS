import { describe, it, expect } from 'vitest'
import { parseSseChunks, extractUrls } from '../public/app.js'

describe('parseSseChunks', () => {
    it('parses complete frames and keeps the remainder', () => {
        const buffer = 'data: {"type":"text","delta":"a"}\n\ndata: {"type":"done"}\n\ndata: {"type":"te'
        const { events, rest } = parseSseChunks(buffer)
        expect(events).toEqual([{ type: 'text', delta: 'a' }, { type: 'done' }])
        expect(rest).toBe('data: {"type":"te')
    })
    it('skips unparseable frames', () => {
        const { events } = parseSseChunks('data: not json\n\ndata: {"type":"done"}\n\n')
        expect(events).toEqual([{ type: 'done' }])
    })
})

describe('extractUrls', () => {
    it('collects url values from tool-result JSON', () => {
        expect(extractUrls('{"mission":"X","url":"http://localhost:8891/?mission=X"}')).toEqual([
            'http://localhost:8891/?mission=X',
        ])
    })
    it('returns empty for non-JSON or url-less results', () => {
        expect(extractUrls('plain text')).toEqual([])
        expect(extractUrls('{"a":1}')).toEqual([])
    })
    it('finds nested url fields', () => {
        expect(extractUrls('{"result":{"url":"http://x/y"}}')).toEqual(['http://x/y'])
    })
})
