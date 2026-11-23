import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeckGLAdapter } from '../../src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts'

/**
 * The side-by-side comparison layout in the deck.gl adapter.
 *
 * Where swipe draws one camera twice and wipes between the copies, this builds
 * a map per half so both halves can show the same place at once. What is worth
 * pinning down is therefore the part that differs: that two panes exist and
 * tile the container, that their cameras stay locked to each other and to the
 * primary map, and that switching layouts leaves nothing of the other one
 * behind.
 *
 * The adapter is driven directly against a fake basemap class — the real one
 * needs WebGL, which jsdom has none of.
 */

let container

/** A stand-in for the mapbox-gl / maplibre-gl `Map` surface the adapter uses. */
class FakeBasemap {
    constructor(options) {
        this.options = options
        this.center = { lng: options.center[0], lat: options.center[1] }
        this.zoom = options.zoom
        this.bearing = options.bearing ?? 0
        this.pitch = options.pitch ?? 0
        this.controls = []
        this.handlers = new Map()
        this.resized = 0
        this.removed = false
        this.style = options.style
        this.padding = null
        FakeBasemap.instances.push(this)
    }

    static instances = []

    /** The GL canvas a capture reads; tagged so a test can tell whose it is. */
    getCanvas() {
        if (!this._canvas) this._canvas = { width: 1000, height: 500, owner: this }
        return this._canvas
    }
    /** As the real map: the next frame draws and raises `render`. */
    triggerRepaint() { this.fire('render') }

    addControl(control) { this.controls.push(control) }
    removeControl(control) { this.controls = this.controls.filter((c) => c !== control) }
    remove() { this.removed = true }
    getCenter() { return this.center }
    getZoom() { return this.zoom }
    getBearing() { return this.bearing }
    getPitch() { return this.pitch }
    setMaxBounds() {}
    setPadding(padding) {
        this.padding = padding
        // The real libraries raise `move` for a padding change too.
        this.fire('move')
    }
    setStyle(style) { this.style = style }
    resize() { this.resized += 1 }
    on(type, handler) {
        if (!this.handlers.has(type)) this.handlers.set(type, new Set())
        this.handlers.get(type).add(handler)
    }
    off(type, handler) { this.handlers.get(type)?.delete(handler) }
    once(type, handler) {
        const wrapped = () => {
            this.off(type, wrapped)
            handler()
        }
        this.on(type, wrapped)
    }
    fire(type) {
        // Copied first: a once-handler removes itself while the set is walked.
        for (const handler of [...(this.handlers.get(type) ?? [])]) handler()
    }

    jumpTo({ center, zoom, bearing, pitch }) {
        if (center) this.center = { lng: center[0], lat: center[1] }
        if (zoom != null) this.zoom = zoom
        if (bearing != null) this.bearing = bearing
        if (pitch != null) this.pitch = pitch
        // The real libraries raise `move` for a programmatic camera write too,
        // which is exactly the echo the sync guard has to swallow.
        this.fire('move')
        this.fire('moveend')
    }
}

/**
 * An adapter in overlay mode with a fake primary basemap, positioned so the
 * container has a measurable width for the panes to divide.
 */
const makeAdapter = () => {
    const adapter = new DeckGLAdapter()
    // jsdom lays nothing out, so the width the panes divide is declared.
    Object.defineProperty(container, 'offsetWidth', { value: 1000, configurable: true })
    adapter._container = container
    adapter._isOverlayMode = true
    adapter._basemapCtor = FakeBasemap
    adapter._basemapOptions = { provider: 'maplibre', style: 'style://a' }
    adapter._basemapStyle = 'style://a'
    adapter._viewState = { longitude: -95, latitude: 38, zoom: 4, bearing: 0, pitch: 0 }
    adapter._basemap = new FakeBasemap({
        center: [-95, 38],
        zoom: 4,
        style: 'style://a',
    })
    // What `_syncLayers` writes through, and so the only way the suite can see
    // what the primary surface is given.
    adapter._overlay = {
        props: { layers: [] },
        setProps(props) {
            Object.assign(this.props, props)
        },
    }
    return adapter
}

