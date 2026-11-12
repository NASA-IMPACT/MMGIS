import { describe, test, expect } from 'vitest'
import {
    buildLayerList,
    placeInTree,
    resolveDrop,
    treeAnnouncements,
} from '../../src/essence/Tools/LayerManager/lib/utils/layerTree.ts'

/**
 * The Layer Manager's grouped list: rows arranged under the configured
 * groups, and moves that keep every item inside its own group. Draw order
 * stays one flat list in core; these helpers translate between the two.
 */

const row = (id) => ({ id, title: id.toUpperCase() })
const layer = (id) => ({ kind: 'layer', id })
const group = (id, children) => ({ kind: 'group', id, children })

/** A shown list as nested ids, for readable expectations. */
const shape = (nodes) =>
    nodes.map((n) =>
        n.kind === 'layer' ? n.layer.id : { [n.group.id]: shape(n.group.children) },
    )

// Air Quality holds AQS (pm, o3) and a forecast layer; a basemap is ungrouped.
const STRUCTURE = [
    group('aq', [group('aqs', [layer('pm'), layer('o3')]), layer('fc')]),
    layer('base'),
]
const GROUPS = { aq: { title: 'Air Quality' }, aqs: { title: 'AQS' } }

describe('buildLayerList', () => {
    test('rows sit under their groups, each level in draw order', () => {
        const rows = ['fc', 'o3', 'pm', 'base'].map(row)
        expect(shape(buildLayerList(rows, STRUCTURE))).toEqual([
            { aq: ['fc', { aqs: ['o3', 'pm'] }] },
            'base',
        ])
    })

    test('a level is sorted by the top-most row of each item', () => {
        const rows = ['base', 'pm', 'fc', 'o3'].map(row)
        expect(shape(buildLayerList(rows, STRUCTURE))).toEqual([
            'base',
            { aq: [{ aqs: ['pm', 'o3'] }, 'fc'] },
        ])
    })

    test('a group with no rows left is dropped', () => {
        const rows = ['fc', 'base'].map(row)
        expect(shape(buildLayerList(rows, STRUCTURE))).toEqual([{ aq: ['fc'] }, 'base'])
    })

    test('a parent left holding only empty groups is dropped too', () => {
        expect(shape(buildLayerList([row('base')], STRUCTURE))).toEqual(['base'])
    })

    test('rows outside the structure sit at the top level', () => {
        const rows = ['temp', 'pm', 'base'].map(row)
        expect(shape(buildLayerList(rows, STRUCTURE))).toEqual([
            'temp',
            { aq: [{ aqs: ['pm'] }] },
            'base',
        ])
    })

    test('no structure lists the rows flat, in the order given', () => {
        const rows = ['b', 'a'].map(row)
        expect(shape(buildLayerList(rows, null))).toEqual(['b', 'a'])
    })

    test('a layer listed twice in the structure shows once', () => {
        const structure = [group('g', [layer('a')]), layer('a')]
        expect(shape(buildLayerList([row('a')], structure))).toEqual([{ g: ['a'] }])
    })

    test("a group carries its info: title, description, expanded", () => {
        const groups = { aq: { title: 'Air Quality', description: 'All AQ', expanded: true } }
        const [node] = buildLayerList([row('fc')], STRUCTURE, groups)
        expect(node.group).toMatchObject({
            id: 'aq',
            title: 'Air Quality',
            description: 'All AQ',
            expanded: true,
        })
    })

    test('a group without info is titled by its id, with no description, collapsed', () => {
        const [node] = buildLayerList([row('fc')], STRUCTURE)
        expect(node.group).toMatchObject({ title: 'aq', description: null, expanded: false })
    })
})

