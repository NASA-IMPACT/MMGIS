import { describe, test, expect, beforeEach, vi } from 'vitest'
import { sortByOrder, moveInOrder } from '../../src/essence/Tools/LayerManager/lib/utils/layerOrder.ts'

/**
 * The LayerManager reads the draw order over the bus, shows its list top
 * first to match, and moves a layer one step past its neighbour in that
 * list — or all the way to an end — by handing core a whole new order.
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

describe('moveInOrder', () => {
    // Full order a..e; the user sees only a, c, e (b and d are filtered out).
    const order = ['a', 'b', 'c', 'd', 'e']
    const shown = ['a', 'c', 'e']

    test('up places the layer just above its neighbour in the list shown', () => {
        expect(moveInOrder(order, shown, 'e', 'up')).toEqual(['a', 'b', 'e', 'c', 'd'])
    })

    test('down places the layer just below its neighbour in the list shown', () => {
        expect(moveInOrder(order, shown, 'a', 'down')).toEqual(['b', 'c', 'a', 'd', 'e'])
    })

    test('top and bottom go all the way', () => {
        expect(moveInOrder(order, shown, 'c', 'top')).toEqual(['c', 'a', 'b', 'd', 'e'])
        expect(moveInOrder(order, shown, 'c', 'bottom')).toEqual(['a', 'b', 'd', 'e', 'c'])
    })

    test.each([
        ['up at the top of the list', 'a', 'up'],
        ['down at the bottom of the list', 'e', 'down'],
        ['top when already first', 'a', 'top'],
        ['bottom when already last', 'e', 'bottom'],
        ['a layer the list does not show', 'b', 'up'],
        ['a layer the order does not hold', 'zz', 'top'],
    ])('returns null for %s', (_label, id, action) => {
        expect(moveInOrder(order, shown, id, action)).toBeNull()
    })

    test('does not mutate the input', () => {
        const before = [...order]
        moveInOrder(order, shown, 'e', 'up')
        expect(order).toEqual(before)
    })
})

describe('moveLayer handler', () => {
    let getOrder
    let setOrder
    let moveLayer

    beforeEach(async () => {
        vi.resetModules()
        getOrder = vi.fn()
        setOrder = vi.fn(async () => true)
        vi.doMock('../../src/essence/Tools/_shared/adapters/mmgisAPI', () => ({
            mmgisRequest: vi.fn(),
            mmgisEmit: vi.fn(),
            mmgisShowPlugin: vi.fn(),
            mmgisGetLayerCogCapabilities: vi.fn(),
            mmgisGetLayerBounds: vi.fn(),
            mmgisFitBounds: vi.fn(),
            mmgisGetLayerOrder: getOrder,
            mmgisSetLayerOrder: setOrder,
        }))
        ;({ moveLayer } = await import('../../src/essence/Tools/LayerManager/adapters/handlers.ts'))
    })

    test('reads the order from core and writes the moved one back', async () => {
        getOrder.mockResolvedValue(['a', 'b', 'c'])

        await moveLayer('c', 'up', ['a', 'b', 'c'])

        expect(setOrder).toHaveBeenCalledWith(['a', 'c', 'b'])
    })

    test('writes nothing when there is nowhere to go', async () => {
        getOrder.mockResolvedValue(['a', 'b', 'c'])

        await moveLayer('a', 'up', ['a', 'b', 'c'])

        expect(setOrder).not.toHaveBeenCalled()
    })

    test('writes nothing when core is too old to have an order', async () => {
        getOrder.mockResolvedValue(null)

        await moveLayer('a', 'down', ['a', 'b'])

        expect(setOrder).not.toHaveBeenCalled()
    })

    test('logs a refusal rather than throwing', async () => {
        getOrder.mockResolvedValue(['a', 'b'])
        setOrder.mockResolvedValue(false)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await expect(moveLayer('b', 'up', ['a', 'b'])).resolves.toBeUndefined()

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('b')
        warn.mockRestore()
    })
})