const sideBySide = (adapter, overrides = {}) =>
    adapter.enableComparison({
        leftLayerIds: ['co2'],
        rightLayerIds: ['ch4'],
        layout: 'sideBySide',
        ...overrides,
    })

const panesIn = () =>
    Array.from(container.querySelectorAll('.mmgis-comparison-pane'))

/** The pane maps only, in creation order, excluding the primary. */
const paneMaps = (adapter) => adapter._sbsPanes.map((p) => p.map)

beforeEach(() => {
    FakeBasemap.instances = []
    container = document.createElement('div')
    document.body.appendChild(container)
    // jsdom lays nothing out, so the observer the adapter attaches needs a stub.
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
    }
})

afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
})

test.describe('DeckGLAdapter side-by-side comparison', () => {
    test('builds one map per half rather than one view drawn twice', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)

        expect(panesIn()).toHaveLength(2)
        expect(paneMaps(adapter).filter(Boolean)).toHaveLength(2)
        expect(adapter.getComparisonLayout()).toBe('sideBySide')
        expect(adapter.isComparisonEnabled()).toBe(true)
    })

    test('both panes open on the primary camera and basemap', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)

        for (const map of paneMaps(adapter)) {
            expect(map.getCenter()).toEqual({ lng: -95, lat: 38 })
            expect(map.getZoom()).toBe(4)
            expect(map.options.style).toBe('style://a')
        }
    })

    // The point of the layout: the halves meet at the divider and neither one
    // draws where the other does.
    test('panes tile the container without overlapping', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const [left, right] = panesIn()

        expect(left.style.left).toBe('0px')
        expect(left.style.width).toBe('50%')
        expect(right.style.left).toBe('50%')
        expect(right.style.width).toBe('50%')
    })

    test('moving the divider re-clips the panes', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)

        adapter.setComparisonDivider(0.3)

        const [left, right] = panesIn()
        expect(left.style.width).toBe('30%')
        expect(right.style.left).toBe('30%')
        expect(right.style.width).toBe('70%')
    })

    // Resizing a canvas drops and refetches its tiles. At mousemove rate that
    // reads as a flicker, so a drag has to leave the canvases alone.
    test('dragging the divider never resizes a canvas', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const resizesBefore = paneMaps(adapter).map((m) => m.resized)

        for (const pos of [0.45, 0.4, 0.35, 0.3]) adapter.setComparisonDivider(pos)

        paneMaps(adapter).forEach((m, i) => {
            expect(m.resized).toBe(resizesBefore[i])
        })
    })

    // Each canvas spans the whole container, so what a pane shows is a slice of
    // it. Padding away the rest is what centres each camera in its own slice.
    test('each camera is padded into the slice its pane shows', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        adapter.setComparisonDivider(0.3)
        const [left, right] = paneMaps(adapter)

        // Left shows [0, 300] of 1000; right shows the leading 700 of its own.
        expect(left.padding).toEqual({ top: 0, bottom: 0, left: 0, right: 700 })
        expect(right.padding).toEqual({ top: 0, bottom: 0, left: 0, right: 300 })
    })

    test('canvases are held at the container width, not the slice width', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        adapter.setComparisonDivider(0.2)

        for (const pane of adapter._sbsPanes) {
            expect(pane.mapDiv.style.width).toBe('1000px')
        }
    })

    // The expensive path still exists — it just belongs to container resizes.
    test('a container resize re-measures both canvases', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const resizesBefore = paneMaps(adapter).map((m) => m.resized)

        Object.defineProperty(container, 'offsetWidth', { value: 600, configurable: true })
        adapter._resizeSideBySidePanes()

        paneMaps(adapter).forEach((m, i) => {
            expect(m.resized).toBeGreaterThan(resizesBefore[i])
        })
        for (const pane of adapter._sbsPanes) {
            expect(pane.mapDiv.style.width).toBe('600px')
        }
    })

    // Padding raises `move` on the pane, which must not read as a gesture.
    test('re-clipping does not announce a camera move', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)

        const moves = []
        adapter.on('moveend', () => moves.push(adapter.getCenter()))
        adapter.setComparisonDivider(0.8)

        expect(moves).toEqual([])
        expect(adapter.getCenter()).toEqual({ lat: 38, lng: -95 })
    })

    test('dragging either pane moves the other and the primary with it', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const [left, right] = paneMaps(adapter)

        right.center = { lng: -80, lat: 30 }
        right.zoom = 6
        right.fire('moveend')

        expect(left.getCenter()).toEqual({ lng: -80, lat: 30 })
        expect(left.getZoom()).toBe(6)
        expect(adapter.getCenter()).toEqual({ lat: 30, lng: -80 })
        // The primary stays hidden underneath but is what getBounds() answers
        // from, so it has to track the view too.
        expect(adapter._basemap.getCenter()).toEqual({ lng: -80, lat: 30 })
    })

    // Writing a camera onto the other pane raises `move` there, which would
    // read as a second gesture and write straight back.
    test('the camera copy does not echo back as another move', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const [left, right] = paneMaps(adapter)

        const moves = []
        adapter.on('moveend', () => moves.push(adapter.getCenter()))

        right.center = { lng: -70, lat: 20 }
        right.fire('moveend')

        expect(moves).toEqual([{ lat: 20, lng: -70 }])
        expect(left.getCenter()).toEqual({ lng: -70, lat: 20 })
    })

    // Frames during a drag keep the panes locked; only the end of the gesture
    // is what the rest of MMGIS listens for.
    test('frames mid-drag sync the panes without announcing a settled move', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const [left, right] = paneMaps(adapter)

        const moves = []
        adapter.on('moveend', () => moves.push(adapter.getCenter()))

        right.center = { lng: -90, lat: 35 }
        right.fire('move')

        expect(left.getCenter()).toEqual({ lng: -90, lat: 35 })
        expect(moves).toEqual([])
    })

    test('a basemap swap follows into both panes', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        adapter.setBasemapStyle('style://dark')

        for (const map of paneMaps(adapter)) expect(map.style).toBe('style://dark')
    })

    test('switching to swipe takes the panes and their maps down', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        const maps = paneMaps(adapter)

        adapter.setComparisonLayout('swipe')

        expect(panesIn()).toHaveLength(0)
        expect(maps.every((m) => m.removed)).toBe(true)
        expect(adapter.getComparisonLayout()).toBe('swipe')
        expect(adapter.isComparisonEnabled()).toBe(true)
    })

    test('switching back keeps both sides and the divider where they were', () => {
        const adapter = makeAdapter()
        sideBySide(adapter)
        adapter.setComparisonDivider(0.7)
        adapter.setComparisonLayout('swipe')
        adapter.setComparisonLayout('sideBySide')

        expect(panesIn()[0].style.width).toBe('70%')
        expect(adapter._comparisonLeftIds).toEqual(['co2'])
        expect(adapter._comparisonRightIds).toEqual(['ch4'])
    })

    test('disabling removes the panes and restores the primary layers', () => {
        const adapter = makeAdapter()
        adapter._layers.set('co2', { id: 'co2', clone: () => ({ id: 'co2' }) })
        sideBySide(adapter)
        const maps = paneMaps(adapter)
        expect(adapter._overlay.props.layers).toEqual([])

        adapter.disableComparison()

        expect(panesIn()).toHaveLength(0)
        expect(maps.every((m) => m.removed)).toBe(true)
        expect(adapter._sbsPanes).toBeNull()
        expect(adapter.isComparisonEnabled()).toBe(false)
        expect(adapter._overlay.props.layers.map((l) => l.id)).toEqual(['co2'])
    })

    test('a pane re-sends its layers once its style finishes loading', () => {
        const adapter = makeAdapter()
        const layer = { id: 'co2', clone: () => ({ id: 'co2-clone' }) }
        adapter._layers.set('co2', layer)
        sideBySide(adapter)

        const [leftPane] = adapter._sbsPanes
        const setProps = vi.spyOn(leftPane.overlay, 'setProps')
        leftPane.map.fire('load')

        expect(setProps).toHaveBeenCalledWith({ layers: [{ id: 'co2-clone' }] })
    })
})

