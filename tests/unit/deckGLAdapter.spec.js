import { test, expect, vi } from 'vitest'
import { DeckGLAdapter } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'
// Import MAP_ENGINE from the lightweight types module rather than MapEngines/index.ts.
// index.ts transitively imports LeafletAdapter -> leaflet, which references a global
// `window` at module-eval time and fails in this Node test context.
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'
import { drawModeKeyEvents } from '../../src/essence/Basics/MapEngines/Adapters/DrawingHelpers.ts'

// Both init() branches build their engine through a real constructor, so the
// props they wire the adapter's handlers into can only be read back off that
// constructor. jsdom has no WebGL, so the constructors are replaced — and only
// they are: everything else the adapter imports alongside them stays real.
const constructed = vi.hoisted(() => ({ deck: [], overlay: [] }))

vi.mock('@deck.gl/core', async (importOriginal) => {
    const actual = await importOriginal()
    class MockDeck {
        constructor(props) {
            constructed.deck.push(props)
        }
        setProps() {}
        redraw() {}
        finalize() {}
    }
    return { ...actual, Deck: MockDeck }
})

vi.mock('@deck.gl/mapbox', async (importOriginal) => {
    const actual = await importOriginal()
    class MockMapboxOverlay {
        constructor(props) {
            constructed.overlay.push(props)
        }
        setProps() {}
        finalize() {}
    }
    return { ...actual, MapboxOverlay: MockMapboxOverlay }
})

vi.mock('maplibre-gl', async (importOriginal) => {
    const actual = await importOriginal()
    class MockMap {
        constructor() {
            this._canvas = document.createElement('canvas')
        }
        addControl() {}
        removeControl() {}
        on() {}
        off() {}
        once() {}
        setMaxBounds() {}
        remove() {}
        getCanvas() {
            return this._canvas
        }
    }
    return { ...actual, Map: MockMap }
})

function makeAdapter({ longitude = -120, latitude = 40, zoom = 5 } = {}) {
    const adapter = new DeckGLAdapter()
    adapter._viewState = { longitude, latitude, zoom, bearing: 0, pitch: 0 }
    return adapter
}

function makeLayer(id, props = {}) {
    return { id, ...props, clone: (overrides = {}) => makeLayer(id, { ...props, ...overrides }) }
}

// Just enough of the maplibre Map API for TerraDrawMapLibreGLAdapter to
// construct, register its layers, place a pointer on the globe, and tear itself
// down. Registered ids are tracked so getLayer() answers the way a real style
// would. The map is given a size and put in the document because terra-draw
// drops a pointer that falls outside the map's own bounds, and because an
// event only reaches a window listener from a node that is in the page.
function makeDrawingBasemap() {
    const canvas = document.createElement('canvas')
    const container = document.createElement('div')
    container.appendChild(canvas)
    document.body.appendChild(container)
    const bounds = {
        x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    }
    container.getBoundingClientRect = () => bounds
    canvas.getBoundingClientRect = () => bounds
    const styleLayers = new Set()
    return {
        getContainer: () => container,
        getCanvas: () => canvas,
        project: ({ lng, lat }) => ({ x: lng, y: lat }),
        unproject: ({ x, y }) => ({ lng: x, lat: y }),
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
        off: vi.fn(),
        removeControl: vi.fn(),
        remove: vi.fn(),
        version: '5.8.0',
    }
}

/** An overlay-mode adapter a real terra-draw session can be started on. */
function makeOverlayDrawingAdapter() {
    const adapter = makeAdapter()
    adapter._isOverlayMode = true
    adapter._basemap = makeDrawingBasemap()
    adapter._overlay = { setProps: vi.fn(), finalize: vi.fn() }
    return adapter
}

/**
 * End a drawing session the way a click on the map does. terra-draw commits
 * from inside the pointerup, so the adapter's pointer watch is looking at that
 * very event as the session ends — which is what tells the guard a click of
 * the drawing's is still to come.
 */
