/**
 * DeckGL map engine adapter implementing {@link IMapEngine}.
 *
 * Translates the imperative IMapEngine interface into deck.gl's declarative
 * layer-array and controlled-viewState patterns.
 *
 * **Modes**
 *
 * - *Standalone* (default) — a bare `Deck` instance renders on a transparent
 *   canvas. No basemap library is loaded.
 * - *Overlay* — a mapbox-gl or maplibre-gl `Map` provides the basemap; a
 *   `MapboxOverlay` from `@deck.gl/mapbox` attaches deck.gl layers on top.
 *   Pass {@link BasemapOptions} via `MapInitOptions.basemap` to activate this mode.
 *
 * **Coordinate convention**: IMapEngine uses `{lat, lng}` objects (or `[lat, lng]`
 * tuples in Leaflet order). deck.gl uses `{longitude, latitude}` and `[lng, lat]`
 * GeoJSON order. All conversion is internal to this adapter.
 */

import {
    Deck,
    MapView,
    FlyToInterpolator,
    LinearInterpolator,
    type PickingInfo,
    type Layer,
} from '@deck.gl/core'

import { MapboxOverlay } from '@deck.gl/mapbox'
import { Map as MaplibreGLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { 
    IMapEngine, 
    ComparisonConfig, 
    ComparisonLayout,
    MapScreenshotResult 
} from '../IMapEngine'
import { MAP_ENGINE } from '../types/engine'
import type { MapEngineType } from '../types/engine'
import type { LatLng, LatLngLike, BoundsLike, PointLike } from '../types/geometry'
import type {
    ViewState,
    ViewOptions,
    FlyToOptions,
    FitBoundsOptions,
    MapInitOptions,
    BasemapOptions,
} from '../types/view'
import type { LayerOptions, OverlayOptions, RefreshContext } from '../types/layers'
import type {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
    DrawShape,
} from '../types/events'

import {
    type DeckViewState,
    resolveLatLng,
    resolveBounds,
    resolvePoint,
    resolvePadding,
    makeViewport,
    resolveLayerId,
    pickInfoToResult,
    buildDeckLayer,
} from './DeckGLHelpers'
import {
    TerraDraw,
    TerraDrawPointMode,
    TerraDrawLineStringMode,
    TerraDrawPolygonMode,
    TerraDrawRectangleMode,
    TerraDrawCircleMode,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import {
    committedVerticesFromChange,
    DrawEndClickGuard,
    drawModeKeyEvents,
    DrawPointerWatch,
    drawStyles,
    validateDrawnLineString,
} from './DrawingHelpers'

/**
 * Minimal API surface that is identical between mapbox-gl and maplibre-gl `Map` instances.
 * Defined as a local interface so neither library is a hard compile-time dependency.
 */
interface BasemapInstance {
    /** Attach a deck.gl `MapboxOverlay` (or any IControl) to the map. */
    addControl(control: object): void
    /** Detach a previously added control from the map. */
    removeControl(control: object): void
    /** Destroy the map and release all resources. */
    remove(): void
    /** Move the map centre without animation. `center` is `[longitude, latitude]`. */
    setCenter(center: [number, number]): unknown
    /** Set the zoom level without animation. */
    setZoom(zoom: number): unknown
    /** Return the current map centre as `{lat, lng}`. */
    getCenter(): { lat: number; lng: number }
    /** Return the current zoom level. */
    getZoom(): number
    /** Return the current bearing (rotation) in degrees. */
    getBearing(): number
    /** Return the current pitch (tilt) in degrees. */
    getPitch(): number
    /** Return the current visible bounds. */
    getBounds(): {
        getSouthWest(): { lat: number; lng: number }
        getNorthEast(): { lat: number; lng: number }
    }
    /**
     * Set the padding, in pixels, around the viewport the camera centres in.
     * Preserves the centre and zoom, and reallocates nothing.
     */
    setPadding(padding: {
        top: number
        bottom: number
        left: number
        right: number
    }): unknown
    /** Move the camera to a new position with no animation. */
    jumpTo(options: {
        center?: [number, number]
        zoom?: number
        bearing?: number
        pitch?: number
    }): unknown
    /** Animate the camera to a new position using a fly-to curve. */
    flyTo(options: {
        center?: [number, number]
        zoom?: number
        bearing?: number
        pitch?: number
        speed?: number
        curve?: number
        duration?: number
        essential?: boolean
    }): unknown
    /** Animate the viewport to contain the given bounds. */
    fitBounds(
        bounds: [[number, number], [number, number]],
        options?: {
            padding?: number | { top: number; right: number; bottom: number; left: number }
            maxZoom?: number
        }
    ): unknown
    /** Restrict panning to the given bounding box. Pass `null` to remove the constraint. */
    setMaxBounds(bounds: [[number, number], [number, number]] | null): unknown
    /** Register a map event listener (e.g. `'load'`, `'move'`, `'moveend'`). */
    on(type: string, handler: (...args: unknown[]) => void): unknown
    /** Register a one-shot map event listener that auto-removes after firing once. */
    once(type: string, handler: (...args: unknown[]) => void): unknown
    /** Remove a previously registered map event listener. */
    off(type: string, handler: (...args: unknown[]) => void): unknown
    /** Recalculate the map size from its container element. */
    resize(): void
    /** Switch the map to a different style URL at runtime. */
    setStyle(styleUrl: string): unknown
    /** Return the style layer with the given id, or `undefined` if it is not in the style. */
    getLayer(id: string): unknown
    /** Return the WebGL canvas element the base map renders into. */
    getCanvas(): HTMLCanvasElement
    /** Schedule a re-render on the next animation frame (mapbox-gl + maplibre-gl). */
    triggerRepaint(): void
}

/**
 * One half of a side-by-side comparison: a clipped div holding a map of its
 * own, so the two halves meet at the divider instead of overlapping.
 *
 * Overlay mode fills `map` + `overlay`; standalone mode (no basemap) fills
 * `deck`. `offMap` detaches whichever listeners were attached.
 */
interface SideBySidePane {
    /** The clipping slice. Its width is what the divider moves. */
    div: HTMLElement
    /**
     * The basemap's own element inside the slice, held at the full container
     * width so the divider never resizes a canvas. Null in standalone mode,
     * where the deck fills the slice directly.
     */
    mapDiv: HTMLElement | null
    map: BasemapInstance | null
    overlay: MapboxOverlay | null
    deck: Deck | null
    offMap: () => void
}

/**
 * How long {@link DeckGLAdapter.captureScreenshot} waits for the basemap's
 * `render` event before rejecting. Generous enough for a slow first frame,
 * short enough that a dead map fails fast.
 */
const SCREENSHOT_RENDER_TIMEOUT_MS = 3000

/**
 * Prefix on the MapLibre layers terra-draw renders the in-progress drawing
 * into. Passed to `TerraDrawMapLibreGLAdapter` explicitly, so this file sets
 * the ids rather than inheriting whatever the library defaults to.
 */
const TERRA_DRAW_PREFIX = 'td'

/**
 * Bottom of the terra-draw stack: its MapLibre adapter registers the polygon
 * fill layer first.
 */
const TERRA_DRAW_BOTTOM_LAYER_ID = `${TERRA_DRAW_PREFIX}-polygon`

/**
 * Sort rank for a layer that was never given an explicit z-index.
 *
 * Every layer of the configured mission stack is ranked through
 * {@link DeckGLAdapter.setLayerZIndex} as it is added, so the unranked layers
 * are the ones added on top of that stack afterwards — plugin overlays such as
 * a selection highlight. Ranking them above every assigned index keeps them
 * there.
 */
const UNRANKED_Z_INDEX = Number.MAX_SAFE_INTEGER

function canvasToPngScreenshot(canvas: HTMLCanvasElement): Promise<MapScreenshotResult> {
    return new Promise((resolve, reject) => {
        if (typeof canvas.toBlob !== 'function') {
            reject(new Error('[DeckGLAdapter] captureScreenshot: canvas.toBlob is unavailable'))
            return
        }
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('[DeckGLAdapter] captureScreenshot: canvas.toBlob returned null'))
                return
            }
            resolve({
                blob,
                mimeType: 'image/png',
                extension: 'png',
                width: canvas.width,
                height: canvas.height,
            })
        }, 'image/png')
    })
}

/**
 * DeckGL map engine adapter.
 *
 * **Standalone mode** wraps a `Deck` instance in controlled viewState mode. All layer
 * mutations rebuild the declarative layers array and call `deck.setProps({ layers })`
 * so deck.gl diffs and re-renders only what changed.
 *
 * **Overlay mode** creates a mapbox-gl or maplibre-gl base map, then attaches a
 * `MapboxOverlay` to it so deck.gl layers render on top of vector-tile styles.
 *
 * @example Standalone mode
 * ```ts
 * const engine = new DeckGLAdapter()
 * await engine.init({ containerId: 'map', zoom: 4, center: { lat: 0, lng: 0 } })
 * ```
 *
 * @example Overlay mode with MapLibre
 * ```ts
 * const engine = new DeckGLAdapter()
 * await engine.init({
 *   containerId: 'map',
 *   zoom: 4,
 *   center: { lat: 0, lng: 0 },
 *   basemap: { provider: 'maplibre', style: 'https://demotiles.maplibre.org/style.json' },
 * })
 * ```
 *
 * @example Overlay mode with Mapbox
 * ```ts
 * const engine = new DeckGLAdapter()
 * await engine.init({
 *   containerId: 'map',
 *   zoom: 4,
 *   center: { lat: 0, lng: 0 },
 *   basemap: {
 *     provider: 'mapbox',
 *     style: 'mapbox://styles/mapbox/streets-v12',
 *     accessToken: 'pk.ey...',
 *   },
 * })
 * ```
 */
