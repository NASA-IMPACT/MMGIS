import { describe, test, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:toggleGroup`: switches a whole group over the configured grouping,
 * reaching every layer in the group, nested groups included. Switching a
 * layer itself is core's toggle, stubbed here to flip the flag it keeps.
 */

let providers

const node = (uuid, extra = {}) => ({ name: uuid, display_name: uuid.toUpperCase(), type: 'tile', ...extra })
const header = (uuid, sublayers) => node(uuid, { type: 'header', sublayers })

// Air Quality holds AQS (pm, o3) and a forecast layer; a basemap is ungrouped.
const load = () => {
    const layers = [
        header('aq', [header('aqs', [node('pm'), node('o3')]), node('fc')]),
        node('base'),
    ]
    L_.configData = { layers }
    L_.layers.data = {}
    L_.layers.nameToUUID = { AQ: ['aq'] }
    const register = (nodes) =>
        nodes.forEach((n) => {
            L_.layers.data[n.name] = n
            register(n.sublayers || [])
        })
    register(layers)
}

const turnOn = (...ids) => {
    L_.layers.on = { aq: true, aqs: true, pm: false, o3: false, fc: false, base: false }
    ids.forEach((id) => (L_.layers.on[id] = true))
}

const onNow = () => ['pm', 'o3', 'fc', 'base'].filter((id) => L_.layers.on[id])

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
    L_.layers.groupRestore = {}
    load()
    vi.restoreAllMocks()
    vi.spyOn(L_, 'toggleLayer').mockImplementation(async (layer) => {
        L_.layers.on[layer.name] = !L_.layers.on[layer.name]
    })
})

describe('layers:toggleGroup', () => {
    test('switches off every layer on in the group, nested groups included', async () => {
        turnOn('pm', 'fc', 'base')
        const result = await providers['layers:toggleGroup']('aq')
        expect(result).toEqual({ visible: false, changed: ['pm', 'fc'] })
        expect(onNow()).toEqual(['base'])
    })

    test('switching back on restores exactly the layers that were on', async () => {
        turnOn('pm', 'fc')
        await providers['layers:toggleGroup']('aq')
        const result = await providers['layers:toggleGroup']('aq')
        expect(result).toEqual({ visible: true, changed: ['pm', 'fc'] })
        expect(onNow()).toEqual(['pm', 'fc'])
    })

    test('with nothing remembered, switching on turns every layer on', async () => {
        turnOn()
        const result = await providers['layers:toggleGroup']('aq')
        expect(result).toEqual({ visible: true, changed: ['pm', 'o3', 'fc'] })
    })

    test('a layer turned on by itself after the group went off makes the next switch an off', async () => {
        turnOn('pm')
        await providers['layers:toggleGroup']('aq')
        L_.layers.on.o3 = true
        const result = await providers['layers:toggleGroup']('aq')
        expect(result).toEqual({ visible: false, changed: ['o3'] })

        await providers['layers:toggleGroup']('aq')
        expect(onNow()).toEqual(['o3'])
    })

    test('a nested group switches only its own layers', async () => {
        turnOn('pm', 'o3', 'fc')
        await providers['layers:toggleGroup']('aqs')
        expect(onNow()).toEqual(['fc'])
    })

    test('a group is found by its display name too', async () => {
        turnOn('pm')
        expect(await providers['layers:toggleGroup']('AQ')).toEqual({
            visible: false,
            changed: ['pm'],
        })
    })

    test('a layer that fails to switch is not reported as changed', async () => {
        turnOn()
        L_.toggleLayer.mockImplementation(async (layer) => {
            if (layer.name !== 'o3') L_.layers.on[layer.name] = true
        })
        expect(await providers['layers:toggleGroup']('aqs')).toEqual({
            visible: true,
            changed: ['pm'],
        })
    })

    test('an unknown group or a plain layer answers null', async () => {
        turnOn('pm')
        expect(await providers['layers:toggleGroup']('ghost')).toBeNull()
        expect(await providers['layers:toggleGroup']('base')).toBeNull()
        expect(L_.toggleLayer).not.toHaveBeenCalled()
    })
})
