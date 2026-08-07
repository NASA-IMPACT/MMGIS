import { test, expect } from 'vitest'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
} from '../../../src/essence/Tools/LayerManager/adapters/handlers.ts'

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
        on: () => () => {},
        emit: (event, payload) => { emitCalls.push({ event, payload }) },
    }
    return { emitCalls, requests }
}

const COG_LAYER = {
    'layers:getConfig': { cogTransform: true },
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

    test('setColormap is a no-op when layer has no cogTransform', async () => {
        const { emitCalls } = setupMock({ 'layers:getConfig': { cogTransform: false } })
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
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

    test('setRescale is a no-op when layer has no cogTransform', async () => {
        const { emitCalls, requests } = setupMock({
            'layers:getConfig': { cogTransform: false },
        })
        let refreshCalled = false
        await setRescale('layerA', 0, 5, () => { refreshCalled = true })
        expect(emitCalls).toHaveLength(0)
        expect(refreshCalled).toBe(false)
        expect(requests.map((r) => r.name)).toEqual(['layers:getConfig'])
    })
})