export class DeckGLAdapter implements IMapEngine<Deck, Layer, PickingInfo> {
    readonly engineType: MapEngineType = MAP_ENGINE.DECKGL

    private _container!: HTMLElement

    /** Active in standalone mode only. Null in overlay mode. */
    private _deck: Deck | null = null

    /** Active in overlay mode only. Null in standalone mode. */
    private _basemap: BasemapInstance | null = null

    /** Active in overlay mode only. Null in standalone mode. */
    private _overlay: MapboxOverlay | null = null

    /** True when the adapter was initialised with a {@link BasemapOptions} configuration. */
    private _isOverlayMode = false

    private _viewState: DeckViewState = {
        longitude: 0,
        latitude: 0,
        zoom: 2,
        bearing: 0,
        pitch: 0,
    }

    private _minZoom = 0
    private _maxZoom = 20
    private _maxBounds: BoundsLike | null = null

    private _layers = new Map<string, Layer>()
    /**
     * Layer ids already reported as not-a-deck-layer, so a slider drag warns
     * once rather than on every frame.
     */
    private _warnedNonDeckLayers = new Set<string>()

    /**
     * Whether the engine holds a real deck.gl layer under `id`. Warns once per
     * id when it holds something else — see {@link updateLayer}.
     */
    private _holdsDeckLayer(id: string, existing: unknown): boolean {
        if (typeof (existing as Layer)?.clone === 'function') return true
        if (existing != null && !this._warnedNonDeckLayers.has(id)) {
            this._warnedNonDeckLayers.add(id)
            console.warn(
                `DeckGLAdapter: layer "${id}" is not a deck.gl layer, so it cannot be ` +
                `updated. It was built with Leaflet because this engine has no builder ` +
                `for its type. The update was skipped.`
            )
        }
        return false
    }

    /** Per-layer refresh hooks, keyed by layer id. */
    private _refreshers = new Map<string, (layer: Layer, ctx: RefreshContext) => Layer | void>()
    private _layerZIndices = new Map<string, number>()
    private _layerIdCounter = 0

    private _eventListeners = new Map<string, Set<MapEventHandler<PickingInfo>>>()
    private _featureClickHandler: FeatureInteractionHandler | null = null
    private _featureHoverHandler: FeatureInteractionHandler | null = null

    private _drawingShape: DrawShape | null = null
    private _terraDraw: TerraDraw | null = null
    private _terraDrawListeners: Array<() => void> = []
    private _drawEndClick = new DrawEndClickGuard()
    private _drawPointers = new DrawPointerWatch()

    /** Registry of anchored HTML overlays (id -> teardown function). */
    private _overlays = new Map<string, () => void>()

    // ── Comparison / swipe state ──────────────────────────────────────────────
    // Comparison renders each side into its own dedicated `Deck` canvas stacked
    // over the primary map. The primary keeps its basemap but hides its data
    // layers (see `_syncLayers`); each side canvas renders only its assigned
    // layers and is revealed by a CSS clip driven by the divider position. Both
    // side canvases follow the primary camera (controller-less, view-only) so the
    // basemap + data stay aligned while the user pans/zooms the primary map.
    private _comparisonEnabled = false
    private _comparisonDividerPos = 0.5
    private _comparisonLeftIds: string[] = []
    private _comparisonRightIds: string[] = []
    /**
     * Deck props overriding each side's layers, keyed by layer id. Empty means
     * both sides clone the live layer verbatim, which draws them identically.
     */
    private _comparisonLeftProps: Record<string, Record<string, unknown>> = {}
    private _comparisonRightProps: Record<string, Record<string, unknown>> = {}
    private _comparisonLeftDeck: Deck | null = null
    private _comparisonRightDeck: Deck | null = null
    private _comparisonLeftDiv: HTMLElement | null = null
    private _comparisonRightDiv: HTMLElement | null = null
    /**
     * Watches the container for size changes while comparison is active so the
     * side canvases redraw and the clip stays aligned. `invalidateSize()` isn't
     * reliably called on every layout change (e.g. the modern UI's docked-panel
     * resizes only dispatch a synthetic `window` resize event), so this observes
     * the container directly instead of depending on that call chain.
     */
    private _comparisonResizeObserver: ResizeObserver | null = null

    // ── Side-by-side comparison state ─────────────────────────────────────────
    // The other way of splitting the viewport: rather than one camera drawn
    // twice and wiped between, each half gets a map of its own — basemap
    // included — and the two cameras are held to the same centre and zoom. That
    // is what lets a place be seen under both layers at once.
    private _comparisonLayout: ComparisonLayout = 'swipe'
    /** `[left, right]` while the side-by-side layout is mounted. */
    private _sbsPanes: [SideBySidePane, SideBySidePane] | null = null
    /**
     * Held true while one pane's camera is being copied onto the others, so the
     * `move` those copies raise is ignored rather than echoed back.
     */
    private _sbsSyncing = false

    /**
     * The basemap constructor and options the panes rebuild from. Overlay mode
     * resolves its map class through a dynamic import, so the class is kept
     * rather than imported again, and the style tracks runtime basemap swaps so
     * a pane opens on the basemap the user is actually looking at.
     */
    private _basemapCtor:
        | (new (options: Record<string, unknown>) => BasemapInstance)
        | null = null
    private _basemapOptions: BasemapOptions | null = null
    private _basemapStyle: string | null = null

    /**
     * Copy the basemap's camera into `_viewState` and re-emit it under
     * `eventName`, so that {@link projectCoordinates} and
     * {@link unprojectCoordinates} stay accurate mid-animation and anchored
     * consumers can track the camera frame by frame.
     */
    private _syncViewState = (eventName: 'move' | 'moveend'): void => {
        if (this._sbsSyncing) return
        const center = this._basemap!.getCenter()
        this._viewState = {
            ...this._viewState,
            longitude: center.lng,
            latitude: center.lat,
            zoom: this._basemap!.getZoom(),
            bearing: this._basemap!.getBearing(),
            pitch: this._basemap!.getPitch(),
        }
        if (this._comparisonEnabled) this._syncComparisonCamera()
        this._emitEvent(eventName, this._viewState)
    }

    /** Bound handler kept as a class field so it can be removed cleanly in {@link destroy}. */
    private _onBasemapMoveEnd = (): void => this._syncViewState('moveend')

    /** Bound handler kept as a class field for clean removal. */
    private _onBasemapMove = (): void => this._syncViewState('move')

    /**
     * Re-push layers once the basemap style has loaded.
     *
     * deck.gl's interleaved `resolveLayers()` silently drops any layers set via
     * `setProps` before `map.style._loaded` is true. Layers added during MMGIS
     * startup (which runs synchronously right after `init`, while the style is
     * still fetching) are therefore never inserted — the map shows only the
     * basemap until some later `setProps` runs post-load. This flush is that
     * post-load `setProps`, re-inserting everything buffered in `_layers`.
     */
    private _onBasemapLoad = (): void => {
        this._syncLayers()
    }

    /**
     * Create and mount the map inside the element identified by `options.containerId`.
     *
     * Returns `void` (synchronous) for standalone mode and MapLibre overlay mode.
     * Returns `Promise<void>` for Mapbox overlay mode because `mapbox-gl` must be
     * loaded via a dynamic import. Callers that pass `basemap.provider: 'mapbox'`
     * must await the returned Promise before interacting with the engine.
     *
     * @throws {Error} If the container element is not found in the DOM.
     * @throws {Error} If `provider` is `'mapbox'` and `mapbox-gl` is not installed.
     */
    init(options: MapInitOptions): void | Promise<void> {
        const container = document.getElementById(options.containerId)
        if (!container) {
            throw new Error(`DeckGLAdapter: container element #${options.containerId} not found`)
        }
        this._container = container
        this._minZoom = options.minZoom ?? 0
        this._maxZoom = options.maxZoom ?? 20
        this._maxBounds = options.maxBounds ?? null

        const center = options.center ? resolveLatLng(options.center) : { lat: 0, lng: 0 }
        this._viewState = {
            longitude: center.lng,
            latitude: center.lat,
            zoom: options.zoom ?? 2,
            bearing: options.bearing ?? 0,
            pitch: options.pitch ?? 0,
            minZoom: this._minZoom,
            maxZoom: this._maxZoom,
        }

        if (options.basemap?.provider === 'mapbox') {
            return this._initOverlayModeMapbox(options.basemap)
        }
        if (options.basemap?.provider === 'maplibre') {
            this._setupOverlay(
                MaplibreGLMap as unknown as new (o: Record<string, unknown>) => BasemapInstance,
                options.basemap
            )
            return
        }
        this._initStandaloneMode()
    }

    /**
     * Tear down the map, release all resources, and clear all listeners.
     * The adapter must not be used again after this call.
     */
    destroy(): void {
        // End a live session the normal way, while its listeners are still
        // attached, so its initiator hears `drawcancel` and stops driving a
        // session that is about to have no engine.
        this.disableDrawing()

        this._drawEndClick.dispose()
        this._drawPointers.stop()

        if (this._terraDraw) {
            this._terraDrawListeners.forEach((off) => { try { off() } catch { /* ignore */ } })
            this._terraDrawListeners = []
            try { this._terraDraw.stop() } catch { /* ignore */ }
            this._terraDraw = null
        }

        this._comparisonEnabled = false
        this._destroyComparisonSurfaces()

        if (this._isOverlayMode) {
            if (this._basemap) {
                this._basemap.off('move', this._onBasemapMove)
                this._basemap.off('moveend', this._onBasemapMoveEnd)
                this._basemap.off('load', this._onBasemapLoad)
                if (this._overlay) {
                    this._overlay.finalize()
                    this._basemap.removeControl(this._overlay as unknown as object)
                    this._overlay = null
                }
                this._basemap.remove()
                this._basemap = null
            }
        } else {
            this._deck?.finalize()
            this._deck = null
        }

        this._overlays.forEach((teardown) => {
            try {
                teardown()
            } catch {
                // ignore — destroy must remain idempotent
            }
        })
        this._overlays.clear()

        this._layers.clear()
        this._warnedNonDeckLayers.clear()
        this._refreshers.clear()
        this._layerZIndices.clear()
        this._eventListeners.clear()
        this._featureClickHandler = null
        this._featureHoverHandler = null
        this._isOverlayMode = false
    }

