import { describe, test, expect } from 'vitest'
import {
    sortByOrder,
    placeInOrder,
    dropIndex,
    orderAnnouncements,
} from '../../src/essence/Tools/LayerManager/lib/utils/layerOrder.ts'

/**
 * The LayerManager reads the draw order over the bus, shows its list top
 * first to match, and places a dragged layer relative to that list by
 * handing core a whole new order. The handler that does the reading and
 * writing is covered next to the other handlers in the plugin's own
 * __tests__.
 */

const byId = (ids) => ids.map((id) => ({ id }))

describe('sortByOrder', () => {
    test('sorts by the order, top first', () => {
        const sorted = sortByOrder(byId(['a', 'b', 'c']), ['c', 'a', 'b'])
        expect(sorted.map((l) => l.id)).toEqual(['c', 'a', 'b'])
    })

    test('keeps the list as given when core has no order to give', () => {
        expect(sortByOrder(byId(['b', 'a']), null).map((l) => l.id)).toEqual(['b', 'a'])
        expect(sortByOrder(byId(['b', 'a']), []).map((l) => l.id)).toEqual(['b', 'a'])
    })

    test('layers the order does not name follow the ranked ones, in their own order', () => {
        const sorted = sortByOrder(byId(['x', 'b', 'y', 'a']), ['a', 'b'])
        expect(sorted.map((l) => l.id)).toEqual(['a', 'b', 'x', 'y'])
    })

    test('does not mutate the input', () => {
        const layers = byId(['a', 'b'])
        sortByOrder(layers, ['b', 'a'])
        expect(layers.map((l) => l.id)).toEqual(['a', 'b'])
    })
})

describe('placeInOrder', () => {
    // Full order a..e; the user sees only a, c, e (b and d are filtered out).
    const order = ['a', 'b', 'c', 'd', 'e']
    const shown = ['a', 'c', 'e']

    test('dragged up, it lands just above the shown layer now below it', () => {
        expect(placeInOrder(order, shown, 'e', 1)).toEqual(['a', 'b', 'e', 'c', 'd'])
        expect(placeInOrder(order, shown, 'e', 0)).toEqual(['e', 'a', 'b', 'c', 'd'])
    })

    test('dragged down, it lands just below the shown layer now above it', () => {
        expect(placeInOrder(order, shown, 'a', 1)).toEqual(['b', 'c', 'a', 'd', 'e'])
    })

    test('an index past the end drops it last', () => {
        expect(placeInOrder(order, shown, 'a', 99)).toEqual(['b', 'c', 'd', 'e', 'a'])
    })

    // A drop at the top lands just above the first row shown; hidden layers
    // above it stay above.
    test('a drop at the top of a partial list lands above its first row', () => {
        expect(placeInOrder(order, ['c', 'e'], 'e', 0)).toEqual(['a', 'b', 'e', 'c', 'd'])
    })

    test.each([
        ['dropped where it already is', 'c', 1],
        ['a layer the list does not show', 'b', 0],
        ['a layer the order does not hold', 'zz', 0],
        ['the only shown layer', 'a', 0, ['a']],
        // The row it was dropped against has left the order since the list
        // was drawn. Without the guard it would land on top of the stack.
        ['a neighbour the order no longer holds', 'b', 4, ['a', 'b', 'c', 'd', 'ghost'], ['a', 'b', 'c', 'd']],
    ])('returns null for %s', (_label, id, toIndex, shownOverride, orderOverride) => {
        expect(
            placeInOrder(orderOverride ?? order, shownOverride ?? shown, id, toIndex),
        ).toBeNull()
    })
})

describe('dropIndex', () => {
    const ids = ['a', 'b', 'c']

    test('is the index of the row dropped on', () => {
        expect(dropIndex(ids, 'a', { id: 'c' })).toBe(2)
    })

    test.each([
        ['nothing under the drop', 'a', null],
        ['the row dropped on itself', 'b', { id: 'b' }],
        ['a row no longer listed', 'a', { id: 'gone' }],
    ])('is null for %s', (_label, active, over) => {
        expect(dropIndex(ids, active, over)).toBeNull()
    })
})

describe('orderAnnouncements', () => {
    const layers = [
        { id: 'u1', title: 'Flood Extent' },
        { id: 'u2', title: 'Rainfall' },
        { id: 'u3', title: 'Roads' },
    ]
    const say = orderAnnouncements(layers)

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