describe('buildLayerList group state', () => {
    const rows = ['pm', 'o3', 'fc', 'base'].map(row)
    const groups = (nodes, out = {}) => {
        nodes.forEach((n) => {
            if (n.kind !== 'group') return
            const { id, visible, partial, opacity } = n.group
            out[id] = { visible, partial, opacity }
            groups(n.group.children, out)
        })
        return out
    }

    test('a group is on while any of its layers is, nested ones included', () => {
        const state = groups(
            buildLayerList(rows, STRUCTURE, GROUPS, { visible: { pm: true }, opacities: {} }),
        )
        expect(state.aq.visible).toBe(true)
        expect(state.aqs.visible).toBe(true)
        expect(
            groups(buildLayerList(rows, STRUCTURE, GROUPS, { visible: { base: true } })).aq.visible,
        ).toBe(false)
    })

    test('a group is partly on while some, but not all, of its layers are', () => {
        const some = groups(buildLayerList(rows, STRUCTURE, GROUPS, { visible: { pm: true } }))
        expect(some.aq.partial).toBe(true)
        expect(some.aqs.partial).toBe(true)

        const all = groups(
            buildLayerList(rows, STRUCTURE, GROUPS, { visible: { pm: true, o3: true, fc: true } }),
        )
        expect(all.aq.partial).toBe(false)
        expect(all.aqs.partial).toBe(false)

        expect(groups(buildLayerList(rows, STRUCTURE, GROUPS, { visible: {} })).aq.partial).toBe(false)
    })

    test('a layer the list does not show keeps its group partly on', () => {
        // o3 is filtered out of the rows and off; the group is not all on.
        const shown = ['pm', 'fc', 'base'].map(row)
        const state = groups(buildLayerList(shown, STRUCTURE, GROUPS, { visible: { pm: true, fc: true } }))
        expect(state.aq.partial).toBe(true)
    })

    test('layers the list does not show still count', () => {
        // fc is filtered out of the rows but on.
        const shown = ['pm', 'base'].map(row)
        const state = groups(buildLayerList(shown, STRUCTURE, GROUPS, { visible: { fc: true } }))
        expect(state.aq.visible).toBe(true)
        expect(state.aqs.visible).toBe(false)
    })

    test('a shared opacity is carried; differing ones read as null', () => {
        const uniform = { pm: 0.5, o3: 0.5, fc: 0.5 }
        expect(groups(buildLayerList(rows, STRUCTURE, GROUPS, { opacities: uniform })).aq.opacity).toBe(0.5)
        const mixed = { pm: 0.5, o3: 1, fc: 0.5 }
        const state = groups(buildLayerList(rows, STRUCTURE, GROUPS, { opacities: mixed }))
        expect(state.aq.opacity).toBeNull()
        expect(state.aqs.opacity).toBeNull()
    })

    test('a layer with no opacity reported counts as fully opaque', () => {
        expect(groups(buildLayerList(rows, STRUCTURE, GROUPS, { opacities: null })).aq.opacity).toBe(1)
    })

    test('without states a group carries no state', () => {
        expect(groups(buildLayerList(rows, STRUCTURE)).aq).toEqual({
            visible: undefined,
            partial: undefined,
            opacity: undefined,
        })
    })
})