    /**
     * Returns the internal `Deck` instance.
     *
     * - Standalone mode: the top-level `Deck` object.
     * - Overlay mode: the `Deck` instance embedded inside the `MapboxOverlay`.
     *
     * To access the underlying mapbox-gl / maplibre-gl `Map` in overlay mode,
     * use {@link getBasemap} instead.
     */
    getNativeMap(): Deck {
        if (this._isOverlayMode) {
            return (this._overlay as unknown as { deck: Deck })?.deck
        }
        return this._deck as Deck
    }

    /**
     * Returns the mapbox-gl or maplibre-gl `Map` instance when running in overlay mode.
     * Returns `null` in standalone mode.
     */
    getBasemap(): BasemapInstance | null {
        return this._basemap
    }

    /**
     * Switch the basemap to a different style URL.
     *
     * Loading a style replaces every layer on the map, terra-draw's included,
     * and terra-draw does not register its layers again. So a live drawing
     * session is ended before the swap. That emits `drawcancel`, which tells
     * consumers the session is over, and it lets {@link _syncLayers} drop the
     * terra-draw anchor while the layers it points at are still in the style.
     */
    setBasemapStyle(styleUrl: string): boolean {
        if (!this._basemap) return false
        this.disableDrawing()
        this._basemap.setStyle(styleUrl)
        this._basemapStyle = styleUrl
        this._sbsPanes?.forEach((pane) => pane.map?.setStyle(styleUrl))
        return true
    }

    getContainer(): HTMLElement {
        return this._container
    }

    /**
     * Capture the current map view as a PNG Blob screenshot result.
     *
     * WebGL clears its drawing buffer once the browser presents a frame, so
     * `canvas.toDataURL()` only returns pixels if the read happens before
     * that clear. Rather than paying the per-frame cost of creating the GL
     * context with `preserveDrawingBuffer: true`, we capture on demand:
     * overlay mode reads the shared (interleaved) canvas inside a
     * `once('render')` handler after `triggerRepaint()` — the render event
     * fires before the browser presents/clears the buffer; standalone mode
     * reads right after `deck.redraw(reason)`, which draws synchronously in
     * deck.gl v9, so the buffer is still valid within the same task.
     *
     * Captures only the GL canvas: HTML overlays/markers added via
     * {@link addOverlay} are separate DOM nodes and are not included.
     */
    captureScreenshot(): Promise<MapScreenshotResult> {
        return new Promise<MapScreenshotResult>((resolve, reject) => {
            try {
                if (this._isOverlayMode && this._basemap) {
                    const basemap = this._basemap
                    const onRender = () => {
                        clearTimeout(timeout)
                        canvasToPngScreenshot(basemap.getCanvas()).then(
                            resolve,
                            reject
                        )
                    }
                    const timeout = setTimeout(() => {
                        // Unhook, or the listener stays armed to fire a wasted
                        // capture on some later render (e.g. backgrounded tab).
                        basemap.off('render', onRender)
                        reject(
                            new Error(
                                '[DeckGLAdapter] captureScreenshot: timed out waiting for the basemap render event'
                            )
                        )
                    }, SCREENSHOT_RENDER_TIMEOUT_MS)
                    basemap.once('render', onRender)
                    basemap.triggerRepaint()
                    return
                }

                const deck = this._deck
                if (!deck) {
                    reject(new Error('[DeckGLAdapter] captureScreenshot: no active map to capture'))
                    return
                }
                deck.redraw('screenshot')
                const canvas = (deck as unknown as { getCanvas?: () => HTMLCanvasElement })
                    .getCanvas?.()
                if (!canvas) {
                    reject(
                        new Error('[DeckGLAdapter] captureScreenshot: deck canvas unavailable')
                    )
                    return
                }
                canvasToPngScreenshot(canvas).then(resolve, reject)
            } catch (err) {
                reject(err as Error)
            }
        })
    }

    /**
     * Anchored HTML overlay. deck.gl renders to canvas and has no native
     * overlay system, so we own the DOM node directly: append to the
     * container, project lat/lng -> pixel on every view change, reposition.
     *
     * @deprecated Superseded by the `map:showPopup` provider.
     */
    addOverlay(options: OverlayOptions): void {
        if (!options?.id) {
            throw new Error('addOverlay: options.id is required')
        }
        if (this._overlays.has(options.id)) {
            this.removeOverlay(options.id)
        }

        const container = this._container
        if (!container) return

        const node = document.createElement('div')
        node.style.position = 'absolute'
        // Above the deck.gl canvas (~0) and the maplibre/mapbox basemap canvas.
        // Lower than LeafletAdapter's overlay (1000) because deck.gl has no
        // competing UI panes layered above us — there's nothing else fighting
        // for hit-testing at this point on the stack.
        node.style.zIndex = '500'
        container.appendChild(node)

        let userCleanup: (() => void) | void
        try {
            userCleanup = options.mount(node)
        } catch (err) {
            console.warn('[DeckGLAdapter] addOverlay mount threw:', err)
        }

        const reposition = (): void => {
            try {
                const pt = this.latLngToContainerPoint(options.latlng) as {
                    x: number
                    y: number
                }
                node.style.left = pt.x - node.offsetWidth / 2 + 'px'
                node.style.top = pt.y - node.offsetHeight / 2 + 'px'
            } catch {
                // projection not ready yet — try again on next view change
            }
        }
        reposition()
        this.on('move', reposition)
        this.on('moveend', reposition)

        this._overlays.set(options.id, () => {
            this.off('move', reposition)
            this.off('moveend', reposition)
            try {
                if (typeof userCleanup === 'function') userCleanup()
            } catch (err) {
                console.warn('[DeckGLAdapter] addOverlay cleanup threw:', err)
            }
            if (node.parentNode) node.parentNode.removeChild(node)
        })
    }

    removeOverlay(id: string): void {
        const teardown = this._overlays.get(id)
        if (!teardown) return
        teardown()
        this._overlays.delete(id)
    }

    setView(center: LatLngLike, zoom?: number, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(center)
        if (this._isOverlayMode) {
            this._basemap!.setCenter([lng, lat])
            if (zoom !== undefined) this._basemap!.setZoom(zoom)
            return
        }
        this._applyViewState(
            {
                ...this._viewState,
                longitude: lng,
                latitude: lat,
                ...(zoom !== undefined ? { zoom } : {}),
            },
            options
        )
    }

    setZoom(zoom: number, options?: ViewOptions): void {
        if (this._isOverlayMode) {
            this._basemap!.setZoom(zoom)
            return
        }
        this._applyViewState({ ...this._viewState, zoom }, options)
    }

    setCenter(center: LatLngLike, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(center)
        if (this._isOverlayMode) {
            this._basemap!.setCenter([lng, lat])
            return
        }
        this._applyViewState({ ...this._viewState, longitude: lng, latitude: lat }, options)
    }

    getZoom(): number {
        if (this._isOverlayMode) {
            return this._basemap!.getZoom()
        }
        return this._viewState.zoom
    }

    getMinZoom(): number {
        return this._minZoom
    }

    getMaxZoom(): number {
        return this._maxZoom
    }

    getCenter(): LatLng {
        if (this._isOverlayMode) {
            const c = this._basemap!.getCenter()
            return { lat: c.lat, lng: c.lng }
        }
        return { lat: this._viewState.latitude, lng: this._viewState.longitude }
    }

    /**
     * Returns the geographic bounds currently visible.
     *
     * - Overlay mode: handed straight to the basemap's `getBounds()`.
     * - Standalone mode: all four container corners are unprojected through
     *   `WebMercatorViewport`, and the answer is the smallest north-up box
     *   around those four points.
     *
     * All four corners are read because the map can be rotated — drag-rotate
     * is enabled, and the view state carries bearing and pitch — so a corner
     * of the screen is not a corner of the compass. Past 90° of bearing the
     * bottom-left pixel unprojects north-east of the top-right one. Taking the
     * min and max across every corner keeps south below north and west below
     * east at any angle, and covers the whole rotated rectangle rather than
     * just its diagonal.
     */
    getBounds(): BoundsLike {
        if (this._isOverlayMode) {
            const b = this._basemap!.getBounds()
            const sw = b.getSouthWest()
            const ne = b.getNorthEast()
            return {
                southWest: { lat: sw.lat, lng: sw.lng },
                northEast: { lat: ne.lat, lng: ne.lng },
            }
        }
        const vp = makeViewport(this._viewState, this._container)
        const { offsetWidth: w, offsetHeight: h } = this._container
        const corners: [number, number][] = [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
        ]
        const unprojected = corners.map((c) => vp.unproject(c) as [number, number])
        const lngs = unprojected.map(([lng]) => lng)
        const lats = unprojected.map(([, lat]) => lat)
        return {
            southWest: { lat: Math.min(...lats), lng: Math.min(...lngs) },
            northEast: { lat: Math.max(...lats), lng: Math.max(...lngs) },
        }
    }

    getViewState(): ViewState {
        if (this._isOverlayMode) {
            const c = this._basemap!.getCenter()
            return {
                center: { lat: c.lat, lng: c.lng },
                zoom: this._basemap!.getZoom(),
                bearing: this._viewState.bearing,
                pitch: this._viewState.pitch,
            }
        }
        return {
            center: { lat: this._viewState.latitude, lng: this._viewState.longitude },
            zoom: this._viewState.zoom,
            bearing: this._viewState.bearing,
            pitch: this._viewState.pitch,
        }
    }

