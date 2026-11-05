/**
 * Basemap controls — the scale bar and compass a basemap draws itself when
 * `basemap.controls` asks for them. They are the library's own controls, so
 * what matters here is that the right class is built with the right options
 * and placed in the right corner, on the primary map and on every comparison
 * pane.
 *
 * The adapter is driven against a fake basemap class, as the side-by-side
 * suite does — the real one needs WebGL, which jsdom has none of.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeckGLAdapter } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter'

let container

class FakeBasemap {
    constructor(options) {
        this.options = options
        this.center = { lng: options.center[0], lat: options.center[1] }
        this.zoom = options.zoom
        this.bearing = options.bearing ?? 0
        this.pitch = options.pitch ?? 0
        this.controls = []
        this.handlers = new Map()
        FakeBasemap.instances.push(this)
    }
    static instances = []
    addControl(control, position) { this.controls.push([control, position]) }
    removeControl(control) { this.controls = this.controls.filter(([c]) => c !== control) }
    remove() {}
    getCenter() { return this.center }
    getZoom() { return this.zoom }
    getBearing() { return this.bearing }
    getPitch() { return this.pitch }
    setMaxBounds() {}
    setPadding() {}
    setStyle(style) { this.style = style }
    resize() {}
    on(type, handler) {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set())
        this.handlers.get(type).add(handler)
    }
    off(type, handler) {
        const handlers = this.handlers.get(type)
        if (handlers) handlers.delete(handler)
    }
    once(type, handler) { this.on(type, handler) }
    jumpTo() {}
}

class FakeScaleControl {
    constructor(options) { this.options = options }
}
class FakeNavigationControl {
    constructor(options) { this.options = options }
}

/** The controls of a map, by class, as `[control, position]` pairs. */
const controlsOf = (map, Ctor) => map.controls.filter(([c]) => c instanceof Ctor)

/**
 * An adapter in overlay mode whose primary basemap is built through the
 * adapter's own setup, so the primary gets its controls the way it does in
 * the app. `_setupOverlay` is the shared step both providers reach.
 */
const makeAdapter = (controls, ctors = { ScaleControl: FakeScaleControl, NavigationControl: FakeNavigationControl }) => {
    const adapter = new DeckGLAdapter()
    Object.defineProperty(container, 'offsetWidth', { value: 1000, configurable: true })
    adapter._container = container
    adapter._viewState = { longitude: -95, latitude: 38, zoom: 4, bearing: 0, pitch: 0 }
    adapter._setupOverlay(
        FakeBasemap,
        undefined,
        { provider: 'maplibre', style: 'style://a', ...(controls ? { controls } : {}) },
        ctors
    )
    return adapter
}

beforeEach(() => {
    FakeBasemap.instances = []
    container = document.createElement('div')
    document.body.appendChild(container)
    // jsdom lays nothing out, so the observer comparison attaches needs a stub.
    window.ResizeObserver = class {
        observe() {}
        disconnect() {}
    }
})

afterEach(() => {
    container.remove()
})

test.describe('basemap controls', () => {
    test('a scale bar is added at the bottom-left in metric by default', () => {
        const adapter = makeAdapter({ scaleBar: {} })
        const [[bar, position]] = controlsOf(adapter._basemap, FakeScaleControl)
        expect(bar.options).toEqual({ maxWidth: 100, unit: 'metric' })
        expect(position).toBe('bottom-left')
        expect(controlsOf(adapter._basemap, FakeNavigationControl)).toHaveLength(0)
    })

    test('the scale bar takes its units and corner from the config', () => {
        const adapter = makeAdapter({ scaleBar: { units: 'imperial', position: 'bottom-right' } })
        const [[bar, position]] = controlsOf(adapter._basemap, FakeScaleControl)
        expect(bar.options.unit).toBe('imperial')
        expect(position).toBe('bottom-right')
    })

    test('a compass is a navigation control with only the compass, following pitch, top-right by default', () => {
        const adapter = makeAdapter({ compass: {} })
        const [[compass, position]] = controlsOf(adapter._basemap, FakeNavigationControl)
        expect(compass.options).toEqual({ showCompass: true, showZoom: false, visualizePitch: true })
        expect(position).toBe('top-right')
        expect(controlsOf(adapter._basemap, FakeScaleControl)).toHaveLength(0)
    })

    test('the compass takes its corner from the config', () => {
        const adapter = makeAdapter({ compass: { position: 'top-left' } })
        const [[, position]] = controlsOf(adapter._basemap, FakeNavigationControl)
        expect(position).toBe('top-left')
    })

    test('without a controls key the basemap gets only the deck overlay', () => {
        const adapter = makeAdapter(undefined)
        expect(adapter._basemap.controls).toHaveLength(1)
        expect(adapter._basemap.controls[0][0]).not.toBeInstanceOf(FakeScaleControl)
    })

    test('a library without the control class warns and shows nothing, and the map still builds', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const adapter = makeAdapter({ scaleBar: {}, compass: {} }, {})
        expect(adapter._basemap).not.toBeNull()
        expect(adapter._basemap.controls).toHaveLength(1)
        expect(warn.mock.calls.map(([m]) => m)).toEqual([
            expect.stringMatching(/no ScaleControl/),
            expect.stringMatching(/no NavigationControl/),
        ])
        warn.mockRestore()
    })

    test('each side-by-side pane draws its own scale bar and compass', () => {
        const adapter = makeAdapter({ scaleBar: { units: 'imperial' }, compass: {} })
        adapter._overlay = { props: { layers: [] }, setProps(p) { Object.assign(this.props, p) } }
        adapter.enableComparison({ leftLayerIds: ['a'], rightLayerIds: ['b'], layout: 'sideBySide' })

        const panes = adapter._sbsPanes.map((p) => p.map)
        expect(panes).toHaveLength(2)
        for (const pane of panes) {
            const [[bar, barAt]] = controlsOf(pane, FakeScaleControl)
            expect(bar.options.unit).toBe('imperial')
            expect(barAt).toBe('bottom-left')
            expect(controlsOf(pane, FakeNavigationControl)).toHaveLength(1)
        }
    })
})
