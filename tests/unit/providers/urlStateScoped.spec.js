import { test, expect, beforeEach, vi } from 'vitest'
vi.mock('../../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI } from '../../../src/essence/mmgisAPI/mmgisAPI'
import UrlState from '../../../src/essence/Ancillary/UrlState'

// The scoped API fills in the plugin id, so an in-tree plugin never names
// its own slot.
beforeEach(() => {
    UrlState._reset()
})

test('forPlugin().urlState reads and writes that plugin\'s slot', () => {
    UrlState.readInitial('?p.demo=hello&p.other=x')
    const api = mmgisAPI.forPlugin('demo')

    expect(api.urlState.peek()).toBe('hello')
    expect(api.urlState.take()).toBe('hello')
    expect(api.urlState.take()).toBeNull()

    api.urlState.set('a,b')
    expect(UrlState.toQuery()).toBe('&p.demo=a%2Cb')
    api.urlState.set(null)
    expect(UrlState.toQuery()).toBe('')
})