    setViewState(state: ViewState, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(state.center)
        if (this._isOverlayMode) {
            if (options?.animate) {
                this._basemap!.flyTo({
                    center: [lng, lat],
                    zoom: state.zoom,
                    bearing: state.bearing,
                    pitch: state.pitch,
                    duration: options.duration,
                    essential: true,
                })
            } else {
                this._basemap!.setCenter([lng, lat])
                this._basemap!.setZoom(state.zoom)
            }
            return
        }
        this._applyViewState(
            {
                ...this._viewState,
                longitude: lng,
                latitude: lat,
                zoom: state.zoom,
                bearing: state.bearing ?? this._viewState.bearing,
                pitch: state.pitch ?? this._viewState.pitch,
            },
            options
        )
    }

    setMaxBounds(bounds: BoundsLike | null): void {
        this._maxBounds = bounds
        if (this._isOverlayMode && this._basemap) {
            const resolved = bounds ? resolveBounds(bounds) : null
            this._basemap.setMaxBounds(resolved)
        }
    }

    /**
     * Fit the viewport to the given bounds.
     *
     * - Overlay mode: delegates to the basemap's `fitBounds`.
     * - Standalone mode: computes the target view via `WebMercatorViewport.fitBounds`
     *   and applies it with the appropriate transition.
     */
    fitBounds(bounds: BoundsLike, options?: FitBoundsOptions): void {
        const [[west, south], [east, north]] = resolveBounds(bounds)
        if (this._isOverlayMode) {
            this._basemap!.fitBounds(
                [[west, south], [east, north]],
                {
                    padding: resolvePadding(options?.padding) as
                        | number
                        | { top: number; right: number; bottom: number; left: number },
                    ...(options?.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
                }
            )
            return
        }
        const fitted = makeViewport(this._viewState, this._container).fitBounds(
            [[west, south], [east, north]],
            {
                padding: resolvePadding(options?.padding),
                ...(options?.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
            }
        )
        this._applyViewState(
            {
                ...this._viewState,
                longitude: fitted.longitude,
                latitude: fitted.latitude,
                zoom: fitted.zoom,
            },
            options
        )
    }

    /**
     * Animate the camera along a fly-to curve.
     *
     * - Overlay mode: delegates to the basemap's `flyTo`.
     * - Standalone mode: uses deck.gl's `FlyToInterpolator`.
     */
    flyTo(options: FlyToOptions): void {
        const { lat, lng } = resolveLatLng(options.center)
        if (this._isOverlayMode) {
            this._basemap!.flyTo({
                center: [lng, lat],
                ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
                ...(options.bearing !== undefined ? { bearing: options.bearing } : {}),
                ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
                speed: options.speed ?? 1.2,
                curve: options.curve ?? 1.414,
                ...(options.duration !== undefined ? { duration: options.duration } : {}),
                essential: true,
            })
            return
        }
        const transitionDuration = options.duration ?? 1000
        this._applyViewState(
            {
                ...this._viewState,
                longitude: lng,
                latitude: lat,
                ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
                ...(options.bearing !== undefined ? { bearing: options.bearing } : {}),
                ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
                transitionInterpolator: new FlyToInterpolator({
                    speed: options.speed ?? 1.2,
                    curve: options.curve ?? 1.414,
                }),
                transitionDuration,
            },
            { animate: true, duration: transitionDuration }
        )
    }

    /**
     * Smoothly pan the camera to a new centre.
     *
     * - Overlay mode: delegates to the basemap's `flyTo` with no zoom change.
     * - Standalone mode: uses deck.gl's `LinearInterpolator` over longitude/latitude.
     */
    panTo(center: LatLngLike, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(center)
        const duration = options?.duration ?? 300
        if (this._isOverlayMode) {
            this._basemap!.flyTo({
                center: [lng, lat],
                duration,
                essential: false,
            })
            return
        }
        this._applyViewState(
            {
                ...this._viewState,
                longitude: lng,
                latitude: lat,
                transitionInterpolator: new LinearInterpolator(['longitude', 'latitude']),
                transitionDuration: duration,
            },
            { ...options, animate: true, duration }
        )
    }

    /**
     * Force a full redraw / container resize.
     *
     * - Overlay mode: calls `basemap.resize()` which triggers MapLibre/Mapbox to
     *   recalculate its canvas dimensions; the `MapboxOverlay` inherits the new size.
     * - Standalone mode: calls `deck.redraw('invalidateSize')`.
     */
    invalidateSize(): void {
        if (this._isOverlayMode) {
            this._basemap?.resize()
        } else {
            this._deck?.redraw('invalidateSize')
        }
        this._handleComparisonResize()
    }

    getSize(): PointLike {
        return { x: this._container.offsetWidth, y: this._container.offsetHeight }
    }

    getLayers(): Layer[] {
        return [...this._layers.values()]
    }

    hasLayer(layer: Layer | string): boolean {
        const id = typeof layer === 'string' ? layer : layer.id
        return this._layers.has(id)
    }

    /**
     * Add a pre-built deck.gl layer to the map. The layer's `id` property is
     * used as the registry key.
     */
    addLayer(layer: Layer): void {
        this._layers.set(layer.id, layer)
        this._syncLayers()
    }

    /**
     * Construct a deck.gl layer from a {@link LayerOptions} spec and add it.
     * Delegates construction to {@link buildDeckLayer}.
     *
     * @throws {Error} If `options.type` is not a supported layer type.
     */
    createLayer(options: LayerOptions): Layer {
        const id = options.id ?? this._nextLayerId()
        const layer = buildDeckLayer(id, options)
        this._layers.set(id, layer)
        this._syncLayers()
        return layer
    }

    removeLayer(layer: Layer | string): void {
        const id = resolveLayerId(layer)
        this._layers.delete(id)
        this._layerZIndices.delete(id)
        this._refreshers.delete(id)
        this._syncLayers()
    }

    /**
     * Clone the existing layer with overridden props. deck.gl detects the
     * same `id` and updates GPU resources incrementally.
     *
     * A held value that is not a deck.gl layer is declined, with a warning,
     * rather than applied: this engine should only ever hold layers it
     * built, but layer types it has no builder for fall through to being
     * built with Leaflet instead. The warning exists so that mis-construction
     * surfaces, rather than presenting as an update that quietly did nothing.
     */
    updateLayer(layer: Layer | string, options: Partial<LayerOptions>): Layer {
        const id = resolveLayerId(layer)
        const existing = this._layers.get(id)
        if (!existing) return existing as unknown as Layer
        if (!this._holdsDeckLayer(id, existing)) return existing
        const updated = existing.clone({
            ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
            ...(options.visible !== undefined ? { visible: options.visible } : {}),
            ...(options.url !== undefined ? { data: options.url } : {}),
        }) as Layer
        this._layers.set(id, updated)
        this._syncLayers()
        return updated
    }

    registerLayer(id: string, layer: Layer): void {
        // For deck.gl, holding a layer is rendering it — there is no
        // "registered but not on the map" state. Keyed by the caller's id
        // rather than layer.id so the two can never drift apart.
        this._layers.set(id, layer)
        this._syncLayers()
    }

    setLayerRefresher(
        id: string,
        refresh: ((layer: Layer, ctx: RefreshContext) => Layer | void) | null
    ): void {
        if (refresh == null) this._refreshers.delete(id)
        else this._refreshers.set(id, refresh)
    }

    refreshLayer(id: string, ctx: RefreshContext = {}): boolean {
        const existing = this._layers.get(id)
        if (!existing) return false

        // No fallback: how a layer recomputes itself is layer-kind knowledge,
        // and this adapter has none. The module that owns the kind registers a
        // refresher at creation (see Map_.makeTileLayer); a held layer without
        // one has no way to refresh, exactly as in the Leaflet adapter.
        const refresh = this._refreshers.get(id)
        if (!refresh) return false

        const next = refresh(existing, {
            url: ctx.url,
            tileOptions: ctx.tileOptions,
            force: ctx.force,
        })

        // A refresher with nothing to apply returns nothing; keep what we hold.
        if (next) this._layers.set(id, next)
        this._syncLayers()
        return true
    }

    /**
     * Assign a logical z-index. deck.gl renders layers in array order (index 0 = bottom),
     * so this re-sorts the internal map by ascending z-index.
     */
    setLayerZIndex(layer: Layer | string, zIndex: number): void {
        const id = resolveLayerId(layer)
        this._layerZIndices.set(id, zIndex)
        this._sortLayersByZIndex()
        this._syncLayers()
    }

    /**
     * Move a layer to the end of the layers array so deck.gl renders it on top.
     * The move lasts only until the next z-index re-sort, which puts the layer
     * back at its assigned index — or on top, if it has none.
     */
    bringToFront(layer: Layer | string): void {
        const id = resolveLayerId(layer)
        const existing = this._layers.get(id)
        if (!existing) return
        this._layers.delete(id)
        this._layers.set(id, existing)
        this._syncLayers()
    }

    /**
     * Move a layer to the start of the layers array so deck.gl renders it below all others.
     * The move lasts only until the next z-index re-sort, which puts the layer
     * back at its assigned index — or on top, if it has none.
     */
    bringToBack(layer: Layer | string): void {
        const id = resolveLayerId(layer)
        const existing = this._layers.get(id)
        if (!existing) return
        const remaining = [...this._layers.entries()].filter(([k]) => k !== id)
        this._layers = new Map([[id, existing], ...remaining])
        this._syncLayers()
    }

    /**
     * Set a layer's opacity. deck.gl layers are immutable, so this replaces
     * the instance the engine holds via {@link updateLayer}, which re-syncs
     * the render list.
     *
     * A no-op when the engine doesn't hold `id`, or holds a native Leaflet
     * layer (MMGIS still builds `data`, `image`, `video` and `velocity`
     * layers with Leaflet under this engine, and those carry no `id` to be
     * found by). Either way the caller has already written
     * `L_.layers.opacity[name]`, which layer creation reads, so the opacity
     * is picked up next time the layer is built or re-added.
     *
     * `options.fillOpacity` is accepted but not applied separately — see
     * {@link IMapEngine.setLayerOpacity}.
     */
    setLayerOpacity(
        layer: Layer | string,
        opacity: number,
        options?: { fillOpacity?: number }
    ): void {
        const id = resolveLayerId(layer)
        const existing = this._layers.get(id)
        if (this._holdsDeckLayer(id, existing)) this.updateLayer(id, { opacity })
    }

    /**
     * Subscribe to a named map event. Pass `options.once` to auto-unsubscribe
     * after the first invocation.
     */
    on(eventName: string, handler: MapEventHandler<PickingInfo>, options?: MapEventOptions): void {
        if (!this._eventListeners.has(eventName)) {
            this._eventListeners.set(eventName, new Set())
        }
        const handlers = this._eventListeners.get(eventName)!

        if (options?.once) {
            const onceWrapper: MapEventHandler<PickingInfo> = (e) => {
                handler(e)
                handlers.delete(onceWrapper)
            }
            handlers.add(onceWrapper)
        } else {
            handlers.add(handler)
        }
    }

    off(eventName: string, handler?: MapEventHandler<PickingInfo>): void {
        if (!handler) {
            this._eventListeners.delete(eventName)
            return
        }
        this._eventListeners.get(eventName)?.delete(handler)
    }

    emit(eventName: string, data?: unknown): void {
        this._emitEvent(eventName, data)
    }

    private _ensureTerraDraw(): TerraDraw | null {
        if (this._terraDraw) return this._terraDraw
        if (!this._isOverlayMode || !this._basemap) return null

        // The drawing is rendered in the theme's accent, at the stroke width
        // a committed shape is drawn with; terra-draw's own defaults supply
        // the opacities.
        const styles = drawStyles()

        const td = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({
                map: this._basemap as any,
                prefixId: TERRA_DRAW_PREFIX,
            }),
            modes: [
                new TerraDrawPointMode({ styles: styles.point }),
                new TerraDrawLineStringMode({
                    keyEvents: drawModeKeyEvents('linestring'),
                    validation: validateDrawnLineString,
                    styles: styles.linestring,
                }),
                new TerraDrawPolygonMode({
                    keyEvents: drawModeKeyEvents('polygon'),
                    styles: styles.polygon,
                }),
                new TerraDrawRectangleMode({
                    keyEvents: drawModeKeyEvents('rectangle'),
                    styles: styles.rectangle,
                }),
                new TerraDrawCircleMode({
                    keyEvents: drawModeKeyEvents('circle'),
                    styles: styles.circle,
                }),
            ],
        })

        const onFinish = (id: any) => {
            const snap = td.getSnapshotFeature(id)
            if (!snap) return
            const shape = this._drawingShape ?? 'polygon'
            const feature: GeoJSON.Feature = {
                type: 'Feature',
                properties: { source: 'draw', shape, ...(snap.properties ?? {}) },
                geometry: snap.geometry as GeoJSON.Geometry,
            }
            this._stopDrawing()
            this._emitEvent('drawcomplete', { feature })
        }

        const onChange = (ids: any[], type: string) => {
            if (type !== 'create' && type !== 'update') return
            const shape = this._drawingShape
            if (!shape) return
            const vertices = committedVerticesFromChange(shape, ids, (id) =>
                td.getSnapshotFeature(id)
            )
            if (vertices) this._emitEvent('drawvertex', { shape, vertices })
        }

        td.on('finish', onFinish)
        td.on('change', onChange)
        this._terraDrawListeners.push(
            () => td.off('finish', onFinish),
            () => td.off('change', onChange),
        )

        this._terraDraw = td
        return td
    }

