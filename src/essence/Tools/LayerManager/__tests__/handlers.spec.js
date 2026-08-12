import { test, expect } from 'vitest'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
} from '../adapters/handlers.ts'

const setupMock = (responses = {}, emitCalls = []) => {
    global.window = global.window || {}
    const requests = []
    global.window.mmgisAPI = {
        request: async (name, params) => {
            requests.push({ name, params })
            if (responses[name] !== undefined) {
                return typeof responses[name] === 'function' ? responses[name](params) : responses[name]
            }
            return null
        },
        hasHandler: (name) => responses[name] !== undefined,
        on: () => () => {},
        emit: (event, payload) => { emitCalls.push({ event, payload }) },
    }
    return { emitCalls, requests }
}

const EDITABLE = { hasColormap: true, canChangeColormap: true }
// What an image layer reports: a ramp to show, but nothing to change.
const READ_ONLY = { hasColormap: true, canChangeColormap: false }

// Core answers the capability handler per layer, resolving the identifier it
// is given; unknown layers get null.
const capabilities = (byLayer) => (layerId) => byLayer[layerId] ?? null

const COG_LAYER = {
    'layers:getCogCapabilities': capabilities({ layerA: EDITABLE }),
    'layers:updateConfig': true,
    'layers:refresh': true,
}

test.describe('handlers', () => {
    test('toggleVisibility issues layers:toggle and emits visibilityChange', async () => {
        const { emitCalls } = setupMock({ 'layers:toggle': true })
        await toggleVisibility('layerA')
        expect(emitCalls).toContainEqual({
            event: 'layer:visibilityChange',
            payload: { layerName: 'layerA', visible: true },
        })
    })

    test('setOpacity issues layers:setOpacity and emits opacityChange', async () => {
        const { emitCalls } = setupMock({ 'layers:setOpacity': true })
        await setOpacity('layerA', 0.5)
        expect(emitCalls).toContainEqual({
            event: 'layer:opacityChange',
            payload: { layerName: 'layerA', opacity: 0.5 },
        })
    })

    test('setColormap is a no-op when core reports the layer unchangeable', async () => {
        const { emitCalls } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: READ_ONLY }),
        })
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
    })

    // Core resolves the identifier, so the handler asks about one layer rather
    // than indexing a UUID-keyed map with whatever id the panel holds.
    test('setColormap asks core about the layer it is changing', async () => {
        const { requests } = setupMock(COG_LAYER)
        await setColormap('layerA', 'plasma', () => {})

        expect(requests[0]).toEqual({
            name: 'layers:getCogCapabilities',
            params: 'layerA',
        })
    })

    // Without the handler there is no way to know core can repaint the layer,
    // so the write is withheld rather than sent and silently dropped.
    test('setColormap is a no-op against a core without the capability handler', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setColormap('layerA', 'plasma', () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests).toHaveLength(0)
    })

    test('setColormap calls refresh on success', async () => {
        const { emitCalls } = setupMock(COG_LAYER)
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogColormapChange',
            payload: { layerName: 'layerA', colormap: 'plasma' },
        })
        expect(refreshCalled).toBe(true)
    })

    // applyCogFieldsToUrl prefers `currentCogColormap`, so a `cogColormap`
    // override would lose to the value the config write puts there.
    test('setColormap writes and refreshes on the same currentCogColormap field', async () => {
        const { requests } = setupMock(COG_LAYER)
        await setColormap('layerA', 'plasma', () => {})

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        const refresh = requests.find((r) => r.name === 'layers:refresh')
        expect(update.params).toEqual({
            layerUUID: 'layerA',
            updates: { currentCogColormap: 'plasma' },
        })
        expect(refresh.params).toEqual({
            layerUUID: 'layerA',
            options: { currentCogColormap: 'plasma' },
        })
    })

    test('setRescale writes and refreshes on the same currentCogMin/Max fields', async () => {
        const { requests, emitCalls } = setupMock(COG_LAYER)
        await setRescale('layerA', 0, 5, () => {})

        const update = requests.find((r) => r.name === 'layers:updateConfig')
        const refresh = requests.find((r) => r.name === 'layers:refresh')
        expect(update.params).toEqual({
            layerUUID: 'layerA',
            updates: { currentCogMin: 0, currentCogMax: 5 },
        })
        expect(refresh.params).toEqual({
            layerUUID: 'layerA',
            options: { currentCogMin: 0, currentCogMax: 5 },
        })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogRescaleChange',
            payload: { layerName: 'layerA', min: 0, max: 5 },
        })
    })

    test('setRescale is a no-op when core reports the layer unchangeable', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: READ_ONLY }),
        })
        let refreshCalled = false
        await setRescale('layerA', 0, 5, () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
        expect(requests.map((r) => r.name)).toEqual(['layers:getCogCapabilities'])
    })

    test('setRescale is a no-op against a core without the capability handler', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setRescale('layerA', 0, 5, () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests).toHaveLength(0)
    })

    // A layer core has never heard of answers null, which must read as
    // "cannot change" rather than throw.
    test('setColormap is a no-op for a layer core does not know', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getCogCapabilities': capabilities({ layerA: EDITABLE }),
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        await setColormap('layerB', 'plasma', () => {})
        expect(emitCalls).toHaveLength(0)
        expect(requests.map((r) => r.name)).toEqual(['layers:getCogCapabilities'])
    })
})