function stopOnPointer(adapter) {
    adapter._drawPointers.start()
    const stop = () => adapter._stopDrawing()
    window.addEventListener('pointerup', stop)
    window.dispatchEvent(new Event('pointerup'))
    window.removeEventListener('pointerup', stop)
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

    test.describe('getBounds', () => {
        // Standalone deck derives bounds from the container, so it needs a
        // sized element; the view is deliberately wider than it is tall.
        const boundsFor = (bearing = 0) => {
            const adapter = makeAdapter({ longitude: -95, latitude: 35, zoom: 5 })
            adapter._isOverlayMode = false
            adapter._viewState.bearing = bearing
            adapter._container = { offsetWidth: 800, offsetHeight: 400 }
            return adapter.getBounds()
        }

        test('standalone mode brackets the centre south-west to north-east', () => {
            const b = boundsFor()
            expect(b.southWest.lat).toBeLessThan(35)
            expect(b.northEast.lat).toBeGreaterThan(35)
            expect(b.southWest.lng).toBeLessThan(-95)
            expect(b.northEast.lng).toBeGreaterThan(-95)
        })

        test('standalone mode returns the same envelope rotated half a turn', () => {
            // At bearing 180 the bottom-left pixel unprojects north-east of
            // the top-right one. Reading only those two corners inverts both
            // axes, and every containment test against these bounds then gives
            // the opposite answer.
            const upright = boundsFor()
            const rotated = boundsFor(180)
            expect(rotated.southWest.lat).toBeLessThan(rotated.northEast.lat)
            expect(rotated.southWest.lng).toBeLessThan(rotated.northEast.lng)
            expect(rotated.southWest.lat).toBeCloseTo(upright.southWest.lat, 6)
            expect(rotated.northEast.lat).toBeCloseTo(upright.northEast.lat, 6)
            expect(rotated.southWest.lng).toBeCloseTo(upright.southWest.lng, 6)
            expect(rotated.northEast.lng).toBeCloseTo(upright.northEast.lng, 6)
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

        test('setLayerOpacity replaces the stored layer and returns nothing', () => {
            const adapter = makeAdapter()
            const original = makeLayer('opacity-layer')
            adapter.addLayer(original)
            expect(adapter.setLayerOpacity(original, 0.25)).toBeUndefined()
            const stored = adapter.getLayers().find((l) => l.id === 'opacity-layer')
            expect(stored.opacity).toBe(0.25)
            expect(stored).not.toBe(original)
            expect(original.opacity).toBeUndefined()
        })

        test('setLayerOpacity accepts 0 rather than treating it as unset', () => {
            const adapter = makeAdapter()
            adapter.addLayer(makeLayer('opacity-layer'))
            adapter.setLayerOpacity('opacity-layer', 0)
            const stored = adapter.getLayers().find((l) => l.id === 'opacity-layer')
            expect(stored.opacity).toBe(0)
        })

        test('setLayerOpacity is a no-op for a layer the engine does not hold', () => {
            const adapter = makeAdapter()
            const offMap = makeLayer('hidden-layer')
            expect(adapter.setLayerOpacity(offMap, 0.6)).toBeUndefined()
            expect(adapter.hasLayer('hidden-layer')).toBe(false)
        })

        test('setLayerOpacity on an unknown id returns undefined without throwing', () => {
            const adapter = makeAdapter()
            expect(adapter.setLayerOpacity('nonexistent', 0.5)).toBeUndefined()
        })

        test('setLayerOpacity on a non-layer value returns undefined without throwing', () => {
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

        // Map_ registers every layer it builds with the active engine, and
        // under this engine it still builds data, image, video and velocity
        // layers with Leaflet. Every sync clones what the engine holds, so
        // one such entry in the registry took the whole map down rather than
        // just the layer that could not be built.
        test('registerLayer declines a layer this engine cannot draw', () => {
            const adapter = makeAdapter()
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            adapter.registerLayer('velocity', { setOpacity() {} })

            expect(adapter.getLayers()).toHaveLength(0)
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('velocity')

            warn.mockRestore()
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

        function lastSyncedLayers(adapter) {
            const calls = adapter._overlay.setProps.mock.calls
            return calls[calls.length - 1][0].layers
        }

        test('enableDrawing anchors every deck layer below the terra-draw stack', () => {
            const adapter = makeOverlayDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.addLayer(makeLayer('vector'))
            adapter.enableDrawing('polygon')
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([
                ANCHOR_ID,
                ANCHOR_ID,
            ])
        })

        test('the anchor id matches the bottom-most layer terra-draw registers', () => {
            const adapter = makeOverlayDrawingAdapter()
            adapter.enableDrawing('polygon')
            expect(adapter._basemap.addLayer.mock.calls[0][0].id).toBe('td-polygon')
        })

        test('layers added mid-draw are anchored too', () => {
            const adapter = makeOverlayDrawingAdapter()
            adapter.enableDrawing('rectangle')
            adapter.addLayer(makeLayer('added-mid-draw'))
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([ANCHOR_ID])
        })

        test('no anchor is stamped while the terra-draw layers are out of the style', () => {
            const adapter = makeOverlayDrawingAdapter()
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
            const adapter = makeOverlayDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.enableDrawing('polygon')
            adapter.setBasemapStyle('https://example.com/style.json')
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([undefined])
            expect(adapter._overlay.setProps.mock.invocationCallOrder.at(-1)).toBeLessThan(
                adapter._basemap.setStyle.mock.invocationCallOrder[0]
            )
        })

        test('setBasemapStyle cancels the live drawing session', () => {
            const adapter = makeOverlayDrawingAdapter()
            const cancels = []
            adapter.on('drawcancel', (e) => cancels.push(e))
            adapter.enableDrawing('polygon')
            adapter.setBasemapStyle('https://example.com/style.json')
            expect(adapter.isDrawing()).toBe(false)
            expect(cancels).toEqual([{ shape: 'polygon' }])
        })

        test('destroy cancels the live drawing session', () => {
            const adapter = makeOverlayDrawingAdapter()
            const cancels = []
            adapter.on('drawcancel', (e) => cancels.push(e))
            adapter.enableDrawing('polygon')
            adapter.destroy()
            expect(cancels).toEqual([{ shape: 'polygon' }])
        })

        test('disableDrawing drops the anchor', () => {
            const adapter = makeOverlayDrawingAdapter()
            adapter.addLayer(makeLayer('raster'))
            adapter.enableDrawing('polygon')
            adapter.disableDrawing()
            expect(lastSyncedLayers(adapter).map((l) => l.beforeId)).toEqual([undefined])
        })

        test('the layer registry keeps the original un-anchored instances', () => {
            const adapter = makeOverlayDrawingAdapter()
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

    // Under the deck.gl engine MMGIS still builds `data`, `image`, `video` and
    // `velocity` layers as native Leaflet objects, and callers hand every
    // registry entry to the active engine. Such an object has no deck `id`, so
    // addLayer files it under `undefined`, and no `clone`, which the layer sync
    // calls on every entry it mounts.
    test.describe('a registry entry that is not a deck layer', () => {
        function makeStandaloneAdapter() {
            const adapter = makeAdapter()
            adapter._isOverlayMode = false
            adapter._deck = { setProps: vi.fn() }
            return adapter
        }

        // A Leaflet tile layer's opacity surface — enough shape to be mistaken
        // for a registry entry, with none of a deck layer's.
        const makeLeafletish = () => ({
            opacity: null,
            setOpacity(o) { this.opacity = o },
        })

        test('is accepted by addLayer without throwing', () => {
            const adapter = makeStandaloneAdapter()
            expect(() => adapter.addLayer(makeLeafletish())).not.toThrow()
        })

        test('is left out of the layers handed to deck', () => {
            const adapter = makeStandaloneAdapter()
            adapter.addLayer(makeLayer('l1'))
            adapter.addLayer(makeLeafletish())

            const sent = adapter._deck.setProps.mock.calls.at(-1)[0].layers
            expect(sent.map((l) => l.id)).toEqual(['l1'])
        })

        test('is left out of the layers handed to an interleaved overlay', () => {
            const adapter = makeAdapter()
            adapter._isOverlayMode = true
            adapter._overlay = { setProps: vi.fn(), finalize: vi.fn() }
            adapter.addLayer(makeLayer('l1'))
            adapter.addLayer(makeLeafletish())

            const sent = adapter._overlay.setProps.mock.calls.at(-1)[0].layers
            expect(sent.map((l) => l.id)).toEqual(['l1'])
        })
    })

    test.describe('drawing', () => {
        // enableDrawing needs a real terra-draw session against a MapLibre map,
        // so drive the finish path with the two things it touches: the session
        // flag and the canvas terra-draw listens on.
        function makeSessionAdapter(shape) {
            const adapter = makeAdapter()
            const canvas = document.createElement('canvas')
            adapter._isOverlayMode = true
            adapter._basemap = { getCanvas: () => canvas }
            adapter._terraDraw = {}
            adapter._drawingShape = shape
            return { adapter, canvas }
        }

        function makeDrawingAdapter({ finishes }) {
            const { adapter, canvas } = makeSessionAdapter('polygon')
            const keys = []
            canvas.addEventListener('keyup', (e) => {
                keys.push(e.key)
                // terra-draw ends the session synchronously when it commits.
                if (finishes) adapter._drawingShape = null
            })
            return { adapter, keys }
        }

        // A terra-draw mode acts on a keyup only when the key matches its
        // configured keyEvents, so let the real bindings decide the commit.
        function makeKeyBoundAdapter(shape) {
            const { adapter, canvas } = makeSessionAdapter(shape)
            const keyEvents = drawModeKeyEvents(shape)
            canvas.addEventListener('keyup', (e) => {
                if (e.key === keyEvents.finish) adapter._drawingShape = null
            })
            return adapter
        }

        test('finishDrawing commits through the element terra-draw listens on', () => {
            const { adapter, keys } = makeDrawingAdapter({ finishes: true })
            expect(adapter.finishDrawing()).toBe(true)
            expect(keys).toEqual(['Enter'])
        })

        test('finishDrawing leaves an unfinishable drawing in progress', () => {
            const { adapter } = makeDrawingAdapter({ finishes: false })
            let cancelled = false
            adapter.on('drawcancel', () => { cancelled = true })
            expect(adapter.finishDrawing()).toBe(false)
            expect(cancelled).toBe(false)
            expect(adapter.isDrawing()).toBe(true)
        })

        test('finishDrawing is a no-op with no session', () => {
            expect(makeAdapter().finishDrawing()).toBe(false)
        })

        // With one click placed, a rectangle spans no area and a circle has
        // the mode's minimum radius, and neither shape has a finish key to
        // commit that with.
        test('Enter cannot finish a one-click rectangle or circle', () => {
            for (const shape of ['rectangle', 'circle']) {
                const adapter = makeKeyBoundAdapter(shape)
                expect(adapter.finishDrawing()).toBe(false)
                expect(adapter.isDrawing()).toBe(true)
            }
        })

        test('Enter still finishes the click-per-vertex shapes', () => {
            for (const shape of ['polygon', 'linestring']) {
                expect(makeKeyBoundAdapter(shape).finishDrawing()).toBe(true)
            }
        })

        // With the map focused, the user's real Enter reaches terra-draw on top
        // of the plugin that already asked to finish. The session is over by
        // then, so the adapter sends nothing a second time — and terra-draw's
        // own close() bails on a mode it has already finished.
        test('finishing again after the session ended dispatches nothing', () => {
            const { adapter, keys } = makeDrawingAdapter({ finishes: true })
            expect(adapter.finishDrawing()).toBe(true)
            expect(adapter.finishDrawing()).toBe(false)
            expect(keys).toEqual(['Enter'])
        })

        // A deck pick, whose `coordinate` is in [lng, lat] order.
        const pickAt = (lng, lat) => ({ coordinate: [lng, lat], x: 12, y: 34 })

        // deck reports a click through its `click` recognizer, which waits for
        // a double-click to fail before it fires, so the click terra-draw
        // committed the shape on arrives long after the session it ended — with
        // `_drawingShape` already null, so that guard is no longer looking.
        // Reporting it hands every consumer a map click the user never made,
        // one that would dismiss the popup a plugin opened from the
        // `drawcomplete` that came first.
        test('the click a drawing ended on is not reported as a map click', () => {
            const { adapter } = makeSessionAdapter('rectangle')
            const clicks = []
            const picks = []
            adapter.on('click', (e) => clicks.push(e.latlng))
            adapter.onFeatureClick((result) => picks.push(result))

            // terra-draw commits on pointerup, and the adapter ends the session
            // there and then — this is what deck calls afterwards.
            stopOnPointer(adapter)
            adapter._onPointerClick(pickAt(-120, 40))

            expect(clicks).toEqual([])
            expect(picks).toEqual([])
        })

        // A pointer that goes down more than a tap interval after the finish is
        // too late to be the second tap of a double-click that ended the
        // drawing, so it is the user's own next gesture. deck reports its click
        // a further interval later, once the double-click that would have
        // outranked it has failed.
        test('the click that starts the next gesture is still reported', () => {
            vi.useFakeTimers()
            try {
                const { adapter, canvas } = makeSessionAdapter('rectangle')
                const clicks = []
                adapter.on('click', (e) => clicks.push(e.latlng))

                stopOnPointer(adapter)
                vi.advanceTimersByTime(400)
                canvas.dispatchEvent(new Event('pointerdown'))
                vi.advanceTimersByTime(50)
                canvas.dispatchEvent(new Event('pointerup'))
                vi.advanceTimersByTime(300)
                adapter._onPointerClick(pickAt(-120, 40))

                expect(clicks).toEqual([{ lat: 40, lng: -120 }])
            } finally {
                vi.useRealTimers()
            }
        })

        // Finishing on a double-click is trained behaviour, and terra-draw
        // commits on the first of the two taps. deck maps `dblclick` onto
        // `onClick` alongside `click` (@deck.gl/core EVENT_HANDLERS), and
        // because it wires the two recognizers to require each other's failure,
        // the winner emits a tap interval after the second tap's pointerup —
        // half a second after the drawing was committed, and after the
        // pointerdown that used to be taken as proof of a new gesture.
        test('the double-click a drawing ended on is not reported as a map click', () => {
            vi.useFakeTimers()
            try {
                const { adapter, canvas } = makeSessionAdapter('rectangle')
                const clicks = []
                const picks = []
                adapter.on('click', (e) => clicks.push(e.latlng))
                adapter.onFeatureClick((result) => picks.push(result))

                // Tap 1's pointerup is where terra-draw commits; the guard's
                // own listeners only go on from here, so that pointerup is not
                // one of the events it sees.
                stopOnPointer(adapter)

                // Tap 2, inside the 300ms interval that makes the pair a
                // double-click.
                vi.advanceTimersByTime(150)
                canvas.dispatchEvent(new Event('pointerdown'))
                vi.advanceTimersByTime(50)
                canvas.dispatchEvent(new Event('pointerup'))

                // The recognizer's own wait, and then the click.
                vi.advanceTimersByTime(300)
                adapter._onPointerClick(pickAt(-120, 40))

                expect(clicks).toEqual([])
                expect(picks).toEqual([])
            } finally {
                vi.useRealTimers()
            }
        })

        // The widest the finishing gesture can be: the second tap released at
        // the very edge of the interval that still makes it a double-click,
        // and deck's recognizer waiting a full interval on top of that.
        test('a double-click finish is covered to the edge of the interval', () => {
            vi.useFakeTimers()
            try {
                const { adapter, canvas } = makeSessionAdapter('rectangle')
                const clicks = []
                adapter.on('click', (e) => clicks.push(e.latlng))

                stopOnPointer(adapter)
                vi.advanceTimersByTime(250)
                canvas.dispatchEvent(new Event('pointerdown'))
                vi.advanceTimersByTime(49)
                canvas.dispatchEvent(new Event('pointerup'))
                vi.advanceTimersByTime(300)
                adapter._onPointerClick(pickAt(-120, 40))

                expect(clicks).toEqual([])
            } finally {
                vi.useRealTimers()
            }
        })

        // The click a finishing gesture was covered for does not always come:
        // a pointerup deck reads as the end of a drag produces none. The window
        // closes on its own so the guard cannot sit there absorbing the user's
        // clicks indefinitely.
        test('the guard stops absorbing once the finish window has passed', () => {
            vi.useFakeTimers()
            try {
                const { adapter } = makeSessionAdapter('rectangle')
                const clicks = []
                adapter.on('click', (e) => clicks.push(e.latlng))

                stopOnPointer(adapter)
                vi.advanceTimersByTime(600)
                adapter._onPointerClick(pickAt(-120, 40))

                expect(clicks).toEqual([{ lat: 40, lng: -120 }])
            } finally {
                vi.useRealTimers()
            }
        })

        // terra-draw turns double-click zoom back on the moment the mode stops,
        // so the second click of a double-click finish would zoom the map on
        // top of everything else it does. Hold that re-enable back for as long
        // as the guard is still absorbing the same gesture's clicks.
        test('double-click zoom stays off until the finish window closes', () => {
            vi.useFakeTimers()
            try {
                const { adapter, canvas } = makeSessionAdapter('rectangle')
                let enabled = false
                adapter._basemap = {
                    getCanvas: () => canvas,
                    doubleClickZoom: {
                        isEnabled: () => enabled,
                        enable: () => { enabled = true },
                        disable: () => { enabled = false },
                    },
                }
                // Stopping the mode is what turns it back on, inside
                // _stopDrawing.
                adapter._terraDraw = {
                    clear: () => { },
                    stop: () => { enabled = true },
                }

                stopOnPointer(adapter)
                expect(enabled).toBe(false)

                vi.advanceTimersByTime(600)
                expect(enabled).toBe(true)
            } finally {
                vi.useRealTimers()
            }
        })

        // A plugin ending the drawing from its own panel — a Finish button, a
        // mode switch, the Escape it handles itself — never touched the map, so
        // the click the user makes next is theirs from the first one.
        test('a session a plugin ended does not swallow the click that follows', () => {
            const { adapter } = makeSessionAdapter('polygon')
            const clicks = []
            adapter.on('click', (e) => clicks.push(e.latlng))

            adapter.disableDrawing()
            adapter._onPointerClick(pickAt(-120, 40))

            expect(clicks).toEqual([{ lat: 40, lng: -120 }])
        })

        test('disableDrawing emits drawcancel once', () => {
            const { adapter } = makeDrawingAdapter({ finishes: false })
            const shapes = []
            adapter.on('drawcancel', (e) => shapes.push(e.shape))
            adapter.disableDrawing()
            adapter.disableDrawing()
            expect(shapes).toEqual(['polygon'])
        })
    })

    // Which clicks a finish leaves behind is not something terra-draw says: it
    // emits `finish` from inside whatever event it is reacting to, and the
    // pointer that placed the last vertex may be a separate event again. These
    // drive real terra-draw sessions, so the answer comes from the events the
    // way it does on a real map.
    test.describe('drawing - the clicks a finish leaves behind', () => {
        const pointer = (canvas, type, x, y) =>
            canvas.dispatchEvent(
                new PointerEvent(type, {
                    clientX: x,
                    clientY: y,
                    bubbles: true,
                    isPrimary: true,
                })
            )

        /** A two-vertex linestring, one click short of a finish. */
        const drawLine = (adapter, canvas) => {
            adapter.enableDrawing('linestring')
            pointer(canvas, 'pointerdown', 10, 10)
            pointer(canvas, 'pointerup', 10, 10)
            pointer(canvas, 'pointermove', 50, 50)
            pointer(canvas, 'pointerdown', 50, 50)
            pointer(canvas, 'pointerup', 50, 50)
        }

        // A deck pick, whose `coordinate` is in [lng, lat] order.
        const pickAt = (lng, lat) => ({ coordinate: [lng, lat], x: 12, y: 34 })

        // Point mode commits on the pointerup of the click that places it, and
        // deck reports that click a tap interval later — with the session over.
        test('a shape finished on a click leaves the guard covering it', () => {
            const adapter = makeOverlayDrawingAdapter()
            const canvas = adapter._basemap.getCanvas()
            const finished = []
            adapter.on('drawcomplete', (e) => finished.push(e))

            adapter.enableDrawing('point')
            pointer(canvas, 'pointerdown', 10, 10)
            pointer(canvas, 'pointerup', 10, 10)

            expect(finished).toHaveLength(1)
            expect(adapter._drawEndClick.pending).toBe(true)
        })

        // Enter finishes from a keyup, but deck is still holding the click that
        // placed the last vertex: it holds every one a tap interval to see
        // whether a double-click is coming. That click lands with the session
        // over, and reporting it would dismiss whatever a plugin opened from
        // the `drawcomplete` the key produced a moment earlier.
        test('the last vertex click deck still holds when Enter finishes is covered', () => {
            vi.useFakeTimers()
            try {
                const adapter = makeOverlayDrawingAdapter()
                const canvas = adapter._basemap.getCanvas()
                const finished = []
                const clicks = []
                adapter.on('drawcomplete', (e) => finished.push(e))
                adapter.on('click', (e) => clicks.push(e.latlng))

                drawLine(adapter, canvas)
                vi.advanceTimersByTime(100)
                canvas.dispatchEvent(
                    new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
                )

                // deck's recognizer, a tap interval after that last pointerup.
                vi.advanceTimersByTime(200)
                adapter._onPointerClick(pickAt(-120, 40))

                expect(finished).toHaveLength(1)
                expect(clicks).toEqual([])
            } finally {
                vi.useRealTimers()
            }
        })

        // Enter used the way it usually is — the shape read back, then the key
        // — comes with the last vertex click long delivered, so there is
        // nothing left to cover and the user's next click is theirs.
        test('a shape finished on Enter with the pointer idle leaves the guard out of the way', () => {
            vi.useFakeTimers()
            try {
                const adapter = makeOverlayDrawingAdapter()
                const canvas = adapter._basemap.getCanvas()
                const finished = []
                const clicks = []
                adapter.on('drawcomplete', (e) => finished.push(e))
                adapter.on('click', (e) => clicks.push(e.latlng))

                drawLine(adapter, canvas)
                vi.advanceTimersByTime(400)
                canvas.dispatchEvent(
                    new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
                )

                expect(finished).toHaveLength(1)
                expect(adapter._drawEndClick.pending).toBe(false)

                // The user's own next click, deck reporting it an interval
                // after the gesture as always.
                canvas.dispatchEvent(new Event('pointerdown'))
                canvas.dispatchEvent(new Event('pointerup'))
                vi.advanceTimersByTime(300)
                adapter._onPointerClick(pickAt(-120, 40))

                expect(clicks).toEqual([{ lat: 40, lng: -120 }])
            } finally {
                vi.useRealTimers()
            }
        })
    })

    // The props the engine is constructed with are where the adapter's handlers
    // are connected to deck's input. Calling those handlers directly, as the
    // tests above do, says nothing about which function deck ends up calling,
    // and each mode wires its own copy.
    test.describe('constructed engine props', () => {
        const CONTAINER_ID = 'deckgl-init'
        const MAPLIBRE_BASEMAP = {
            provider: 'maplibre',
            style: 'https://example.com/style.json',
        }

        // A deck pick, whose `coordinate` is in [lng, lat] order.
        const pickAt = (lng, lat) => ({ coordinate: [lng, lat], x: 12, y: 34 })

        // Run the real init() path and hand back the props of whichever engine
        // it built: deck's own in standalone mode, the MapboxOverlay's in
        // overlay mode.
        function initAdapter(basemap) {
            constructed.deck.length = 0
            constructed.overlay.length = 0
            let container = document.getElementById(CONTAINER_ID)
            if (!container) {
                container = document.createElement('div')
                container.id = CONTAINER_ID
                document.body.appendChild(container)
            }
            const adapter = new DeckGLAdapter()
            adapter.init({
                containerId: CONTAINER_ID,
                center: { lat: 40, lng: -120 },
                zoom: 5,
                ...(basemap ? { basemap } : {}),
            })
            return {
                adapter,
                props: basemap ? constructed.overlay[0] : constructed.deck[0],
            }
        }

        for (const [mode, basemap] of [
            ['standalone', null],
            ['overlay', MAPLIBRE_BASEMAP],
        ]) {
            test(`${mode} mode reports the clicks deck picks`, () => {
                const { adapter, props } = initAdapter(basemap)
                const clicks = []
                const picks = []
                adapter.on('click', (e) => clicks.push(e.latlng))
                adapter.onFeatureClick((result) => picks.push(result))

                props.onClick(pickAt(-120, 40))

                expect(clicks).toEqual([{ lat: 40, lng: -120 }])
                expect(picks).toHaveLength(1)
            })

            test(`${mode} mode holds back the clicks a drawing takes as vertices`, () => {
                const { adapter, props } = initAdapter(basemap)
                const clicks = []
                const picks = []
                adapter.on('click', (e) => clicks.push(e.latlng))
                adapter.onFeatureClick((result) => picks.push(result))
                adapter._drawingShape = 'polygon'

                props.onClick(pickAt(-120, 40))

                expect(clicks).toEqual([])
                expect(picks).toEqual([])
            })
        }
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