    enableDrawing(shape: DrawShape): void {
        if (this._drawingShape) {
            this.disableDrawing()
        }

        const td = this._ensureTerraDraw()
        if (!td) {
            throw new Error(
                '[DeckGLAdapter] enableDrawing requires overlay mode ' +
                '(maplibre or mapbox basemap). Initialise the engine with ' +
                'MapInitOptions.basemap to use drawing.'
            )
        }
        if (!td.enabled) td.start()
        td.clear()
        td.setMode(shape)
        this._drawingShape = shape
        this._drawPointers.start()
        this._syncLayers()
        this._emitEvent('drawstart', { shape })
    }

    /** The element terra-draw's MapLibre adapter attaches its listeners to. */
    private _drawEventElement(): HTMLElement | null {
        return (this._basemap as any)?.getCanvas?.() ?? null
    }

    /**
     * Tear down the terra-draw session and clear in-progress geometry
     * without emitting any lifecycle event. Used by both the user-facing
     * cancel path ({@link disableDrawing}) and the internal finish path
     * ({@link _ensureTerraDraw}'s `onFinish`) so the latter can emit
     * `drawcomplete` instead of `drawcancel`.
     */
    private _stopDrawing(): DrawShape | null {
        if (!this._drawingShape) return null
        const shape = this._drawingShape
        this._drawingShape = null
        if (this._terraDraw) {
            try { this._terraDraw.clear() } catch { /* mid-vertex */ }
            try { this._terraDraw.stop() } catch { /* idempotent */ }
        }
        // The drawing's clicks may still be on their way here: deck's
        // recognizers hold each one back a tap interval to see whether a
        // double-click is coming, so both the click that ended the session and
        // the one that placed its last vertex can arrive after this. The watch
        // is what knows which of those is still owed. Armed after terra-draw
        // has stopped, because stopping is what turns double-click zoom back
        // on for the guard to hold back again.
        this._drawEndClick.arm(
            this._drawPointers.pendingClickFrom,
            this._drawEventElement(),
            (this._basemap as any)?.doubleClickZoom
        )
        this._drawPointers.stop()
        this._syncLayers()
        return shape
    }

    disableDrawing(): void {
        const shape = this._stopDrawing()
        if (shape) this._emitEvent('drawcancel', { shape })
    }

    /**
     * terra-draw modes commit on `Enter` via their `keyEvents.finish` binding.
     * There's no programmatic-finish API yet (see
     * https://github.com/JamesLMilner/terra-draw), so we dispatch a synthetic
     * keyup on the map canvas — the element terra-draw listens on. The mode
     * emits `finish` if the geometry is valid, which ends the session; if it
     * isn't (e.g. polygon with <3 vertices), the dispatch is a no-op and the
     * session is left untouched. Rectangle and circle bind no finish key at
     * all (see {@link drawModeKeyEvents}), so they only ever finish on their
     * second click.
     */
    finishDrawing(): boolean {
        if (!this._drawingShape || !this._terraDraw) return false
        this._drawEventElement()?.dispatchEvent(
            new KeyboardEvent('keyup', { key: 'Enter' })
        )
        return !this.isDrawing()
    }

    isDrawing(): boolean {
        return this._drawingShape !== null
    }

    onFeatureClick(handler: FeatureInteractionHandler): () => void {
        this._featureClickHandler = handler
        return () => {
            if (this._featureClickHandler === handler) {
                this._featureClickHandler = null
            }
        }
    }

    onFeatureHover(handler: FeatureInteractionHandler): () => void {
        this._featureHoverHandler = handler
        return () => {
            if (this._featureHoverHandler === handler) {
                this._featureHoverHandler = null
            }
        }
    }

    /**
     * Pick features at a pixel point or within a pixel bounding box.
     *
     * - Point form: calls `deck.pickObject` with radius 1.
     * - Box form `[topLeft, bottomRight]`: calls `deck.pickMultipleObjects`.
     *
     * In overlay mode, the internal `Deck` instance is accessed via `_overlay.deck`.
     */
    queryRenderedFeatures(
        geometry: PointLike | [PointLike, PointLike],
        options?: QueryFeaturesOptions
    ): FeaturePickResult[] {
        const deck = this._isOverlayMode
            ? (this._overlay as unknown as { deck: Deck })?.deck
            : this._deck
        if (!deck) return []

        const isBox =
            Array.isArray(geometry) &&
            (Array.isArray((geometry as unknown[])[0]) ||
                typeof (geometry as unknown[])[0] === 'object')

        if (isBox) {
            const [p1, p2] = geometry as [PointLike, PointLike]
            const { x: x1, y: y1 } = resolvePoint(p1)
            const { x: x2, y: y2 } = resolvePoint(p2)
            return deck
                .pickMultipleObjects({
                    x: Math.min(x1, x2),
                    y: Math.min(y1, y2),
                    radius: Math.abs(x2 - x1),
                    layerIds: options?.layers,
                })
                .map(pickInfoToResult)
        }

        const { x, y } = resolvePoint(geometry as PointLike)
        const pick = deck.pickObject({ x, y, radius: 1, layerIds: options?.layers })
        return pick ? [pickInfoToResult(pick)] : []
    }

    /**
     * Project geographic coordinates to container pixel coordinates using the
     * current viewport. Pass `zoom` to override the viewport zoom.
     */
    projectCoordinates(latLng: LatLngLike, zoom?: number): PointLike {
        const { lat, lng } = resolveLatLng(latLng)
        const [x, y] = makeViewport(this._viewState, this._container, zoom).project([
            lng,
            lat,
        ]) as [number, number]
        return { x, y }
    }

    unprojectCoordinates(point: PointLike, zoom?: number): LatLngLike {
        const { x, y } = resolvePoint(point)
        const [lng, lat] = makeViewport(this._viewState, this._container, zoom).unproject([
            x,
            y,
        ]) as [number, number]
        return { lat, lng }
    }

    containerPointToLatLng(point: PointLike): LatLngLike {
        return this.unprojectCoordinates(point)
    }

    latLngToContainerPoint(latLng: LatLngLike): PointLike {
        return this.projectCoordinates(latLng)
    }

