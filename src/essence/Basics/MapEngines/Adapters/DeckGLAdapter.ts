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
    FlyToInterpolator,
    LinearInterpolator,
    type PickingInfo,
    type Layer,
} from '@deck.gl/core'

import { MapboxOverlay } from '@deck.gl/mapbox'
import { Map as MaplibreGLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import type { IMapEngine, MapScreenshotResult } from '../IMapEngine'
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
import type { LayerOptions, OverlayOptions } from '../types/layers'
import type {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
    DrawShape,
    DrawingOptions,
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
import { extractVerticesFromGeometry } from './DrawingHelpers'

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
    /** Return the current visible bounds. */
    getBounds(): {
        getSouthWest(): { lat: number; lng: number }
        getNorthEast(): { lat: number; lng: number }
    }
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
 * How long {@link DeckGLAdapter.captureScreenshot} waits for the basemap's
 * `render` event before rejecting. Generous enough for a slow first frame,
 * short enough that a dead map fails fast.
 */
const SCREENSHOT_RENDER_TIMEOUT_MS = 3000

/**
 * Prefix for the MapLibre layers terra-draw renders the in-progress drawing
 * into. Passed to `TerraDrawMapLibreGLAdapter` explicitly so the ids are
 * owned here rather than inherited from the library default.
 */
const TERRA_DRAW_PREFIX = 'td'

/**
 * Bottom of the terra-draw stack: its MapLibre adapter registers the polygon
 * fill layer first.
 */
const TERRA_DRAW_BOTTOM_LAYER_ID = `${TERRA_DRAW_PREFIX}-polygon`

/**
 * Sort rank for layers that never received an explicit z-index. Every layer of
 * the configured mission stack is ranked through
 * {@link DeckGLAdapter.setLayerZIndex} as it is added; everything else (plugin
 * overlays such as a selection highlight) is added on top of that stack, so it
 * ranks above every assigned index.
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
    private _layerZIndices = new Map<string, number>()
    private _layerIdCounter = 0

    private _eventListeners = new Map<string, Set<MapEventHandler<PickingInfo>>>()
    private _featureClickHandler: FeatureInteractionHandler | null = null
    private _featureHoverHandler: FeatureInteractionHandler | null = null

    private _drawingShape: DrawShape | null = null
    private _terraDraw: TerraDraw | null = null
    private _terraDrawListeners: Array<() => void> = []

    /** Registry of anchored HTML overlays (id -> teardown function). */
    private _overlays = new Map<string, () => void>()

    /**
     * Bound handler kept as a class field so it can be removed cleanly in {@link destroy}.
     * Syncs `_viewState` from the basemap and emits the engine-level `'moveend'` event.
     */
    private _onBasemapMoveEnd = (): void => {
        const center = this._basemap!.getCenter()
        this._viewState = {
            ...this._viewState,
            longitude: center.lng,
            latitude: center.lat,
            zoom: this._basemap!.getZoom(),
        }
        this._emitEvent('moveend', this._viewState)
    }

    /**
     * Bound handler kept as a class field for clean removal.
     * Silently keeps `_viewState` in sync during animations so that
     * {@link projectCoordinates} and {@link unprojectCoordinates} remain
     * accurate while the camera is moving.
     */
    private _onBasemapMove = (): void => {
        const center = this._basemap!.getCenter()
        this._viewState = {
            ...this._viewState,
            longitude: center.lng,
            latitude: center.lat,
            zoom: this._basemap!.getZoom(),
        }
    }

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
        if (this._terraDraw) {
            this._terraDrawListeners.forEach((off) => { try { off() } catch { /* ignore */ } })
            this._terraDrawListeners = []
            try { this._terraDraw.stop() } catch { /* ignore */ }
            this._terraDraw = null
        }
        this._drawingShape = null

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
     * The new style replaces every layer on the map, including the ones
     * terra-draw registered, and terra-draw does not re-register them. Any
     * live drawing session is therefore ended first (emitting `drawcancel`)
     * so consumers see the session end and {@link _syncLayers} drops the
     * terra-draw anchor before the layers it points at disappear.
     */
    setBasemapStyle(styleUrl: string): boolean {
        if (!this._basemap) return false
        this.disableDrawing()
        this._basemap.setStyle(styleUrl)
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
     * Returns the current visible geographic bounds.
     *
     * - Overlay mode: delegated directly to the basemap's `getBounds()`.
     * - Standalone mode: derived by unprojecting the container corners via `WebMercatorViewport`.
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
        const [west, south] = vp.unproject([0, h]) as [number, number]
        const [east, north] = vp.unproject([w, 0]) as [number, number]
        return {
            southWest: { lat: south, lng: west },
            northEast: { lat: north, lng: east },
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
            return
        }
        this._deck?.redraw('invalidateSize')
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
        this._syncLayers()
    }

    /**
     * Clone the existing layer with overridden props. deck.gl detects the same
     * `id` and updates GPU resources incrementally.
     */
    updateLayer(layer: Layer | string, options: Partial<LayerOptions>): Layer {
        const id = resolveLayerId(layer)
        const existing = this._layers.get(id)
        if (!existing) return existing as unknown as Layer
        const updated = existing.clone({
            ...(options.opacity !== undefined ? { opacity: options.opacity } : {}),
            ...(options.visible !== undefined ? { visible: options.visible } : {}),
            ...(options.url !== undefined ? { data: options.url } : {}),
        }) as Layer
        this._layers.set(id, updated)
        this._syncLayers()
        return updated
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
     * The move only holds until the next z-index re-sort, which re-ranks the
     * layer by its assigned index — or to the top if it has none.
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
     * The move only holds until the next z-index re-sort, which re-ranks the
     * layer by its assigned index — or to the top if it has none.
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
     * Set a layer's opacity and return the instance carrying it. deck.gl layers
     * are immutable, so the caller must replace its reference with the result.
     *
     * A layer on the map goes through {@link updateLayer}, which re-syncs the
     * render list. One that is off the map is cloned instead, so it comes back
     * at the requested opacity when it is added. A reference that is neither
     * on the map nor a clonable layer instance (an unknown id, or a registry
     * value that never became a layer) yields no replacement.
     */
    setLayerOpacity(layer: Layer | string, opacity: number): Layer | undefined {
        const id = resolveLayerId(layer)
        if (this._layers.has(id)) return this.updateLayer(id, { opacity })
        if (typeof (layer as Layer)?.clone !== 'function') return undefined
        return (layer as Layer).clone({ opacity }) as Layer
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

    private _ensureTerraDraw(options: DrawingOptions): TerraDraw | null {
        if (this._terraDraw) return this._terraDraw
        if (!this._isOverlayMode || !this._basemap) return null

        const finishKey = 'Enter'
        const cancelKey = options.cancelOnEscape === false ? null : 'Escape'

        const td = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({
                map: this._basemap as any,
                prefixId: TERRA_DRAW_PREFIX,
            }),
            modes: [
                new TerraDrawPointMode(),
                new TerraDrawLineStringMode({ keyEvents: { finish: finishKey, cancel: cancelKey } }),
                new TerraDrawPolygonMode({ keyEvents: { finish: finishKey, cancel: cancelKey } }),
                new TerraDrawRectangleMode({ keyEvents: { finish: finishKey, cancel: cancelKey } }),
                new TerraDrawCircleMode({ keyEvents: { finish: finishKey, cancel: cancelKey } }),
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
            if (!this._drawingShape) return
            const lastId = ids[ids.length - 1]
            const snap = td.getSnapshotFeature(lastId)
            if (!snap) return
            const vertices = extractVerticesFromGeometry(snap.geometry as GeoJSON.Geometry)
            if (!vertices) return
            this._emitEvent('drawvertex', { shape: this._drawingShape, vertices })
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

    enableDrawing(shape: DrawShape, options: DrawingOptions = {}): void {
        if (this._drawingShape) {
            this.disableDrawing()
        }

        const td = this._ensureTerraDraw(options)
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
        this._syncLayers()
        this._emitEvent('drawstart', { shape })
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
     * keydown to the map container — the mode's keyboard handler picks it up
     * and emits `finish` if the geometry is valid. If it isn't (e.g. polygon
     * with <3 vertices), the dispatch is a no-op and we fall through to
     * cancel.
     */
    finishDrawing(): void {
        if (!this._drawingShape || !this._terraDraw) return
        const evt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        this._container?.dispatchEvent(evt)
        if (this._drawingShape) this.disableDrawing()
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
                this._emitEvent('moveend', clamped)
            },
            onClick: (info: PickingInfo) => {
                if (this._drawingShape) return
                this._featureClickHandler?.(pickInfoToResult(info))
                this._emitClick(info)
            },
            onHover: (info: PickingInfo) => {
                if (this._drawingShape) return
                this._featureHoverHandler?.(pickInfoToResult(info))
                this._emitMouseMove(info)
            },
        } as any)
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
        this._isOverlayMode = true

        this._overlay = new MapboxOverlay({
            interleaved: true,
            layers: [],
            onClick: (info: PickingInfo) => {
                if (this._drawingShape) return
                this._featureClickHandler?.(pickInfoToResult(info))
                this._emitClick(info)
            },
            onHover: (info: PickingInfo) => {
                if (this._drawingShape) return
                this._featureHoverHandler?.(pickInfoToResult(info))
                this._emitMouseMove(info)
            },
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
     */
    private _syncLayers(): void {
        // DeckGL diffs by array identity to detect changes and re-ordering.
        // Since we manage layers imperatively, we hand it a fresh copy of the
        // layers *array* (the layer instances themselves are reused) so the diff
        // picks up additions, removals, and drawing-order changes.
        const layers = [...this._layers.values()]
        if (this._isOverlayMode) {
            this._overlay?.setProps({ layers: this._anchorBelowDrawing(layers) })
        } else {
            this._deckSetProps({ layers })
        }
    }

    /**
     * While a terra-draw session is active, clone every deck layer with a
     * `beforeId` anchored on terra-draw's bottom-most MapLibre layer so the
     * whole drawing renders on top. Without a beforeId, the interleaved
     * overlay's resolveLayers() re-hoists deck layers to the top of the style
     * on every styledata event, burying the in-progress drawing.
     *
     * resolveLayers() hands the anchor straight to `map.addLayer`, which
     * refuses to insert before a layer that is not in the style, so the anchor
     * is only stamped while terra-draw's layers are actually registered.
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
     * Layers with no assigned z-index rank {@link UNRANKED_Z_INDEX}, keeping
     * them above the mission layer stack; the sort is stable, so they also keep
     * their order relative to each other.
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
