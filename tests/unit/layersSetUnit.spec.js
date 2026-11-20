import { describe, test, expect, afterAll, vi } from 'vitest'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

const PM25 = 'AQS_PM25_0123456789abcdef'
const BARE = 'Bare_00000000000000000000'

let providers
let emitted

const withLayers = (data) => {
    L_.layers.data = data
    L_.layers.nameToUUID = Object.fromEntries(
        Object.entries(data).map(([uuid, cfg]) => [cfg.display_name ?? uuid, [uuid]])
    )
    providers = {}
    emitted = []
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
        emit: (event, payload) => emitted.push({ event, payload }),
    }
    L_.fina(null, null, null, null, null, null)
}

afterAll(() => {
    delete window.mmgisAPI
    L_.layers.data = {}
    L_.layers.nameToUUID = {}
})

const mission = () => ({
    [PM25]: {
        display_name: 'AQS Surface PM2.5',
        type: 'vectortile',
        variables: {
            unit: {
                sourceUnit: 'µg/m³',
                options: [{ label: 'mg/m³', scale: 0.001 }],
            },
        },
    },
    [BARE]: { type: 'vector' },
})

describe('layers:setUnit', () => {
    test('shows a layer in a listed unit and announces it', async () => {
        withLayers(mission())
        expect(await providers['layers:setUnit']({ layerUUID: PM25, unit: 'mg/m³' })).toBe(true)
        expect(L_.layers.data[PM25].currentUnit).toBe('mg/m³')
        expect(emitted).toEqual([
            { event: 'layers:configChanged', payload: { layerName: PM25, keys: ['currentUnit'] } },
            {
                event: 'layer:unitChange',
                payload: {
                    layerName: PM25,
                    unit: { sourceUnit: 'µg/m³', label: 'mg/m³', scale: 0.001, offset: 0 },
                },
            },
        ])
        // The answer core gives from now on follows the switch.
        expect((await providers['layers:getUnit'](PM25)).active.label).toBe('mg/m³')
    })

    test('switches back to the source unit by its label, resolving a display name', async () => {
        withLayers(mission())
        L_.layers.data[PM25].currentUnit = 'mg/m³'
        expect(
            await providers['layers:setUnit']({ layerUUID: 'AQS Surface PM2.5', unit: 'µg/m³' })
        ).toBe(true)
        expect(L_.layers.data[PM25].currentUnit).toBe('µg/m³')
        expect(emitted.at(-1).payload.unit.scale).toBe(1)
    })

    test('refuses a unit the layer does not list, a layer with no unit, and an unknown layer', async () => {
        withLayers(mission())
        expect(await providers['layers:setUnit']({ layerUUID: PM25, unit: 'ppb' })).toBe(false)
        expect(await providers['layers:setUnit']({ layerUUID: BARE, unit: 'ppb' })).toBe(false)
        expect(await providers['layers:setUnit']({ layerUUID: 'nope', unit: 'ppb' })).toBe(false)
        expect(await providers['layers:setUnit']()).toBe(false)
        expect(L_.layers.data[PM25].currentUnit).toBeUndefined()
        expect(emitted).toEqual([])
    })

    test('never re-requests tiles or recompiles a style', async () => {
        withLayers(mission())
        await providers['layers:setUnit']({ layerUUID: PM25, unit: 'mg/m³' })
        expect(emitted.map((e) => e.event)).not.toContain('layers:refresh')
        expect(L_.layers.data[PM25].cogMin).toBeUndefined()
    })
})
