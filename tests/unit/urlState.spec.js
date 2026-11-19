import { test, expect, beforeEach, vi } from 'vitest'

import UrlState from '../../src/essence/Ancillary/UrlState'

// The share link's slot for each plugin. Reading is from the opening link
// and happens once per slot; writing is whatever the plugin last pushed.

beforeEach(() => {
    UrlState._reset()
})

test.describe('UrlState.readInitial', () => {
    test('reads each p.<id> parameter, decoded', () => {
        UrlState.readInitial('?mission=M&p.ComparisonTool=a%2Cb%26c%23d%24e%7Cf&p.other=x')
        expect(UrlState.peek('ComparisonTool')).toBe('a,b&c#d$e|f')
        expect(UrlState.peek('other')).toBe('x')
        expect(UrlState.peek('mission')).toBeNull()
    })

    test('fills a slot from an older tools= entry, encoded or raw', () => {
        UrlState.readInitial('?tools=LayersTool$3-1-0.5,ComparisonTool$layers%7Cswipe,ShadeTool$100%25')
        expect(UrlState.peek('ComparisonTool')).toBe('layers|swipe')
        expect(UrlState.peek('LayersTool')).toBe('3-1-0.5')
        expect(UrlState.peek('ShadeTool')).toBe('100%')
    })

    test('a p.<id> parameter wins over a tools= entry for the same id', () => {
        UrlState.readInitial('?tools=ComparisonTool$old&p.ComparisonTool=new')
        expect(UrlState.peek('ComparisonTool')).toBe('new')
    })

    test('skips a malformed value without throwing, and keeps + as it is', () => {
        expect(() => UrlState.readInitial('?p.bad=%zz&p.good=a+b')).not.toThrow()
        expect(UrlState.peek('bad')).toBeNull()
        expect(UrlState.peek('good')).toBe('a+b')
    })

    test('reading again starts over, taken slots included', () => {
        UrlState.readInitial('?p.a=1')
        expect(UrlState.take('a')).toBe('1')
        UrlState.readInitial('?p.a=2')
        expect(UrlState.take('a')).toBe('2')
    })
})

test.describe('UrlState.take and peek', () => {
    test('take hands a value out once; peek never uses it up', () => {
        UrlState.readInitial('?p.a=1')
        expect(UrlState.peek('a')).toBe('1')
        expect(UrlState.take('a')).toBe('1')
        expect(UrlState.take('a')).toBeNull()
        expect(UrlState.peek('a')).toBe('1')
    })

    test('null for a slot the link did not fill, or a non-string id', () => {
        UrlState.readInitial('?p.a=1')
        expect(UrlState.take('b')).toBeNull()
        expect(UrlState.take(42)).toBeNull()
        expect(UrlState.peek(undefined)).toBeNull()
    })
})

test.describe('UrlState.set and toQuery', () => {
    test('each slot becomes one encoded p.<id> parameter', () => {
        UrlState.set('ComparisonTool', 'a,b&c#d$e|f')
        UrlState.set('other', 'x')
        expect(UrlState.toQuery()).toBe('&p.ComparisonTool=a%2Cb%26c%23d%24e%7Cf&p.other=x')
    })

    test('null or an empty string clears the slot', () => {
        UrlState.set('a', 'x')
        UrlState.set('a', null)
        expect(UrlState.toQuery()).toBe('')
        UrlState.set('a', 'x')
        UrlState.set('a', '')
        expect(UrlState.toQuery()).toBe('')
    })

    test('refuses a non-string value and a missing id', () => {
        expect(UrlState.set('a', { big: true })).toBe(true)
        expect(UrlState.toQuery()).toBe('')
        expect(UrlState.set('', 'x')).toBe(false)
        expect(UrlState.set(undefined, 'x')).toBe(false)
    })

    test('drops a value over the encoded size cap and says so', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        UrlState.set('a', 'fine')
        expect(UrlState.set('a', '|'.repeat(400))).toBe(false)
        expect(UrlState.toQuery()).toBe('')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('a: state is over'))
        warn.mockRestore()
    })

    test('round-trips through the address bar form', () => {
        UrlState.set('ComparisonTool', 'layers|swipe|a,b|c&d#e')
        const query = UrlState.toQuery()
        UrlState._reset()
        UrlState.readInitial('?mission=M' + query)
        expect(UrlState.take('ComparisonTool')).toBe('layers|swipe|a,b|c&d#e')
    })
})
