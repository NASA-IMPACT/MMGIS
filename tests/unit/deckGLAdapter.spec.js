import { test, expect, vi } from 'vitest'
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

        test('setLayerOpacity sets opacity on the stored layer', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('opacity-layer'))
            adapter.setLayerOpacity('opacity-layer', 0.4)
            const stored = adapter.getLayers().find((l) => l.id === 'opacity-layer')
            expect(stored.opacity).toBe(0.4)
        })

        test('setLayerOpacity returns the instance carrying the new opacity', () => {
            const adapter = makeAdapter()
            const original = makeLayer('opacity-layer')
            adapter.addLayer(original)
            const updated = adapter.setLayerOpacity(original, 0.25)
            expect(updated.opacity).toBe(0.25)
            expect(updated).not.toBe(original)
            expect(original.opacity).toBeUndefined()
        })

        test('setLayerOpacity accepts 0 rather than treating it as unset', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('opacity-layer'))
            adapter.setLayerOpacity('opacity-layer', 0)
            const stored = adapter.getLayers().find((l) => l.id === 'opacity-layer')
            expect(stored.opacity).toBe(0)
        })

        test('setLayerOpacity clones an unmounted layer without adding it to the map', () => {
            const adapter = makeAdapter()
            const offMap = makeLayer('hidden-layer')
            const updated = adapter.setLayerOpacity(offMap, 0.6)
            expect(updated.opacity).toBe(0.6)
            expect(adapter.hasLayer('hidden-layer')).toBe(false)
        })

        test('setLayerOpacity on an unknown id returns undefined without throwing', () => {
            const adapter = makeAdapter()
            expect(adapter.setLayerOpacity('nonexistent', 0.5)).toBeUndefined()
        })

        test('setLayerOpacity on a value with nothing to clone returns undefined without throwing', () => {
            const adapter = makeAdapter()
            expect(() => adapter.setLayerOpacity(false, 0.5)).not.toThrow()
            expect(adapter.setLayerOpacity(false, 0.5)).toBeUndefined()
        })

        test('setLayerZIndex keeps a layer with no z-index above the ordered stack', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('data-layer'))
            adapter.setLayerZIndex('data-layer', 2)
            adapter.addLayer(makeLayer('aoi:selection'))
            // Unhiding a data layer re-applies its z-index, re-sorting the registry.
            adapter.updateLayer('data-layer', { visible: true })
            adapter.setLayerZIndex('data-layer', 2)
            const ids = adapter.getLayers().map((l) => l.id)
            expect(ids[ids.length - 1]).toBe('aoi:selection')
        })

        test('setLayerZIndex orders layers that have one by ascending z-index', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('top'))
            adapter.addLayer(makeLayer('bottom'))
            adapter.setLayerZIndex('top', 5)
            adapter.setLayerZIndex('bottom', 1)
            expect(adapter.getLayers().map((l) => l.id)).toEqual(['bottom', 'top'])
        })

        test('a re-sort of a startup-ranked stack keeps the ranks ascending and the overlay on top', () => {
            const adapter = makeAdapter()
            // Startup ranks every mission layer as it is added.
            adapter.addLayer(makeLayer('above'))
            adapter.setLayerZIndex('above', 2)
            adapter.addLayer(makeLayer('below'))
            adapter.setLayerZIndex('below', 1)
            adapter.addLayer(makeLayer('aoi:selection'))
            // Unhiding a mission layer re-applies its z-index, re-sorting the registry.
            adapter.setLayerZIndex('above', 2)
            expect(adapter.getLayers().map((l) => l.id)).toEqual([
                'below',
                'above',
                'aoi:selection',
            ])
        })

        test('a re-sort keeps two layers with no z-index in the order they were added', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('mission'))
            adapter.setLayerZIndex('mission', 1)
            adapter.addLayer(makeLayer('aoi:selection'))
            adapter.addLayer(makeLayer('draw:preview'))
            adapter.setLayerZIndex('mission', 1)
            expect(adapter.getLayers().map((l) => l.id)).toEqual([
                'mission',
                'aoi:selection',
                'draw:preview',
            ])
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

    test.describe('drawing overlay stacking', () => {
        const ANCHOR_ID = 'td-polygon'

        // Enough of the maplibre Map surface for TerraDrawMapLibreGLAdapter to
        // construct, register its layers, and tear them down. Registered ids are
        // tracked so getLayer() answers like a real style does.
        function makeDrawingBasemap() {
            const canvas = document.createElement('canvas')
            const container = document.createElement('div')
            const styleLayers = new Set()
            return {
                getContainer: () => container,
                getCanvas: () => canvas,
                dragRotate: { isEnabled: () => true, enable: () => {}, disable: () => {} },
                dragPan: { isEnabled: () => true, enable: () => {}, disable: () => {} },
                doubleClickZoom: { enable: () => {}, disable: () => {} },
                addSource: vi.fn(),
                addLayer: vi.fn((layer) => styleLayers.add(layer.id)),
                removeLayer: vi.fn((id) => styleLayers.delete(id)),
                removeSource: vi.fn(),
                getLayer: (id) => (styleLayers.has(id) ? { id } : undefined),
                getSource: () => ({ setData: () => {} }),
                setStyle: vi.fn(() => styleLayers.clear()),
                version: '5.8.0',
            }
        }

        function makeDrawingAdapter() {
            const adapter = makeAdapter()
            adapter._isOverlayMode = true
            adapter._basemap = makeDrawingBasemap()
            adapter._overlay = { setProps: vi.fn() }
            return adapter
        }

        function lastSyncedLayers(adapter) {
            const calls = adapter._overlay.setProps.mock.calls
            return calls[calls.length - 1][0].layers
        }

        test('enableDrawing anchors every deck layer below the terra-draw stack', () => {
            const adapter = makeDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.addLayer(makeLayer('vector'))
            adapter.enableDrawing('polygon')
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([
                ANCHOR_ID,
                ANCHOR_ID,
            ])
        })

        test('the anchor id matches the bottom-most layer terra-draw registers', () => {
            const adapter = makeDrawingAdapter()
            adapter.enableDrawing('polygon')
            expect(adapter._basemap.addLayer.mock.calls[0][0].id).toBe('td-polygon')
        })

        test('layers added mid-draw are anchored too', () => {
            const adapter = makeDrawingAdapter()
            adapter.enableDrawing('rectangle')
            adapter.addLayer(makeLayer('added-mid-draw'))
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([ANCHOR_ID])
        })

        test('no anchor is stamped while the terra-draw layers are out of the style', () => {
            const adapter = makeDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.enableDrawing('polygon')
            adapter._basemap.getLayer = () => undefined
            adapter.addLayer(makeLayer('added-after-wipe'))
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([
                undefined,
                undefined,
            ])
        })

        test('setBasemapStyle drops the anchor before the swap wipes the terra-draw layers', () => {
            const adapter = makeDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.enableDrawing('polygon')
            adapter.setBasemapStyle('https://example.com/style.json')
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([undefined])
            expect(adapter._overlay.setProps.mock.invocationCallOrder.at(-1)).toBeLessThan(
                adapter._basemap.setStyle.mock.invocationCallOrder[0]
            )
        })

        test('setBasemapStyle cancels the live drawing session', () => {
            const adapter = makeDrawingAdapter()
            const cancels = []
            adapter.on('drawcancel', (e) => cancels.push(e))
            adapter.enableDrawing('polygon')
            adapter.setBasemapStyle('https://example.com/style.json')
            expect(adapter.isDrawing()).toBe(false)
            expect(cancels).toEqual([{ shape: 'polygon' }])
        })

        test('disableDrawing drops the anchor', () => {
            const adapter = makeDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.enableDrawing('polygon')
            adapter.disableDrawing()
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([undefined])
        })

        test('the layer registry keeps the original un-anchored instances', () => {
            const adapter = makeDrawingAdapter()
            const original = makeLayer('raster')
            adapter.addLayer(original)
            adapter.enableDrawing('polygon')
            expect(adapter.getLayers()[0]).toBe(original)
        })
    })

    test.describe('captureScreenshot', () => {
        test('overlay mode reads the canvas inside the render event after triggerRepaint', async () => {
            const adapter = makeAdapter()
            let inRenderFrame = false
            let renderHandler = null
            const blob = new Blob(['deckgl'], { type: 'image/png' })
            const canvas = {
                width: 256,
                height: 128,
                toBlob: (callback, type) => {
                    expect(type).toBe('image/png')
                    // Only valid during the render event, before the browser
                    // presents (and clears) the drawing buffer.
                    callback(inRenderFrame ? blob : null)
                },
            }
            adapter._isOverlayMode = true
            adapter._basemap = {
                once: (type, handler) => {
                    expect(type).toBe('render')
                    renderHandler = handler
                },
                triggerRepaint: () => {
                    // Simulate the frame the repaint schedules: the map draws,
                    // fires 'render' while the buffer still holds pixels, then
                    // the buffer is cleared on present.
                    inRenderFrame = true
                    renderHandler()
                    inRenderFrame = false
                },
                getCanvas: () => canvas,
            }

            const result = await adapter.captureScreenshot()
            expect(result).toEqual({
                blob,
                mimeType: 'image/png',
                extension: 'png',
                width: 256,
                height: 128,
            })
        })

        test('overlay mode rejects when toBlob returns null during the render event', async () => {
            const adapter = makeAdapter()
            let renderHandler = null
            adapter._isOverlayMode = true
            adapter._basemap = {
                once: (_type, handler) => { renderHandler = handler },
                triggerRepaint: () => renderHandler(),
                getCanvas: () => ({
                    width: 256,
                    height: 128,
                    toBlob: (callback) => callback(null),
                }),
            }

            await expect(adapter.captureScreenshot()).rejects.toThrow(/toBlob returned null/)
        })

        test('overlay mode rejects after the timeout if the render event never fires', async () => {
            vi.useFakeTimers()
            try {
                const adapter = makeAdapter()
                let repainted = false
                let armedHandler = null
                const removed = []
                adapter._isOverlayMode = true
                adapter._basemap = {
                    once: (type, handler) => { armedHandler = handler },
                    off: (type, handler) => { removed.push({ type, handler }) },
                    triggerRepaint: () => { repainted = true },
                    getCanvas: () => ({
                        width: 256,
                        height: 128,
                        toBlob: () => {},
                    }),
                }

                const capture = adapter.captureScreenshot()
                const assertion = expect(capture).rejects.toThrow(/timed out/)
                vi.advanceTimersByTime(3000)
                await assertion
                expect(repainted).toBe(true)
                // The timeout must unhook the pending render listener, or a
                // timed-out capture leaves it armed to fire on a later render.
                expect(removed).toEqual([
                    { type: 'render', handler: armedHandler },
                ])
            } finally {
                vi.useRealTimers()
            }
        })

        test('standalone mode redraws deck and reads its canvas', async () => {
            const adapter = makeAdapter()
            let redrawArg = null
            const blob = new Blob(['standalone'], { type: 'image/png' })
            adapter._isOverlayMode = false
            adapter._deck = {
                redraw: (reason) => { redrawArg = reason },
                getCanvas: () => ({
                    width: 300,
                    height: 200,
                    toBlob: (callback, type) => {
                        expect(type).toBe('image/png')
                        callback(blob)
                    },
                }),
            }

            const result = await adapter.captureScreenshot()
            expect(redrawArg).toBe('screenshot')
            expect(result).toEqual({
                blob,
                mimeType: 'image/png',
                extension: 'png',
                width: 300,
                height: 200,
            })
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
