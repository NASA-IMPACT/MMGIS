import { describe, test, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:getTree`: the configured grouping a layer list draws from, as ids
 * only. The parsed config holds each node under its UUID as `name`; the tree
 * is read from there.
 */

let providers

const node = (uuid, display, extra = {}) => ({
    name: uuid,
    display_name: display,
    type: 'tile',
    ...extra,
})
const header = (uuid, display, sublayers) =>
    node(uuid, display, { type: 'header', sublayers })

const load = (layers) => {
    L_.configData = { layers }
    L_.layers.data = {}
    const register = (nodes) =>
        nodes.forEach((n) => {
            L_.layers.data[n.name] = n
            register(n.sublayers || [])
        })
    register(layers)
}

beforeEach(() => {
    providers = {}
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: () => {},
    }
    L_.fina(null, { engine: {} }, null, null, null, {})
})

describe('layers:getTree', () => {
    test('headers become groups holding their children, nested in config order', () => {
        load([
            header('aq-uuid', 'Air Quality', [
                header('aqs-uuid', 'AQS', [node('pm25-uuid', 'PM2.5'), node('o3-uuid', 'Ozone')]),
                node('fc-uuid', 'Forecast'),
            ]),
            node('base-uuid', 'Basemap'),
        ])
        expect(providers['layers:getTree']()).toEqual([
            {
                kind: 'group',
                id: 'aq-uuid',
                children: [
                    {
                        kind: 'group',
                        id: 'aqs-uuid',
                        children: [
                            { kind: 'layer', id: 'pm25-uuid' },
                            { kind: 'layer', id: 'o3-uuid' },
                        ],
                    },
                    { kind: 'layer', id: 'fc-uuid' },
                ],
            },
            { kind: 'layer', id: 'base-uuid' },
        ])
    })

    test('a header with no sublayers is an empty group', () => {
        load([header('empty-uuid', 'Empty')])
        expect(providers['layers:getTree']()).toEqual([
            { kind: 'group', id: 'empty-uuid', children: [] },
        ])
    })

    test('nodes core does not know are left out', () => {
        load([node('a-uuid', 'A')])
        L_.configData.layers.push(node('ghost-uuid', 'Ghost'))
        expect(providers['layers:getTree']()).toEqual([{ kind: 'layer', id: 'a-uuid' }])
    })

    test('children nested under a plain layer are listed beside it', () => {
        load([node('a-uuid', 'A', { sublayers: [node('b-uuid', 'B')] })])
        expect(providers['layers:getTree']()).toEqual([
            { kind: 'layer', id: 'a-uuid' },
            { kind: 'layer', id: 'b-uuid' },
        ])
    })

    test('no config answers an empty tree', () => {
        L_.configData = null
        expect(providers['layers:getTree']()).toEqual([])
    })

    test('the answer is a fresh copy', () => {
        load([header('h-uuid', 'H', [node('a-uuid', 'A')])])
        const tree = providers['layers:getTree']()
        tree[0].children.length = 0
        expect(providers['layers:getTree']()[0].children).toHaveLength(1)
    })
})