    // ── Comparison / swipe ────────────────────────────────────────────────────

    /**
     * Enable (or reconfigure) side-by-side swipe comparison mode.
     *
     * Each side renders into its own dedicated `Deck` canvas stacked over the
     * primary map; the primary keeps its basemap but hides its data layers. A
     * CSS clip driven by the divider reveals the left canvas on the left of the
     * divider and the right canvas on the right. Both side canvases are camera
     * followers (no controller) locked to the primary map's view, so the shared
     * basemap and each side's layers stay aligned while panning/zooming.
     *
     * Works in both standalone and overlay (basemap) modes. Calling again while
     * already enabled just re-renders the layer sets (used for live side swaps).
     */
    enableComparison(config: ComparisonConfig): void {
        const layout = config.layout ?? this._comparisonLayout
        const layoutChanged = layout !== this._comparisonLayout

        this._comparisonLeftIds = [...config.leftLayerIds]
        this._comparisonRightIds = [...config.rightLayerIds]
        this._comparisonLeftProps = config.leftLayerProps ?? {}
        this._comparisonRightProps = config.rightLayerProps ?? {}

        // Each layout draws through surfaces the other has no use for, so a
        // switch tears the old ones down before the new ones go up. The divider
        // position is deliberately left alone — the split stays where the user
        // put it across the change.
        if (this._comparisonEnabled && layoutChanged) this._destroyComparisonSurfaces()
        this._comparisonLayout = layout

        if (!this._comparisonEnabled || layoutChanged) {
            this._comparisonEnabled = true
            if (layout === 'sideBySide') this._createSideBySidePanes()
            else this._createComparisonCanvases()
        }

        // Hides the primary map's data layers — comparison layers render in the
        // side surfaces instead — and draws both sides from the layer registry.
        this._syncLayers()
        this._applyComparisonSplit()
        this._syncComparisonCamera()
    }

    /** Disable comparison mode and restore the normal single view. */
    disableComparison(): void {
        if (!this._comparisonEnabled) return
        this._comparisonEnabled = false
        this._comparisonLeftIds = []
        this._comparisonRightIds = []
        this._comparisonLeftProps = {}
        this._comparisonRightProps = {}
        this._destroyComparisonSurfaces()
        // Restore the primary map's data layers.
        this._syncLayers()
    }

    /**
     * Move the comparison divider to `pos` (0–1 fraction of container width).
     *
     * Swipe only re-applies the CSS clip; side-by-side resizes the two panes,
     * which changes how much ground each one covers.
     */
    setComparisonDivider(pos: number): void {
        this._comparisonDividerPos = Math.max(0, Math.min(1, pos))
        if (this._comparisonEnabled) this._applyComparisonSplit()
    }

    /**
     * Switch between wiping one view and showing two. Rebuilds the rendering
     * surfaces around the layer sets and divider already in place.
     */
    setComparisonLayout(layout: ComparisonLayout): void {
        if (layout === this._comparisonLayout) return
        if (!this._comparisonEnabled) {
            // Remembered for whenever comparison is switched on.
            this._comparisonLayout = layout
            return
        }
        this.enableComparison({
            leftLayerIds: this._comparisonLeftIds,
            rightLayerIds: this._comparisonRightIds,
            leftLayerProps: this._comparisonLeftProps,
            rightLayerProps: this._comparisonRightProps,
            layout,
        })
    }

    /** Returns true when comparison mode is currently active. */
    isComparisonEnabled(): boolean {
        return this._comparisonEnabled
    }

    /** The layout comparison is currently drawn in. */
    getComparisonLayout(): ComparisonLayout {
        return this._comparisonLayout
    }

    /**
     * Create the two side canvases (each a controller-less `Deck` in an absolutely
     * positioned, pointer-events-transparent div) and start observing the
     * container for resizes so the canvases redraw and the clip stays aligned.
     */
    private _createComparisonCanvases(): void {
        const makeCanvas = (): { div: HTMLElement; deck: Deck } => {
            const div = document.createElement('div')
            // Full-size overlay; pointer-events:none so pan/zoom passes through to
            // the primary map underneath. z-index sits above the primary canvas
            // but below the MapComparison divider (z-index 1000).
            div.style.cssText =
                'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;'
            this._container.appendChild(div)
            const deck = new Deck({
                parent: div,
                width: '100%',
                height: '100%',
                controller: false,
                // Match the wrapping basemap: render every world copy so the
                // side layers fill the viewport when zoomed out past one world.
                views: new MapView({ repeat: true }),
                viewState: this._viewState,
                layers: [],
            } as any)
            return { div, deck }
        }

        const left = makeCanvas()
        this._comparisonLeftDiv = left.div
        this._comparisonLeftDeck = left.deck

        const right = makeCanvas()
        this._comparisonRightDiv = right.div
        this._comparisonRightDeck = right.deck

        this._observeComparisonResize()
    }

    /**
     * Keep the split aligned while the container changes size.
     * `invalidateSize()` isn't reliably called on every layout change (e.g. the
     * modern UI's docked-panel resizes only dispatch a synthetic `window`
     * resize event), so this observes the container directly instead of
     * depending on that call chain.
     */
    private _observeComparisonResize(): void {
        this._comparisonResizeObserver = new ResizeObserver(() =>
            this._handleComparisonResize(),
        )
        this._comparisonResizeObserver.observe(this._container)
    }

    /**
     * Re-measure the comparison surfaces against the container. Shared by the
     * observer and `invalidateSize()` so the two cannot drift.
     */
    private _handleComparisonResize(): void {
        if (!this._comparisonEnabled) return
        if (this._comparisonLayout === 'sideBySide') this._resizeSideBySidePanes()
        else this._applyComparisonClip()
        this._syncComparisonCamera()
    }

    /** Tear down whichever surfaces the active layout put up. */
    private _destroyComparisonSurfaces(): void {
        this._comparisonResizeObserver?.disconnect()
        this._comparisonResizeObserver = null
        this._destroyComparisonCanvases()
        this._destroySideBySidePanes()
    }

    /** Finalize both side canvases and remove their DOM nodes. */
    private _destroyComparisonCanvases(): void {
        this._comparisonLeftDeck?.finalize()
        this._comparisonLeftDeck = null
        this._comparisonRightDeck?.finalize()
        this._comparisonRightDeck = null
        this._comparisonLeftDiv?.remove()
        this._comparisonLeftDiv = null
        this._comparisonRightDiv?.remove()
        this._comparisonRightDiv = null
    }

    /**
     * Render each side's layer set into its surface. Looks up the live deck
     * layer for each requested id in `_layers` and clones it so the side owns
     * an independent instance (the originals stay untouched for restore on
     * disable). Unknown ids (e.g. a layer that isn't currently on) are skipped.
     */
    private _renderComparisonLayers(): void {
        const left = this._comparisonClonesFor(
            this._comparisonLeftIds,
            this._comparisonLeftProps,
        )
        const right = this._comparisonClonesFor(
            this._comparisonRightIds,
            this._comparisonRightProps,
        )

        if (this._comparisonLayout === 'sideBySide') {
            if (!this._sbsPanes) return
            this._setPaneLayers(this._sbsPanes[0], left)
            this._setPaneLayers(this._sbsPanes[1], right)
            return
        }

        this._comparisonLeftDeck?.setProps({ layers: left } as any)
        this._comparisonRightDeck?.setProps({ layers: right } as any)
    }

    /**
     * The live deck layer for each requested id, cloned so the side surface
     * owns an independent instance. A clone carries the layer's own props
     * unless `overrides` names that id, which is how one side draws a source
     * the other does not share. Unknown ids are skipped.
     */
    private _comparisonClonesFor(
        ids: string[],
        overrides: Record<string, Record<string, unknown>>,
    ): Layer[] {
        return ids
            .map((id) => {
                const layer = this._layers.get(id)
                return layer ? (layer.clone(overrides[id] ?? {}) as Layer) : null
            })
            .filter((l): l is Layer => l != null)
    }

    /** Apply the divider position the way the active layout reads it. */
    private _applyComparisonSplit(): void {
        if (this._comparisonLayout === 'sideBySide') this._applySideBySideSplit()
        else this._applyComparisonClip()
    }

    /**
     * Reveal the left canvas over `[0, pos]` and the right canvas over `[pos, 1]`
     * via CSS clip. Percentages keep the split proportional across resizes.
     */
    private _applyComparisonClip(): void {
        const pct = this._comparisonDividerPos * 100
        if (this._comparisonLeftDiv)
            this._comparisonLeftDiv.style.clipPath = `inset(0 ${100 - pct}% 0 0)`
        if (this._comparisonRightDiv)
            this._comparisonRightDiv.style.clipPath = `inset(0 0 0 ${pct}%)`
    }

    /**
     * Lay the two panes out either side of the divider.
     *
     * Only the clipping slices move. Each basemap canvas stays the full width
     * of the container, and what changes is the padding that says which part of
     * that canvas the camera centres in — a matrix update, not a reallocation.
     * Resizing a canvas instead would drop and refetch tiles on every frame of
     * a drag, which reads as a flicker.
     *
     * Padding is the right edge only. The left pane shows canvas `[0, pos]`, so
     * it pads away the `(1 - pos)` it cannot see; the right pane's canvas
     * starts at the divider, so the slice it shows is its leading `(1 - pos)`
     * and it pads away `pos`. Each camera then sits in the middle of its own
     * visible slice, which is what puts the same place in both panes.
     */
    private _applySideBySideSplit(): void {
        if (!this._sbsPanes) return
        const pos = this._comparisonDividerPos
        const pct = pos * 100
        const width = this._container.offsetWidth
        const [left, right] = this._sbsPanes

        left.div.style.left = '0'
        left.div.style.width = `${pct}%`
        right.div.style.left = `${pct}%`
        right.div.style.width = `${100 - pct}%`

        // Padding raises `move`; it is the same camera, so swallow the echo.
        const wasSyncing = this._sbsSyncing
        this._sbsSyncing = true
        try {
            left.map?.setPadding(this._panePadding(width * (1 - pos)))
            right.map?.setPadding(this._panePadding(width * pos))
        } finally {
            this._sbsSyncing = wasSyncing
        }
    }