describe('placeInTree', () => {
    const ORDER = ['pm', 'o3', 'fc', 'base']

    test('a layer moves within its group', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'o3', 'pm', 'before')).toEqual([
            'o3', 'pm', 'fc', 'base',
        ])
    })

    test('a layer cannot be placed beside a layer in another group', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'o3', 'fc', 'after')).toBeNull()
        expect(placeInTree(ORDER, STRUCTURE, 'pm', 'base', 'after')).toBeNull()
    })

    // Dropped on a layer inside a group, it lands beside the group, never in it.
    test('an ungrouped layer cannot join a group', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'base', 'fc', 'before')).toEqual([
            'base', 'pm', 'o3', 'fc',
        ])
        expect(placeInTree(ORDER, STRUCTURE, 'base', 'o3', 'before')).toEqual([
            'base', 'pm', 'o3', 'fc',
        ])
    })

    test('an ungrouped layer moves among the top-level items', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'base', 'aq', 'before')).toEqual([
            'base', 'pm', 'o3', 'fc',
        ])
    })

    test('a group moves as one block with its order inside kept', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'aq', 'base', 'after')).toEqual([
            'base', 'pm', 'o3', 'fc',
        ])
    })

    test('a nested group moves within its parent', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'aqs', 'fc', 'after')).toEqual([
            'fc', 'pm', 'o3', 'base',
        ])
    })

    test("a group's scattered layers land together when it moves", () => {
        const scattered = ['pm', 'base', 'o3', 'fc']
        expect(placeInTree(scattered, STRUCTURE, 'base', 'aq', 'before')).toEqual([
            'base', 'pm', 'o3', 'fc',
        ])
    })

    test('hidden siblings keep their place around the moved layer', () => {
        // x and y are hidden; dragging c up over a lands just above a.
        const structure = [group('g', ['a', 'x', 'b', 'y', 'c'].map(layer))]
        const order = ['a', 'x', 'b', 'y', 'c']
        expect(placeInTree(order, structure, 'c', 'a', 'before')).toEqual([
            'c', 'a', 'x', 'b', 'y',
        ])
        expect(placeInTree(order, structure, 'a', 'b', 'after')).toEqual([
            'x', 'b', 'a', 'y', 'c',
        ])
    })

    test('layers in the order but not the structure count as top level', () => {
        expect(placeInTree(['temp', ...ORDER], STRUCTURE, 'temp', 'base', 'after')).toEqual([
            'pm', 'o3', 'fc', 'base', 'temp',
        ])
    })

    test('a move that changes nothing is null', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'pm', 'o3', 'before')).toBeNull()
        expect(placeInTree(ORDER, STRUCTURE, 'pm', 'pm', 'after')).toBeNull()
    })

    test('an unknown item is null', () => {
        expect(placeInTree(ORDER, STRUCTURE, 'ghost', 'pm', 'after')).toBeNull()
    })

    test('with no structure it reorders the flat list', () => {
        expect(placeInTree(['a', 'b', 'c'], null, 'c', 'a', 'before')).toEqual(['c', 'a', 'b'])
    })
})

describe('resolveDrop', () => {
    const nodes = buildLayerList(['pm', 'o3', 'fc', 'base'].map(row), STRUCTURE)

    test('dragged up lands before the target, dragged down after it', () => {
        expect(resolveDrop(nodes, 'o3', 'pm')).toBe('before')
        expect(resolveDrop(nodes, 'pm', 'o3')).toBe('after')
        expect(resolveDrop(nodes, 'base', 'aq')).toBe('before')
    })

    test('a drop outside the sibling list is refused', () => {
        expect(resolveDrop(nodes, 'o3', 'fc')).toBeNull()
        expect(resolveDrop(nodes, 'base', 'pm')).toBeNull()
    })

    test('a drop on nothing or on itself is refused', () => {
        expect(resolveDrop(nodes, 'pm', null)).toBeNull()
        expect(resolveDrop(nodes, 'pm', 'pm')).toBeNull()
    })
})

describe('treeAnnouncements', () => {
    const nodes = buildLayerList(['pm', 'o3', 'fc', 'base'].map(row), STRUCTURE, GROUPS)
    const say = treeAnnouncements(nodes)

    test('names the position among siblings and the group', () => {
        expect(say.onDragStart({ active: { id: 'o3' } })).toBe(
            'Picked up O3, position 2 of 2 in AQS.',
        )
        expect(say.onDragOver({ active: { id: 'base' }, over: { id: 'aq' } })).toBe(
            'BASE is at position 1 of 2.',
        )
    })

    test('a drop on nothing says where the item stays', () => {
        expect(say.onDragEnd({ active: { id: 'pm' }, over: null })).toBe(
            'Dropped PM back at position 1 of 2 in AQS.',
        )
    })

    // resolveDrop refuses these, so nothing would move.
    test('over an item outside its own group, it says the item stays in its group', () => {
        expect(say.onDragOver({ active: { id: 'pm' }, over: { id: 'fc' } })).toBe(
            'PM can only move in AQS.',
        )
        expect(say.onDragOver({ active: { id: 'base' }, over: { id: 'pm' } })).toBe(
            'BASE can only move outside any group.',
        )
        expect(say.onDragEnd({ active: { id: 'pm' }, over: { id: 'fc' } })).toBe(
            'Dropped PM back at position 1 of 2 in AQS.',
        )
    })
})