/**
 * A pane's map is built with its style still loading, and mapbox-gl throws
 * from `getStyle()` until it lands. Entering side-by-side straight away must
 * not trip over that.
 */
test.describe('DeckGLAdapter side-by-side before a pane style loads', () => {
    /** A basemap whose style is a single label layer, readable only once loaded. */
    class LoadingBasemap extends FakeBasemap {
        styleLoaded = false
        getStyle() {
            if (!this.styleLoaded) throw new Error('Style is not done loading')
            return { layers: [{ id: 'place-labels', type: 'symbol', layout: { 'text-field': '{name}' } }] }
        }
        getLayer(id) { return id === 'place-labels' ? {} : undefined }
    }

    const makeLoadingAdapter = () => {
        const adapter = makeAdapter()
        adapter._basemapCtor = LoadingBasemap
        const layer = {
            id: 'co2',
            clone: (props = {}) => ({ id: 'co2', ...props, clone: layer.clone }),
        }
        adapter._layers.set('co2', layer)
        return adapter
    }

    test('enabling side-by-side does not throw while pane styles load', () => {
        const adapter = makeLoadingAdapter()
        expect(() => sideBySide(adapter)).not.toThrow()
        expect(adapter.isComparisonEnabled()).toBe(true)
        expect(panesIn()).toHaveLength(2)
    })

    test('a pane draws its layers unanchored, then under the labels once loaded', () => {
        const adapter = makeLoadingAdapter()
        sideBySide(adapter)
        const [leftPane] = adapter._sbsPanes
        const setProps = vi.spyOn(leftPane.overlay, 'setProps')

        leftPane.map.styleLoaded = true
        leftPane.map.fire('style.load')

        const [{ layers }] = setProps.mock.calls.at(-1)
        expect(layers.map((l) => l.beforeId)).toEqual(['place-labels'])
    })
})

