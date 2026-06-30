import { test, expect } from '@playwright/test'
import { DeckGLAdapter } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'
// Import MAP_ENGINE from the lightweight types module rather than MapEngines/index.ts.
// index.ts transitively imports LeafletAdapter -> leaflet, which references a global
// `window` at module-eval time and fails in this Node test context.
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'

function makeAdapter({ longitude = -120, latitude = 40, zoom = 5 } = {}) {
    const adapter = new DeckGLAdapter()
    adapter._viewState = { longitude, latitude, zoom, bearing: 0, pitch: 0 }
    return adapter
}

function makeLayer(id, props = {}) {
    return { id, ...props, clone: (overrides = {}) => makeLayer(id, { ...props, ...overrides }) }
}

test.describe('DeckGLAdapter', () => {
    test.describe('engineType', () => {
        test('is deckgl', () => {
            expect(new DeckGLAdapter().engineType).toBe(MAP_ENGINE.DECKGL)
        })
    })

    test.describe('view state getters', () => {
        test('getZoom returns the current zoom', () => {
            expect(makeAdapter({ zoom: 7 }).getZoom()).toBe(7)
        })

        test('getCenter returns lat and lng from view state', () => {
            expect(makeAdapter().getCenter()).toEqual({ lat: 40, lng: -120 })
        })

        test('getMinZoom and getMaxZoom return defaults before init', () => {
            const adapter = new DeckGLAdapter()
            expect(adapter.getMinZoom()).toBe(0)
            expect(adapter.getMaxZoom()).toBe(20)
        })

        test('getViewState maps internal state to the engine-agnostic shape', () => {
            const state = makeAdapter({ longitude: 10, latitude: 20, zoom: 4 }).getViewState()
            expect(state.center).toEqual({ lat: 20, lng: 10 })
            expect(state.zoom).toBe(4)
            expect(state.bearing).toBe(0)
            expect(state.pitch).toBe(0)
        })
    })

    test.describe('view state setters', () => {
        test('setZoom updates the zoom', () => {
            const adapter = makeAdapter()
            adapter.setZoom(12)
            expect(adapter.getZoom()).toBe(12)
        })

        test('setCenter updates longitude and latitude', () => {
            const adapter = makeAdapter()
            adapter.setCenter({ lat: 51.5, lng: -0.12 })
            expect(adapter.getCenter()).toEqual({ lat: 51.5, lng: -0.12 })
        })

        test('setCenter accepts a [lat, lng] tuple', () => {
            const adapter = makeAdapter()
            adapter.setCenter([34, -118])
            expect(adapter.getCenter()).toEqual({ lat: 34, lng: -118 })
        })

        test('setView updates both center and zoom', () => {
            const adapter = makeAdapter()
            adapter.setView({ lat: 48.8, lng: 2.35 }, 9)
            expect(adapter.getCenter()).toEqual({ lat: 48.8, lng: 2.35 })
            expect(adapter.getZoom()).toBe(9)
        })

        test('setViewState updates center, zoom, bearing, and pitch', () => {
            const adapter = makeAdapter()
            adapter.setViewState({ center: { lat: 35, lng: 139 }, zoom: 6, bearing: 45, pitch: 30 })
            const state = adapter.getViewState()
            expect(state.center).toEqual({ lat: 35, lng: 139 })
            expect(state.zoom).toBe(6)
            expect(state.bearing).toBe(45)
            expect(state.pitch).toBe(30)
        })
    })

    test.describe('layer management', () => {
        test('hasLayer returns false before any layer is added', () => {
            expect(makeAdapter().hasLayer('anything')).toBe(false)
        })

        test('addLayer makes hasLayer return true by id', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('layer-a'))
            expect(adapter.hasLayer('layer-a')).toBe(true)
        })

        test('hasLayer accepts a layer object', () => {
            const adapter = makeAdapter()
            const layer = makeLayer('layer-b')
            adapter.addLayer(layer)
            expect(adapter.hasLayer(layer)).toBe(true)
        })

        test('getLayers returns all added layers', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('x'))
            adapter.addLayer(makeLayer('y'))
            const ids = adapter.getLayers().map((l) => l.id)
            expect(ids).toContain('x')
            expect(ids).toContain('y')
            expect(ids).toHaveLength(2)
        })

        test('removeLayer by id removes the layer', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('layer-1'))
            adapter.removeLayer('layer-1')
            expect(adapter.hasLayer('layer-1')).toBe(false)
        })

        test('removeLayer by layer object removes the layer', () => {
            const adapter = makeAdapter()
            const layer = makeLayer('layer-2')
            adapter.addLayer(layer)
            adapter.removeLayer(layer)
            expect(adapter.hasLayer('layer-2')).toBe(false)
        })

        test('bringToFront moves the layer to the end of getLayers', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('a'))
            adapter.addLayer(makeLayer('b'))
            adapter.addLayer(makeLayer('c'))
            adapter.bringToFront('a')
            const ids = adapter.getLayers().map((l) => l.id)
            expect(ids[ids.length - 1]).toBe('a')
        })

        test('bringToBack moves the layer to the start of getLayers', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('a'))
            adapter.addLayer(makeLayer('b'))
            adapter.addLayer(makeLayer('c'))
            adapter.bringToBack('c')
            const ids = adapter.getLayers().map((l) => l.id)
            expect(ids[0]).toBe('c')
        })

        test('updateLayer with visible:false keeps layer in registry', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('toggle-layer'))
            adapter.updateLayer('toggle-layer', { visible: false })
            expect(adapter.hasLayer('toggle-layer')).toBe(true)
        })

        test('updateLayer with visible:false sets visible prop on the stored layer', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('toggle-layer'))
            adapter.updateLayer('toggle-layer', { visible: false })
            const stored = adapter.getLayers().find((l) => l.id === 'toggle-layer')
            expect(stored.visible).toBe(false)
        })

        test('addLayer after updateLayer visible:false restores original layer', () => {
            const adapter = makeAdapter()
            const original = makeLayer('toggle-layer')
            adapter.addLayer(original)
            adapter.updateLayer('toggle-layer', { visible: false })
            adapter.addLayer(original)
            const stored = adapter.getLayers().find((l) => l.id === 'toggle-layer')
            expect(stored.visible).toBeUndefined()
        })

        test('updateLayer on unknown id returns undefined without throwing', () => {
            const adapter = makeAdapter()
            expect(adapter.updateLayer('nonexistent', { visible: false })).toBeUndefined()
        })
    })

    test.describe('event system', () => {
        test('emit calls registered handlers with data', () => {
            const adapter = makeAdapter()
            const received = []
            adapter.on('moveend', (data) => received.push(data))
            adapter.emit('moveend', { zoom: 5 })
            expect(received).toHaveLength(1)
            expect(received[0]).toEqual({ zoom: 5 })
        })

        test('off with a handler removes only that handler', () => {
            const adapter = makeAdapter()
            const calls = []
            const h1 = () => calls.push('h1')
            const h2 = () => calls.push('h2')
            adapter.on('test', h1)
            adapter.on('test', h2)
            adapter.off('test', h1)
            adapter.emit('test')
            expect(calls).toEqual(['h2'])
        })

        test('off without a handler removes all handlers for the event', () => {
            const adapter = makeAdapter()
            let fired = false
            adapter.on('test', () => { fired = true })
            adapter.off('test')
            adapter.emit('test')
            expect(fired).toBe(false)
        })

        test('once option fires the handler only once', () => {
            const adapter = makeAdapter()
            let count = 0
            adapter.on('ping', () => count++, { once: true })
            adapter.emit('ping')
            adapter.emit('ping')
            expect(count).toBe(1)
        })
    })

    test.describe('captureScreenshot', () => {
        test('overlay mode reads the basemap GL canvas after a redraw', async () => {
            const adapter = makeAdapter()
            let redrawn = false
            const canvas = {
                toDataURL: (type) => {
                    expect(type).toBe('image/png')
                    // Only valid once a render has occurred this frame.
                    return redrawn
                        ? 'data:image/png;base64,DECKGL'
                        : 'data:image/png;base64,BLANK'
                },
            }
            adapter._isOverlayMode = true
            adapter._basemap = {
                redraw: () => { redrawn = true },
                getCanvas: () => canvas,
            }

            const result = await adapter.captureScreenshot()
            expect(redrawn).toBe(true)
            expect(result).toBe('data:image/png;base64,DECKGL')
        })

        test('overlay mode without redraw() falls back to triggerRepaint + rAF', async () => {
            global.requestAnimationFrame =
                global.requestAnimationFrame || ((cb) => setTimeout(() => cb(0), 0))
            const adapter = makeAdapter()
            let repainted = false
            adapter._isOverlayMode = true
            adapter._basemap = {
                triggerRepaint: () => { repainted = true },
                getCanvas: () => ({ toDataURL: () => 'data:image/png;base64,RAF' }),
            }

            const result = await adapter.captureScreenshot()
            expect(repainted).toBe(true)
            expect(result).toBe('data:image/png;base64,RAF')
        })

        test('standalone mode redraws deck and reads its canvas', async () => {
            const adapter = makeAdapter()
            let redrawArg = null
            adapter._isOverlayMode = false
            adapter._deck = {
                redraw: (reason) => { redrawArg = reason },
                getCanvas: () => ({ toDataURL: () => 'data:image/png;base64,STANDALONE' }),
            }

            const result = await adapter.captureScreenshot()
            expect(redrawArg).toBe('screenshot')
            expect(result).toBe('data:image/png;base64,STANDALONE')
        })

        test('rejects when there is no active map to capture', async () => {
            const adapter = makeAdapter()
            adapter._isOverlayMode = false
            adapter._deck = null
            await expect(adapter.captureScreenshot()).rejects.toThrow(/no active map/)
        })
    })

    test.describe('destroy', () => {
        test('clears all layers', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('x'))
            adapter.destroy()
            expect(adapter.getLayers()).toHaveLength(0)
        })

        test('clears event listeners so handlers no longer fire', () => {
            const adapter = makeAdapter()
            let fired = false
            adapter.on('test', () => { fired = true })
            adapter.destroy()
            adapter.emit('test')
            expect(fired).toBe(false)
        })
    })
})
