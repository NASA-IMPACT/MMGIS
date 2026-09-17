import { describe, test, expect } from 'vitest'
import { sortByOrder } from '../../src/essence/Tools/LayerManager/lib/utils/layerOrder.ts'

/**
 * The LayerManager reads the draw order over the bus and shows its list top
 * first to match. Ids the order does not name keep their place after the
 * ranked ones, and a core with no order to give leaves the list as it came.
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
