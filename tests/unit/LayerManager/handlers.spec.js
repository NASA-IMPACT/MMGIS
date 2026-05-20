import { test, expect } from '@playwright/test'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
} from '../../../src/essence/Tools/LayerManager/adapters/handlers.ts'

const setupMock = (responses = {}, emitCalls = []) => {
    global.window = global.window || {}
    global.window.mmgisAPI = {
        request: async (name, params) => {
            if (responses[name] !== undefined) {
                return typeof responses[name] === 'function' ? responses[name](params) : responses[name]
            }
            return null
        },
        on: () => () => {},
        emit: (event, payload) => { emitCalls.push({ event, payload }) },
    }
    return { emitCalls }
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
        const { emitCalls } = setupMock({
            'layers:getConfig': { cogTransform: true },
            'layers:updateConfig': true,
            'layers:refresh': true,
        })
        let refreshCalled = false
        await setColormap('layerA', 'plasma', () => { refreshCalled = true })
        expect(emitCalls).toContainEqual({
            event: 'layer:cogColormapChange',
            payload: { layerName: 'layerA', colormap: 'plasma' },
        })
        expect(refreshCalled).toBe(true)
    })
})
