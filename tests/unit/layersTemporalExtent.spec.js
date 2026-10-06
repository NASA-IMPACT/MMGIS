import { describe, test, expect, beforeEach, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself — it reads `L_.Map_` — so a
// bare stub is enough to keep the graph loadable.
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * `layers:getTemporalExtent` carries `periodAnchor` only for a layer core
 * requests one period at a time: a type that takes periods, with a cadence
 * of an hour or more and no readable Data Dates. It is then the instant the
 * periods step from, or null when they cannot be placed. Every other
 * layer's extent has no such key, so a timeline anchors its row as it would
 * for any layer.
 */

let providers

const register = (layers) => {
    L_.layers.data = layers
    L_.layers.nameToUUID = {}
    // Registers the layer providers the way layersRefreshProvider.spec
    // does; the collaborators are unread by this handler.
    L_.fina(null, { engine: {}, nativeLayer: (l) => l }, null, null, null, {})
}

const layer = (type, time) => ({
    name: 'layer',
    type,
    time: { enabled: true, type: 'requery', ...time },
})

beforeEach(() => {
    providers = {}
    window.mmgisAPI = {
        emit: vi.fn(),
        provide: vi.fn((name, handler) => {
            providers[name] = handler
            return () => delete providers[name]
        }),
    }
})

describe('layers:getTemporalExtent periodAnchor', () => {
    test('a periodic vector layer with a policy start steps from the epoch', () => {
        register({
            layer: layer('vector', { interval: 'P1D', dataStartTime: 'now - P30D' }),
        })
        const extent = providers['layers:getTemporalExtent']('layer')
        expect(extent.periodAnchor).toBe('1970-01-01T00:00:00Z')
        expect(extent.interval).toMatchObject({ days: 1 })
    })

    test('a periodic vector layer with a fixed start steps from it', () => {
        register({
            layer: layer('vector', {
                interval: 'P7D',
                dataStartTime: '2024-01-03T06:00:00Z',
            }),
        })
        expect(providers['layers:getTemporalExtent']('layer').periodAnchor).toBe(
            '2024-01-03T06:00:00Z'
        )
    })

    test('a period cadence that cannot be placed answers null', () => {
        register({
            layer: layer('vector', { interval: 'P7D', dataStartTime: 'now - P1Y' }),
        })
        const extent = providers['layers:getTemporalExtent']('layer')
        expect('periodAnchor' in extent).toBe(true)
        expect(extent.periodAnchor).toBeNull()
    })

    test('a type that takes no period carries no key', () => {
        register({
            layer: layer('query', {
                interval: 'P1D',
                dataStartTime: '2024-01-01T00:00:00Z',
            }),
        })
        expect('periodAnchor' in providers['layers:getTemporalExtent']('layer')).toBe(
            false
        )
    })

    test('a cadence shorter than an hour carries no key', () => {
        register({ layer: layer('vector', { interval: 'PT30M' }) })
        expect('periodAnchor' in providers['layers:getTemporalExtent']('layer')).toBe(
            false
        )
    })

    test('a layer listing Data Dates carries no key', () => {
        register({
            layer: layer('vector', { interval: 'P1D', dataDates: ['2025-03-03'] }),
        })
        expect('periodAnchor' in providers['layers:getTemporalExtent']('layer')).toBe(
            false
        )
    })

    test('the bulk answer carries the key per layer the same way', () => {
        register({
            daily: layer('vector', { interval: 'P1D' }),
            plain: layer('vector', {}),
        })
        const all = providers['layers:getTemporalExtent']()
        expect(all.daily.periodAnchor).toBe('1970-01-01T00:00:00Z')
        expect('periodAnchor' in all.plain).toBe(false)
    })
})
