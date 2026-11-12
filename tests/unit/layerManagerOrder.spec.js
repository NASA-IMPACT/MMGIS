import { describe, test, expect } from 'vitest'
import {
    placeInTree,
    resolveDrop,
    treeAnnouncements,
} from '../../src/essence/Tools/LayerManager/lib/utils/layerTree.ts'

/**
 * The Layer Manager's flat list: no grouping, so every row is a sibling of
 * every other. It reads the draw order over the bus, shows its list top first
 * to match, and places a dragged layer relative to that list by handing core
 * a whole new order. The handler that does the reading and writing is covered
 * next to the other handlers in the plugin's own __tests__.
 */

const nodesOf = (layers) => layers.map((layer) => ({ kind: 'layer', layer }))

describe('placeInTree without a structure', () => {
    // Full order a..e; the user sees only a, c, e (b and d are filtered out).
    const order = ['a', 'b', 'c', 'd', 'e']
    const place = (id, overId, placement, from = order) =>
        placeInTree(from, null, id, overId, placement)

    test('dragged up, it lands just above the row dropped on', () => {
        expect(place('e', 'c', 'before')).toEqual(['a', 'b', 'e', 'c', 'd'])
        expect(place('e', 'a', 'before')).toEqual(['e', 'a', 'b', 'c', 'd'])
    })

    test('dragged down, it lands just below the row dropped on', () => {
        expect(place('a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd', 'e'])
        expect(place('a', 'e', 'after')).toEqual(['b', 'c', 'd', 'e', 'a'])
    })

    // Hidden layers above the first row shown stay above it.
    test('a drop above the first row shown lands just above it', () => {
        expect(place('e', 'c', 'before')).toEqual(['a', 'b', 'e', 'c', 'd'])
    })

    test.each([
        ['dropped where it already is', 'c', 'b', 'after'],
        ['dropped on itself', 'c', 'c', 'before'],
        ['a layer the order does not hold', 'zz', 'a', 'before'],
        // The row it was dropped on has left the order since the list was
        // drawn. Without the guard it would land on top of the stack.
        ['a row the order no longer holds', 'b', 'ghost', 'after'],
    ])('returns null for %s', (_label, id, overId, placement) => {
        expect(place(id, overId, placement)).toBeNull()
    })
})

describe('resolveDrop on a flat list', () => {
    const nodes = nodesOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }])

    test('dragged up lands before the row, dragged down after it', () => {
        expect(resolveDrop(nodes, 'c', 'a')).toBe('before')
        expect(resolveDrop(nodes, 'a', 'c')).toBe('after')
    })

    test.each([
        ['nothing under the drop', 'a', null],
        ['the row dropped on itself', 'b', 'b'],
        ['a row no longer listed', 'a', 'gone'],
    ])('is null for %s', (_label, active, over) => {
        expect(resolveDrop(nodes, active, over)).toBeNull()
    })
})

describe('treeAnnouncements on a flat list', () => {
    const say = treeAnnouncements(
        nodesOf([
            { id: 'u1', title: 'Flood Extent' },
            { id: 'u2', title: 'Rainfall' },
            { id: 'u3', title: 'Roads' },
        ]),
    )

    test('names the layer and its position from the top, never its id', () => {
        const heard = [
            say.onDragStart({ active: { id: 'u3' } }),
            say.onDragOver({ active: { id: 'u3' }, over: { id: 'u1' } }),
            say.onDragEnd({ active: { id: 'u3' }, over: { id: 'u1' } }),
            say.onDragCancel({ active: { id: 'u3' } }),
        ]
        expect(heard).toEqual([
            'Picked up Roads, position 3 of 3.',
            'Roads is at position 1 of 3.',
            'Dropped Roads at position 1 of 3.',
            'Cancelled. Roads stays at position 3 of 3.',
        ])
        heard.forEach((line) => expect(line).not.toContain('u3'))
    })

    test('with nothing under it, the layer is said to stay put', () => {
        expect(say.onDragOver({ active: { id: 'u2' }, over: null })).toBe('Rainfall is off the list.')
        expect(say.onDragEnd({ active: { id: 'u2' }, over: null })).toBe(
            'Dropped Rainfall back at position 2 of 3.',
        )
    })
})