// ─── Capture ─────────────────────────────────────────────────────────────────
//
// A comparison is several WebGL surfaces, each readable only inside its own
// render step. The capture draws each one's strip into one output canvas in
// order, then paints the divider the screen draws as DOM.

/** A 2D output canvas that records what is drawn into it. */
const makeCaptureCanvas = () => {
    const calls = []
    const ctx = {
        fillStyle: null, strokeStyle: null, lineWidth: 0, font: '', textBaseline: '', textAlign: '',
        shadowColor: '', shadowBlur: 0,
        save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, strokeRect() {},
        fillText() {},
        drawImage: (...args) => calls.push({ op: 'drawImage', args }),
        fillRect: (...args) => calls.push({ op: 'fillRect', args }),
    }
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (cb, type) => cb(new Blob(['composed'], { type })),
    }
    return { canvas, calls }
}

const drawn = (calls) => calls.filter((c) => c.op === 'drawImage').map(({ args: [src, sx, sy, sw, sh, dx, dy, dw, dh] }) => ({ owner: src.owner, sx, sy, sw, sh, dx, dy, dw, dh }))

test.describe('captureScreenshot during a comparison', () => {
    test('side-by-side: each pane is read inside its own render and placed at its slice', async () => {
        const adapter = makeAdapter()
        Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true })
        sideBySide(adapter)
        adapter.setComparisonDivider(0.3)
        const { canvas, calls } = makeCaptureCanvas()
        adapter._createCaptureCanvas = () => canvas
        const [left, right] = paneMaps(adapter)

        const result = await adapter.captureScreenshot()

        expect([canvas.width, canvas.height]).toEqual([1000, 500])
        expect(drawn(calls)).toEqual([
            { owner: left, sx: 0, sy: 0, sw: 300, sh: 500, dx: 0, dy: 0, dw: 300, dh: 500 },
            { owner: right, sx: 0, sy: 0, sw: 700, sh: 500, dx: 300, dy: 0, dw: 700, dh: 500 },
        ])
        // The rule sits on the divider, drawn after both strips.
        const rule = calls.find((c) => c.op === 'fillRect')
        expect(rule.args).toEqual([298.5, 0, 3, 500])
        expect(calls.indexOf(rule)).toBeGreaterThan(calls.findIndex((c) => c.op === 'drawImage'))
        // Sized from the primary's canvas, which is never drawn: it holds
        // nothing while comparison is on.
        expect(result).toMatchObject({ mimeType: 'image/png', width: 1000, height: 500 })
        expect(drawn(calls).map((d) => d.owner)).not.toContain(adapter._basemap)
    })

    test('side-by-side: a pane that never renders times out rather than hanging', async () => {
        vi.useFakeTimers()
        try {
            const adapter = makeAdapter()
            sideBySide(adapter)
            const { canvas } = makeCaptureCanvas()
            adapter._createCaptureCanvas = () => canvas
            const [left] = paneMaps(adapter)
            left.triggerRepaint = () => {}

            const capture = adapter.captureScreenshot()
            const failed = expect(capture).rejects.toThrow(/timed out/)
            await vi.advanceTimersByTimeAsync(3001)
            await failed
        } finally {
            vi.useRealTimers()
        }
    })

    test('swipe: the primary basemap under both followers, each clipped at the divider', async () => {
        const adapter = makeAdapter()
        Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true })
        const fakeDeck = (name) => {
            const canvas = { width: 1000, height: 500, owner: name }
            return { redraws: [], redraw(reason) { this.redraws.push(reason) }, getCanvas: () => canvas }
        }
        adapter._comparisonEnabled = true
        adapter._comparisonLayout = 'swipe'
        adapter._comparisonDividerPos = 0.3
        adapter._comparisonLeftDeck = fakeDeck('left')
        adapter._comparisonRightDeck = fakeDeck('right')
        const { canvas, calls } = makeCaptureCanvas()
        adapter._createCaptureCanvas = () => canvas

        await adapter.captureScreenshot()

        expect(drawn(calls)).toEqual([
            { owner: adapter._basemap, sx: 0, sy: 0, sw: 1000, sh: 500, dx: 0, dy: 0, dw: 1000, dh: 500 },
            { owner: 'left', sx: 0, sy: 0, sw: 300, sh: 500, dx: 0, dy: 0, dw: 300, dh: 500 },
            { owner: 'right', sx: 300, sy: 0, sw: 700, sh: 500, dx: 300, dy: 0, dw: 700, dh: 500 },
        ])
        expect(adapter._comparisonLeftDeck.redraws).toEqual(['screenshot'])
    })

    // The captions are DOM the screen draws; the image carries them as chips.
    test('paints the captions where the screen shows them', async () => {
        const adapter = makeAdapter()
        Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true })
        container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 })
        for (const [side, text, left] of [['left', 'PM2.5', 12], ['right', 'Ozone', 512]]) {
            const el = document.createElement('div')
            el.className = `mmgis-comparison-label mmgis-comparison-label--${side}`
            el.textContent = text
            el.getBoundingClientRect = () => ({ left, top: 12, width: 80, height: 26 })
            container.appendChild(el)
        }
        sideBySide(adapter)
        const { canvas } = makeCaptureCanvas()
        adapter._createCaptureCanvas = () => canvas
        const ctx = canvas.getContext()
        const texts = []
        ctx.fillText = (text, x, y) => texts.push([text, x, y])

        await adapter.captureScreenshot()

        expect(texts).toEqual([
            ['PM2.5', 22, 25],
            ['Ozone', 522, 25],
        ])
    })

    test('with comparison off, the capture is the single basemap read as before', async () => {
        const adapter = makeAdapter()
        const basemap = adapter._basemap
        basemap.getCanvas = () => ({
            width: 640,
            height: 480,
            toBlob: (cb, type) => cb(new Blob(['one'], { type })),
        })

        const result = await adapter.captureScreenshot()

        expect(result).toMatchObject({ width: 640, height: 480 })
    })
})
