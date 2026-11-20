import { describe, test, expect, afterAll, vi } from 'vitest'

// Same stub as layersGetLegend.spec: the provider never touches Map_, and
// Map_ pulls in JSX Vite will not parse from a .js file.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

const PM25 = 'AQS_PM25_0123456789abcdef'
const NAQFC = 'NAQFC_PM25_fedcba9876543210'
const BARE = 'Bare_00000000000000000000'

let providers

const withLayers = (data) => {
    L_.layers.data = data
    L_.layers.nameToUUID = Object.fromEntries(
        Object.entries(data).map(([uuid, cfg]) => [cfg.display_name ?? uuid, [uuid]])
    )
    providers = {}
    window.mmgisAPI = {
        provide: (name, fn) => {
            providers[name] = fn
            return () => {}
        },
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
                source_unit: 'µg/m³',
                options: [{ label: 'mg/m³', scale: 0.001 }],
            },
        },
    },
    [NAQFC]: { type: 'tile', cogUnits: 'μg/m³' },
    [BARE]: { type: 'vector' },
})

describe('layers:getUnit', () => {
    test('answers one layer with its source, active unit and options', async () => {
        withLayers(mission())
        expect(await providers['layers:getUnit'](PM25)).toEqual({
            source_unit: 'µg/m³',
            active: { source_unit: 'µg/m³', label: 'µg/m³', scale: 1, offset: 0 },
            options: [
                { label: 'µg/m³', scale: 1, offset: 0 },
                { label: 'mg/m³', scale: 0.001, offset: 0 },
            ],
        })
    })

    test('resolves a display name like every other layer-keyed provider', async () => {
        withLayers(mission())
        const byName = await providers['layers:getUnit']('AQS Surface PM2.5')
        expect(byName.source_unit).toBe('µg/m³')
    })

    test('reads the live currentUnit each time it is asked', async () => {
        withLayers(mission())
        L_.layers.data[PM25].currentUnit = 'mg/m³'
        const answer = await providers['layers:getUnit'](PM25)
        expect(answer.active).toEqual({
            source_unit: 'µg/m³',
            label: 'mg/m³',
            scale: 0.001,
            offset: 0,
        })
    })

    test('a raster with only cogUnits answers one option, the source', async () => {
        withLayers(mission())
        const answer = await providers['layers:getUnit'](NAQFC)
        expect(answer.source_unit).toBe('μg/m³')
        expect(answer.options).toHaveLength(1)
    })

    test('null for a layer with no unit and for an unknown layer', async () => {
        withLayers(mission())
        expect(await providers['layers:getUnit'](BARE)).toBeNull()
        expect(await providers['layers:getUnit']('nope')).toBeNull()
    })

    test('called with no argument answers every layer keyed by UUID', async () => {
        withLayers(mission())
        const all = await providers['layers:getUnit']()
        expect(Object.keys(all).sort()).toEqual([PM25, NAQFC, BARE].sort())
        expect(all[BARE]).toBeNull()
        expect(all[NAQFC].source_unit).toBe('μg/m³')
    })
})