    /**
     * The padding that centres a pane's camera in the slice it shows, capped a
     * pixel short of the container so a fully-dragged divider still leaves the
     * camera a width to project into.
     */
    private _panePadding(right: number): {
        top: number
        bottom: number
        left: number
        right: number
    } {
        const limit = Math.max(0, this._container.offsetWidth - 1)
        const clamped = Math.min(Math.max(0, Math.round(right)), limit)
        return { top: 0, bottom: 0, left: 0, right: clamped }
    }

    /**
     * Re-measure the panes against the container.
     *
     * This is the expensive path — it reallocates both canvases — so it runs
     * only when the container itself changes size, never while the divider is
     * being dragged.
     */
    private _resizeSideBySidePanes(): void {
        const width = this._container.offsetWidth
        // `resize()` raises `move`/`moveend` though the camera has not moved.
        const wasSyncing = this._sbsSyncing
        this._sbsSyncing = true
        try {
            this._sbsPanes?.forEach((pane) => {
                if (pane.mapDiv) pane.mapDiv.style.width = `${width}px`
                pane.map?.resize()
            })
        } finally {
            this._sbsSyncing = wasSyncing
        }
        this._applySideBySideSplit()
    }

    /**
     * Push the shared camera onto every surface except the one it came from.
     *
     * In swipe that is the two follower canvases. In side-by-side it is the
     * other pane plus the primary map, which stays hidden underneath but is
     * still what `getCenter()` / `getBounds()` answer from, so it has to keep
     * tracking the view the user is actually looking at.
     */
    private _syncComparisonCamera(source?: SideBySidePane): void {
        if (this._comparisonLayout === 'sideBySide') {
            const { longitude, latitude, zoom, bearing, pitch } = this._viewState
            const camera = {
                center: [longitude, latitude] as [number, number],
                zoom,
                bearing: bearing ?? 0,
                pitch: pitch ?? 0,
            }
            const wasSyncing = this._sbsSyncing
            this._sbsSyncing = true
            try {
                this._sbsPanes?.forEach((pane) => {
                    if (pane === source) return
                    pane.map?.jumpTo(camera)
                    pane.deck?.setProps({ viewState: this._viewState } as any)
                })
                // The primary is hidden but still answers `getCenter()`, and
                // in standalone it is the surface disable returns to.
                if (source) {
                    this._basemap?.jumpTo(camera)
                    if (!this._isOverlayMode)
                        this._deckSetProps({ viewState: this._viewState })
                }
            } finally {
                this._sbsSyncing = wasSyncing
            }
            return
        }

        this._comparisonLeftDeck?.setProps({ viewState: this._viewState } as any)
        this._comparisonRightDeck?.setProps({ viewState: this._viewState } as any)
    }

    // ── Side-by-side panes ────────────────────────────────────────────────────

    /**
     * Build the two panes the side-by-side layout draws into.
     *
     * Each pane is a clipped div holding a map of its own — its own basemap in
     * overlay mode, its own `Deck` in standalone — because two halves showing
     * the same place at the same zoom need two cameras, which one map cannot
     * provide. The panes cover the container between them, hiding the primary
     * map rather than compositing over it.
     */
    private _createSideBySidePanes(): void {
        this._sbsPanes = [this._createSideBySidePane(), this._createSideBySidePane()]
        this._resizeSideBySidePanes()
        this._observeComparisonResize()
    }

    private _createSideBySidePane(): SideBySidePane {
        const div = document.createElement('div')
        div.className = 'mmgis-comparison-pane'
        // Sits above the primary canvas and below the divider (z-index 1000).
        // Unlike the swipe canvases this one takes pointer events: each pane is
        // a map the user can drag.
        div.style.cssText =
            'position:absolute;top:0;height:100%;overflow:hidden;z-index:2;'
        this._container.appendChild(div)

        const pane: SideBySidePane = {
            div,
            mapDiv: null,
            map: null,
            overlay: null,
            deck: null,
            offMap: () => {},
        }

        if (this._isOverlayMode && this._basemapCtor) {
            // The basemap gets an element of its own, sized to the whole
            // container rather than to the slice, so dragging the divider
            // re-clips it instead of resizing it.
            const mapDiv = document.createElement('div')
            mapDiv.className = 'mmgis-comparison-pane__map'
            mapDiv.style.cssText = 'position:absolute;top:0;left:0;height:100%;'
            div.appendChild(mapDiv)
            pane.mapDiv = mapDiv
            this._buildPaneBasemap(pane)
        } else {
            pane.deck = new Deck({
                parent: div,
                width: '100%',
                height: '100%',
                controller: true,
                views: new MapView({ repeat: true }),
                viewState: this._viewState,
                layers: [],
                onViewStateChange: ({ viewState }: { viewState: DeckViewState }) => {
                    if (this._sbsSyncing) return
                    this._viewState = this._clampToMaxBounds(viewState)
                    pane.deck?.setProps({ viewState: this._viewState } as any)
                    this._syncComparisonCamera(pane)
                    this._emitEvent('moveend', this._viewState)
                },
            } as any)
        }

        return pane
    }

    /** Stand up a pane's basemap + interleaved overlay and wire its camera. */
    private _buildPaneBasemap(pane: SideBySidePane): void {
        const options: Record<string, unknown> = {
            container: pane.mapDiv ?? pane.div,
            style: this._basemapStyle ?? this._basemapOptions?.style,
            center: [this._viewState.longitude, this._viewState.latitude],
            zoom: this._viewState.zoom,
            bearing: this._viewState.bearing,
            pitch: this._viewState.pitch,
            minZoom: this._minZoom,
            maxZoom: this._maxZoom,
            projection: 'mercator',
        }
        if (this._basemapOptions?.provider === 'mapbox' && this._basemapOptions.accessToken) {
            options['accessToken'] = this._basemapOptions.accessToken
        }

        const map = new this._basemapCtor!(options)
        const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
        map.addControl(overlay as unknown as object)
        if (this._maxBounds) map.setMaxBounds(resolveBounds(this._maxBounds))

        pane.map = map
        pane.overlay = overlay

        const onMove = () => this._onPaneCameraChange(pane, false)
        const onMoveEnd = () => this._onPaneCameraChange(pane, true)
        // The interleaved overlay drops layers set before the style loads (see
        // `_onBasemapLoad`), so a pane re-sends its own once it is ready.
        const onLoad = () => this._renderComparisonLayers()

        map.on('move', onMove)
        map.on('moveend', onMoveEnd)
        map.on('load', onLoad)
        pane.offMap = () => {
            map.off('move', onMove)
            map.off('moveend', onMoveEnd)
            map.off('load', onLoad)
        }
    }

    /**
     * Adopt a pane's camera as the shared one and copy it everywhere else.
     *
     * Either pane may be dragged, so whichever moved becomes the source and the
     * rest follow. `settled` separates the frames during a gesture — which only
     * need the cameras to stay locked — from its end, which is what the rest of
     * MMGIS listens for.
     */
    private _onPaneCameraChange(source: SideBySidePane, settled: boolean): void {
        if (this._sbsSyncing || !source.map) return

        const center = source.map.getCenter()
        this._viewState = {
            ...this._viewState,
            longitude: center.lng,
            latitude: center.lat,
            zoom: source.map.getZoom(),
            bearing: source.map.getBearing(),
            pitch: source.map.getPitch(),
        }
        this._syncComparisonCamera(source)
        if (settled) this._emitEvent('moveend', this._viewState)
    }

    /** Finalize both panes, detach their listeners and remove their DOM nodes. */
    private _destroySideBySidePanes(): void {
        this._sbsPanes?.forEach((pane) => {
            pane.offMap()
            if (pane.map && pane.overlay) {
                try { pane.map.removeControl(pane.overlay as unknown as object) }
                catch { /* the control goes with the map either way */ }
            }
            pane.map?.remove()
            pane.deck?.finalize()
            pane.div.remove()
        })
        this._sbsPanes = null
    }

    /** Send one pane's layer set to whichever surface that pane renders through. */
    private _setPaneLayers(pane: SideBySidePane, layers: Layer[]): void {
        if (pane.overlay) pane.overlay.setProps({ layers })
        else pane.deck?.setProps({ layers } as any)
    }

    /**
     * Initialise a standalone `Deck` instance (no basemap).
     * Called by {@link init} when `options.basemap` is absent.
     */
    private _initStandaloneMode(): void {
        this._deck = new Deck({
            parent: this._container,
            // No preserveDrawingBuffer needed: captureScreenshot() reads the
            // canvas synchronously after deck.redraw(), before the browser
            // presents (and clears) the drawing buffer.
            width: '100%',
            height: '100%',
            controller: true,
            layers: [],
            viewState: this._viewState,
            onViewStateChange: ({ viewState }: { viewState: DeckViewState }) => {
                const clamped = this._clampToMaxBounds(viewState)
                this._viewState = clamped
                this._deckSetProps({ viewState: clamped })
                if (this._comparisonEnabled) this._syncComparisonCamera()
                this._emitEvent('move', clamped)
                this._emitEvent('moveend', clamped)
            },
            onClick: this._onPointerClick,
            onHover: this._onPointerHover,
        } as any)
    }

    /**
     * Report a click deck picked, unless the drawing session owns it: the ones
     * terra-draw is taking as vertices, and the ones deck was still holding as
     * the session ended (see {@link DrawEndClickGuard}).
     */
    private _onPointerClick = (info: PickingInfo): void => {
        if (this._drawingShape || this._drawEndClick.pending) return
        this._featureClickHandler?.(pickInfoToResult(info))
        this._emitClick(info)
    }

