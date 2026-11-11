import { describe, test, expect } from 'vitest'
import { getGroupInfo } from '../groupInfo'

/** A group's header details come from its header layer's config. */
describe('getGroupInfo', () => {
    test('reads title, description and expanded from header configs only', () => {
        const groups = getGroupInfo({
            'aq-uuid': {
                type: 'header',
                display_name: 'Air Quality',
                description: 'All **AQ** layers',
                expanded: true,
            },
            'pm-uuid': { type: 'tile', display_name: 'PM2.5' },
        })
        expect(groups).toEqual({
            'aq-uuid': {
                title: 'Air Quality',
                description: 'All **AQ** layers',
                expanded: true,
            },
        })
    })

    test('a header without a display name is titled by its id', () => {
        expect(getGroupInfo({ h: { type: 'header' } }).h.title).toBe('h')
    })

    test('a blank description reads as none', () => {
        expect(getGroupInfo({ h: { type: 'header', description: '   ' } }).h.description).toBeNull()
    })

    test('anything but true for expanded reads as false', () => {
        const groups = getGroupInfo({
            a: { type: 'header', expanded: 'true' },
            b: { type: 'header' },
        })
        expect([groups.a.expanded, groups.b.expanded]).toEqual([false, false])
    })

    test('no configs answers no groups', () => {
        expect(getGroupInfo(null)).toEqual({})
    })
})
