import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    basemapGroupStates,
    findBasemapGroup,
    parseBasemapGroups,
} from '../../src/essence/Basics/Map_/basemapGroups.js'

const CONFIG = [
    {
        name: 'Borders',
        layers: ['admin-0-boundary', 'admin-1-boundary'],
    },
    { name: 'Labels', layers: ['admin-1-label'] },
    { name: 'Cities', layers: ['settlement-major-label'] },
]

const stateOf = (groups, id) => groups.find((g) => g.id === id)?.state

afterEach(() => vi.restoreAllMocks())

describe('parseBasemapGroups', () => {
    test('anything but an array gives no groups', () => {
        expect(parseBasemapGroups(undefined)).toEqual([])
        expect(parseBasemapGroups({})).toEqual([])
    })

    test('a group is found by its name', () => {
        const groups = parseBasemapGroups(CONFIG)
        expect(findBasemapGroup(groups, 'Labels').layers).toEqual([
            'admin-1-label',
        ])
        expect(findBasemapGroup(groups, 'Nothing')).toBeNull()
    })

    test('groups without a name or layer ids are skipped with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const groups = parseBasemapGroups([
            { layers: ['a'] },
            { name: 'Empty', layers: [] },
            { name: 'Bad', layers: [1, 2] },
            { name: 'Good', layers: ['b'] },
        ])
        expect(groups.map((g) => g.id)).toEqual(['Good'])
        expect(warn).toHaveBeenCalledTimes(3)
    })

    // A group's id is its name, so a repeated name would give two groups
    // one id and a toggle could hit the wrong one.
    test('a repeated name is skipped with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const groups = parseBasemapGroups([
            { name: 'Borders', layers: ['admin-1-boundary'] },
            { name: 'Borders', layers: ['other'] },
        ])
        expect(groups.map((g) => g.id)).toEqual(['Borders'])
        expect(findBasemapGroup(groups, 'Borders').layers).toEqual([
            'admin-1-boundary',
        ])
        expect(warn).toHaveBeenCalledTimes(1)
    })
})

describe('basemap group states', () => {
    const groups = parseBasemapGroups(CONFIG)

    test('a group is on, off, or mixed by its layers', () => {
        expect(
            stateOf(
                basemapGroupStates(groups, () => true),
                'Borders',
            ),
        ).toBe('on')
        expect(
            stateOf(
                basemapGroupStates(groups, () => false),
                'Borders',
            ),
        ).toBe('off')

        const states = basemapGroupStates(
            groups,
            (id) => id !== 'admin-1-boundary',
        )
        expect(stateOf(states, 'Borders')).toBe('mixed')
        expect(stateOf(states, 'Cities')).toBe('on')
    })
})

describe('basemap groups over the current style', () => {
    const groups = parseBasemapGroups(CONFIG)
    const inStyle = (ids) => (id) => ids.includes(id)
    const ids = (list) => list.map((g) => g.id)

    test('a group with none of its layers in the style is left out', () => {
        const states = basemapGroupStates(
            groups,
            () => true,
            inStyle(['admin-1-boundary', 'admin-1-label']),
        )
        expect(ids(states)).toEqual(['Borders', 'Labels'])
        expect(
            basemapGroupStates(
                groups,
                () => true,
                () => false,
            ),
        ).toEqual([])
    })

    test("a group's state counts only its ids the style has", () => {
        // admin-0-boundary is off but absent, so Borders reads as on.
        const states = basemapGroupStates(
            groups,
            (id) => id === 'admin-1-boundary',
            inStyle(['admin-1-boundary']),
        )
        expect(stateOf(states, 'Borders')).toBe('on')
    })

    test('without a presence check every group shows', () => {
        expect(ids(basemapGroupStates(groups, () => true))).toHaveLength(3)
    })
})

describe('basemap groups with children', () => {
    const NESTED = [
        {
            name: 'Borders',
            children: [
                { name: 'Countries', layers: ['admin-0-solid', 'admin-0-dotted'] },
                { name: 'States', layers: ['admin-1-boundary'] },
            ],
        },
        {
            name: 'Labels',
            children: [
                { name: 'Countries', layers: ['admin-0-label'] },
                { name: 'Cities', layers: ['settlement-label'] },
            ],
        },
        { name: 'Water', layers: ['water'] },
    ]

    test("a child's id is parent/child, and the parent holds all its children's layers", () => {
        const groups = parseBasemapGroups(NESTED)
        expect(groups.map((g) => g.id)).toEqual(['Borders', 'Labels', 'Water'])
        expect(groups[0].children.map((c) => c.id)).toEqual([
            'Borders/Countries',
            'Borders/States',
        ])
        expect(groups[0].layers).toEqual([
            'admin-0-solid',
            'admin-0-dotted',
            'admin-1-boundary',
        ])
        expect(groups[2].children).toBeUndefined()
    })

    // The same child name under two parents is fine: the ids differ.
    test('a child is found by its id, a parent by its name', () => {
        const groups = parseBasemapGroups(NESTED)
        expect(findBasemapGroup(groups, 'Labels/Countries').layers).toEqual([
            'admin-0-label',
        ])
        expect(findBasemapGroup(groups, 'Borders').layers).toHaveLength(3)
        expect(findBasemapGroup(groups, 'Countries')).toBeNull()
    })

    test('children nest one level only; a grandchild is skipped with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const groups = parseBasemapGroups([
            {
                name: 'Borders',
                children: [
                    { name: 'Deep', children: [{ name: 'X', layers: ['x'] }] },
                    { name: 'States', layers: ['admin-1-boundary'] },
                ],
            },
        ])
        expect(groups[0].children.map((c) => c.name)).toEqual(['States'])
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('a parent with no usable child, or a repeated child name, is warned about', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const groups = parseBasemapGroups([
            { name: 'Empty', children: [] },
            { name: 'Bad', children: [{ name: 'NoLayers' }] },
            {
                name: 'Twice',
                children: [
                    { name: 'A', layers: ['a'] },
                    { name: 'A', layers: ['b'] },
                ],
            },
        ])
        expect(groups.map((g) => g.id)).toEqual(['Twice'])
        expect(groups[0].children).toHaveLength(1)
        // Empty; Bad's child and Bad itself; Twice's repeat.
        expect(warn).toHaveBeenCalledTimes(4)
    })

    test('a parent is on, off or mixed by its children', () => {
        const groups = parseBasemapGroups(NESTED)
        const states = basemapGroupStates(
            groups,
            (id) => id !== 'admin-1-boundary' && id !== 'admin-0-label' && id !== 'settlement-label',
        )
        const borders = states.find((g) => g.id === 'Borders')
        expect(borders.state).toBe('mixed')
        expect(borders.children).toEqual([
            { id: 'Borders/Countries', name: 'Countries', state: 'on' },
            { id: 'Borders/States', name: 'States', state: 'off' },
        ])
        expect(stateOf(states, 'Labels')).toBe('off')
        expect(stateOf(states, 'Water')).toBe('on')
    })

    test("children missing from the style are left out, and a parent with none left goes too", () => {
        const groups = parseBasemapGroups(NESTED)
        const states = basemapGroupStates(
            groups,
            (id) => id === 'admin-0-solid',
            (id) => ['admin-0-solid', 'water'].includes(id),
        )
        expect(states.map((g) => g.id)).toEqual(['Borders', 'Water'])
        const borders = states[0]
        expect(borders.children.map((c) => c.id)).toEqual(['Borders/Countries'])
        // States is gone, so only Countries counts: on.
        expect(borders.state).toBe('on')
    })
})