    private _onPointerHover = (info: PickingInfo): void => {
        if (this._drawingShape) return
        this._featureHoverHandler?.(pickInfoToResult(info))
        this._emitMouseMove(info)
    }

    /**
     * Initialise Mapbox overlay mode. Loads `mapbox-gl` via a dynamic import so
     * the library is only bundled when this code path is actually reached.
     *
     * @throws {Error} If `mapbox-gl` is not installed.
     */
    private async _initOverlayModeMapbox(basemap: BasemapOptions): Promise<void> {
        let MapboxGLMap: new (options: Record<string, unknown>) => BasemapInstance

        try {
            const lib = (await import('mapbox-gl')) as unknown as {
                default?: { Map: new (options: Record<string, unknown>) => BasemapInstance }
                Map?: new (options: Record<string, unknown>) => BasemapInstance
            }
            const MapClass = (lib.default ?? lib).Map
            if (!MapClass) throw new Error('Map not found in mapbox-gl module')
            MapboxGLMap = MapClass
        } catch {
            throw new Error(
                'DeckGLAdapter: mapbox-gl is not installed. ' +
                    "Run `npm install mapbox-gl` or use provider: 'maplibre' instead."
            )
        }

        this._setupOverlay(MapboxGLMap, basemap)
    }

    /**
     * Shared synchronous setup for both MapLibre and Mapbox overlay modes.
     * Creates the base map, attaches the `MapboxOverlay`, registers event listeners,
     * and applies `maxBounds` if configured.
     */
    private _setupOverlay(
        MapClass: new (options: Record<string, unknown>) => BasemapInstance,
        basemap: BasemapOptions
    ): void {
        const mapOptions: Record<string, unknown> = {
            container: this._container,
            style: basemap.style,
            center: [this._viewState.longitude, this._viewState.latitude] as [number, number],
            zoom: this._viewState.zoom,
            bearing: this._viewState.bearing,
            pitch: this._viewState.pitch,
            minZoom: this._minZoom,
            maxZoom: this._maxZoom,
            projection: 'mercator',
            // No preserveDrawingBuffer needed: captureScreenshot() reads the
            // canvas inside a once('render') handler, in the same frame the
            // map draws — before the drawing buffer is presented and cleared.
        }

        if (basemap.provider === 'mapbox' && basemap.accessToken) {
            mapOptions['accessToken'] = basemap.accessToken
        }

        this._basemap = new MapClass(mapOptions)
        this._basemapCtor = MapClass
        this._basemapOptions = basemap
        this._basemapStyle = basemap.style
        this._isOverlayMode = true

        this._overlay = new MapboxOverlay({
            interleaved: true,
            layers: [],
            onClick: this._onPointerClick,
            onHover: this._onPointerHover,
        })

        this._basemap.addControl(this._overlay as unknown as object)

        if (this._maxBounds) {
            this._basemap.setMaxBounds(resolveBounds(this._maxBounds))
        }

        this._basemap.on('move', this._onBasemapMove)
        this._basemap.on('moveend', this._onBasemapMoveEnd)
        this._basemap.on('load', this._onBasemapLoad)
    }

    /**
     * Apply a new view state to the `Deck` instance.
     * Only used in standalone mode; overlay mode drives the camera through the basemap.
     *
     * When `options.animate` is absent or false, transition props are cleared so the
     * camera jumps immediately.
     *
     * A jump is reported here as `move` then `moveend`, matching what overlay
     * mode gets from the basemap, so anchored consumers follow a programmatic
     * `setView` / `setZoom` / `fitBounds`. A transition is left to deck's
     * transition manager, which reports every frame — including the last —
     * through `onViewStateChange`.
     */
    private _applyViewState(state: DeckViewState, options?: ViewOptions): void {
        const nextState: DeckViewState = {
            ...state,
            minZoom: this._minZoom,
            maxZoom: this._maxZoom,
            ...(options?.animate
                ? {}
                : { transitionDuration: 0, transitionInterpolator: undefined }),
        }
        this._viewState = nextState
        this._deckSetProps({ viewState: nextState })
        // A zero-duration move raises no `onViewStateChange`, so this is the
        // only place the comparison surfaces and anchored consumers hear about
        // it.
        if (this._comparisonEnabled) this._syncComparisonCamera()
        if (!nextState.transitionDuration) {
            this._emitEvent('move', nextState)
            this._emitEvent('moveend', nextState)
        }
    }

    /**
     * Clamp longitude and latitude to `_maxBounds` if set.
     * Applied inside `onViewStateChange` to constrain user-driven pan gestures in standalone mode.
     */
    private _clampToMaxBounds(viewState: DeckViewState): DeckViewState {
        if (!this._maxBounds) return viewState
        const [[west, south], [east, north]] = resolveBounds(this._maxBounds)
        return {
            ...viewState,
            longitude: Math.max(west, Math.min(east, viewState.longitude)),
            latitude: Math.max(south, Math.min(north, viewState.latitude)),
        }
    }

    /**
     * Push the current layer registry to the active rendering target.
     *
     * - Overlay mode: `_overlay.setProps({ layers })` — the `MapboxOverlay` diffs and re-renders.
     * - Standalone mode: `_deck.setProps({ layers })` — direct deck.gl update.
     *
     * While comparison is active the primary map shows basemap only: its data
     * layers are hidden and the side surfaces redraw from the same registry
     * instead, so a layer added, updated, or reordered mid-comparison reaches
     * both sides.
     *
     * Each sync mounts fresh clones: deck.gl leaves `internalState` set on a
     * layer it finalizes, so a mounted instance is single-use and the registry
     * holds descriptors rather than the instances on screen.
     *
     * Entries that cannot be cloned are left out. Under the deck.gl engine
     * MMGIS still builds `data`, `image`, `video` and `velocity` layers as
     * native Leaflet objects — ENGINE_LAYER_SUPPORT has no deck builder for
     * them — and callers hand every registry entry to the active engine. Such
     * an object carries no deck `id`, so {@link addLayer} files it under
     * `undefined`; deck.gl could not render it in any case.
     */
    private _syncLayers(): void {
        const layers = this._comparisonEnabled
            ? []
            : [...this._layers.values()]
                  .filter((layer) => typeof layer.clone === 'function')
                  .map((layer) => layer.clone({}) as Layer)
        if (this._isOverlayMode) {
            this._overlay?.setProps({ layers: this._anchorBelowDrawing(layers) })
        } else {
            this._deckSetProps({ layers })
        }
        if (this._comparisonEnabled) this._renderComparisonLayers()
    }

    /**
     * While a terra-draw session is running, return a clone of every deck
     * layer carrying a `beforeId` that points at terra-draw's bottom-most
     * MapLibre layer, which keeps the whole drawing above the deck layers.
     *
     * Without that `beforeId`, the interleaved overlay's `resolveLayers()`
     * lifts the deck layers back to the top of the style on every `styledata`
     * event and buries the in-progress drawing.
     *
     * `resolveLayers()` passes the anchor straight to `map.addLayer`, which
     * refuses to insert before a layer that is not in the style. So the anchor
     * is only applied while terra-draw's layers are actually registered.
     */
    private _anchorBelowDrawing(layers: Layer[]): Layer[] {
        if (!this._drawingShape) return layers
        if (!this._basemap?.getLayer(TERRA_DRAW_BOTTOM_LAYER_ID)) return layers
        return layers.map((layer) => layer.clone({ beforeId: TERRA_DRAW_BOTTOM_LAYER_ID } as any))
    }

    /**
     * Re-order the layer Map by ascending z-index so `_syncLayers` sends them in the
     * correct draw order (lower z-index = rendered first = behind).
     *
     * A layer with no assigned z-index ranks {@link UNRANKED_Z_INDEX}, which
     * holds it above the mission layer stack. The sort is stable, so several
     * such layers also keep their order relative to each other.
     */
    private _sortLayersByZIndex(): void {
        const rank = (id: string) => this._layerZIndices.get(id) ?? UNRANKED_Z_INDEX
        const entries = [...this._layers.entries()].sort(
            ([aId], [bId]) => rank(aId) - rank(bId)
        )
        this._layers = new Map(entries)
    }

    /**
     * Call `deck.setProps` with a partial props object.
     * Only valid in standalone mode; does nothing if `_deck` is null.
     */
    private _deckSetProps(props: { layers?: Layer[]; viewState?: DeckViewState }): void {
        this._deck?.setProps(props as any)
    }

    /**
     * Return the next auto-generated layer id and advance the counter.
     */
    private _nextLayerId(): string {
        return `deckgl-layer-${++this._layerIdCounter}`
    }

    /**
     * Dispatch a named event to all registered listeners.
     */
    private _emitEvent(name: string, data?: unknown): void {
        this._eventListeners.get(name)?.forEach((h) => h(data as PickingInfo))
    }

    private _emitClick(info: PickingInfo): void {
        if (!info?.coordinate) return
        this._eventListeners.get('click')?.forEach(
            (h) => h(this._buildNormalizedPointerEvent(info) as unknown as PickingInfo)
        )
    }

    private _emitMouseMove(info: PickingInfo): void {
        if (!info?.coordinate) return
        this._eventListeners.get('mousemove')?.forEach(
            (h) => h(this._buildNormalizedPointerEvent(info) as unknown as PickingInfo)
        )
    }

    private _buildNormalizedPointerEvent(info: PickingInfo): Record<string, unknown> {
        const lat = info.coordinate![1]
        const lng = info.coordinate![0]
        return {
            lat,
            lng,
            latlng: { lat, lng },
            containerPoint:
                info.x != null && info.y != null
                    ? { x: info.x, y: info.y }
                    : undefined,
        }
    }
}

export default DeckGLAdapter
