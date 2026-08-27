import { LatLng, LatLngLike, PointLike, BoundsLike } from './types/geometry'
import {
    ViewState,
    ViewOptions,
    FlyToOptions,
    FitBoundsOptions,
    MapInitOptions,
} from './types/view'
import { LayerOptions, OverlayOptions } from './types/layers'
import {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
    DrawShape,
} from './types/events'
import { MapEngineType } from './types/engine'

export interface MapScreenshotResult {
    blob: Blob
    mimeType: 'image/png'
    extension: 'png'
    width: number
    height: number
}

/**
 * Core map engine contract.
 *
 * Every adapter (Leaflet, deck.gl) implements this.
 * The interface is intentionally imperative for Leaflet compatibility.
 * The deck.gl adapter translates imperative calls into declarative
 * layer array updates internally.
 *
 * Coordinate convention: all methods accept LatLngLike which is an object
 * with named lat/lng fields. Adapters convert to the engine's native
 * coordinate order internally (Leaflet: [lat, lng], deck.gl: [lng, lat]).
 *
 * TNativeMap is the underlying map (L.Map, Deck, etc).
 * TLayer is the engine's layer type.
 * TEvent is the engine's event object.
 */
export interface IMapEngine<
    TNativeMap = unknown,
    TLayer = unknown,
    TEvent = unknown,
> {
    /**
     * Which engine this adapter represents.
     */
    readonly engineType: MapEngineType

    /**
     * Create the map inside the given container.
     * deck.gl may initialize asynchronously so this can return a promise.
     */
    init(options: MapInitOptions): void | Promise<void>

    /**
     * Tear down the map and free all resources.
     */
    destroy(): void | Promise<void>

    /**
     * Get the underlying engine map object for escape hatch usage.
     */
    getNativeMap(): TNativeMap

    /**
     * Get the DOM container element holding the map.
     */
    getContainer(): HTMLElement

    /**
     * Capture the current map view as a PNG image.
     *
     * Each engine owns the capture strategy for its rendering technology:
     * - Leaflet rasterizes its DOM/SVG/tile panes with html2canvas.
     * - deck.gl reads the WebGL canvas directly (the base map's GL context
     *   when running in interleaved overlay mode), which html2canvas cannot do.
     *
     * @returns Resolves to a PNG image Blob plus metadata.
     */
    captureScreenshot(): Promise<MapScreenshotResult>

    /**
     * Jump to a center and zoom without animation.
     */
    setView(center: LatLngLike, zoom?: number, options?: ViewOptions): void

    /**
     * Set zoom without changing center.
     */
    setZoom(zoom: number, options?: ViewOptions): void

    /**
     * Set center without changing zoom.
     */
    setCenter(center: LatLngLike, options?: ViewOptions): void

    /**
     * Get the current zoom level.
     */
    getZoom(): number

    /**
     * Get the configured minimum zoom.
     */
    getMinZoom(): number

    /**
     * Get the configured maximum zoom.
     */
    getMaxZoom(): number

    /**
     * Get the current map center as an object with named fields.
     */
    getCenter(): LatLng

    /**
     * Get the visible geographic bounds.
     */
    getBounds(): BoundsLike

    /**
     * Get the full camera state including bearing and pitch.
     */
    getViewState(): ViewState

    /**
     * Set the full camera state. Leaflet adapter ignores bearing and pitch.
     */
    setViewState(state: ViewState, options?: ViewOptions): void

    /**
     * Set or clear maximum bounds. Pass null to remove the constraint.
     */
    setMaxBounds(bounds: BoundsLike | null): void

    /**
     * Adjust the view so the given bounds fit in the viewport.
     * All engines support this natively. deck.gl adapters use
     * WebMercatorViewport.fitBounds internally.
     */
    fitBounds(bounds: BoundsLike, options?: FitBoundsOptions): void

    /**
     * Smoothly animate to a destination.
     * Leaflet adapter ignores bearing/pitch.
     */
    flyTo(options: FlyToOptions): void

    /**
     * Pan to a new center with animation.
     */
    panTo(center: LatLngLike, options?: ViewOptions): void

    /**
     * Tell the map its container changed size.
     * Leaflet: invalidateSize(). deck.gl: handled automatically
     * but adapters can force a redraw.
     */
    invalidateSize(): void

    /**
     * Get the pixel size of the map container as [width, height].
     */
    getSize(): PointLike

    /**
     * Get all layers currently on the map.
     */
    getLayers(): TLayer[]

    /**
     * Check if a layer is on the map by layer object or string id.
     */
    hasLayer(layer: TLayer | string): boolean

    /**
     * Add an already created native layer to the map.
     */
    addLayer(layer: TLayer): void

    /**
     * Create a layer from an options spec and add it to the map.
     * deck.gl adapters append to the internal layers array.
     */
    createLayer(options: LayerOptions): TLayer

    /**
     * Remove a layer from the map by layer object or string id.
     */
    removeLayer(layer: TLayer | string): void

    /**
     * Update properties on an existing layer (opacity, style, etc).
     */
    updateLayer(layer: TLayer | string, options: Partial<LayerOptions>): TLayer

    /**
     * Set the z index of a layer to control draw order.
     */
    setLayerZIndex(layer: TLayer | string, zIndex: number): void

    /**
     * Move a layer to the top of the stack.
     */
    bringToFront(layer: TLayer | string): void

    /**
     * Move a layer to the bottom of the stack.
     */
    bringToBack(layer: TLayer | string): void

    /**
     * Set the opacity of a layer.
     *
     * Engines with immutable layer objects (deck.gl) return the instance that
     * carries the new opacity; callers holding a reference to the layer must
     * replace it with the returned one. Engines that mutate in place (Leaflet)
     * return nothing.
     */
    setLayerOpacity(layer: TLayer | string, opacity: number): TLayer | void

    /**
     * Subscribe to a map event (click, moveend, zoomend, etc).
     */
    on(
        eventName: string,
        handler: MapEventHandler<TEvent>,
        options?: MapEventOptions
    ): void

    /**
     * Unsubscribe from a map event.
     */
    off(eventName: string, handler?: MapEventHandler<TEvent>): void

    /**
     * Fire a custom event on the map (e.g. newActiveFeature).
     */
    emit(eventName: string, data?: unknown): void

    /**
     * Register a handler called when the user clicks a feature. Returns an
     * unsubscribe function — call it to detach the handler.
     *
     * Replace semantics: only one handler is active at a time. Calling again
     * with a new handler replaces the previous one; the previous unsubscribe
     * becomes a no-op.
     *
     * Leaflet: wired through map click + leaflet-pip picking.
     * deck.gl: uses onClick picking callback.
     */
    onFeatureClick(handler: FeatureInteractionHandler): () => void

    /**
     * Register a handler called when the user hovers over a feature. Returns
     * an unsubscribe function. See {@link onFeatureClick} for replace
     * semantics.
     *
     * Leaflet: mousemove/mouseout on the map.
     * deck.gl: onHover picking callback.
     */
    onFeatureHover(handler: FeatureInteractionHandler): () => void

    /**
     * Query visible features at a point or within a box.
     * Leaflet: iterate visible layers and test intersection.
     * deck.gl: pickObject / pickObjects.
     */
    queryRenderedFeatures(
        geometry: PointLike | [PointLike, PointLike],
        options?: QueryFeaturesOptions
    ): FeaturePickResult[]

    /**
     * Convert geographic coordinates to pixel coordinates.
     */
    projectCoordinates(latLng: LatLngLike, zoom?: number): PointLike

    /**
     * Convert pixel coordinates to geographic coordinates.
     */
    unprojectCoordinates(point: PointLike, zoom?: number): LatLngLike

    /**
     * Convert container pixel position to geographic coordinates.
     */
    containerPointToLatLng(point: PointLike): LatLngLike

    /**
     * Convert geographic coordinates to container pixel position.
     */
    latLngToContainerPoint(latLng: LatLngLike): PointLike

    /**
     * Begin an interactive drawing session.
     *
     * Polygon: click each vertex; double-click (or `enter`) finishes.
     * Rectangle: two clicks define opposite corners.
     * Circle: first click sets center, second click sets radius. The
     *   completed feature is a 32-segment Polygon approximation.
     *
     * Calling `enableDrawing` while a session is already active first
     * disables the prior session (emitting `drawcancel`), then starts a new
     * one — there is never more than one drawing session at a time on an
     * engine.
     *
     * Engines emit four lifecycle events through the existing `on(name, …)`:
     *   - `drawstart`    payload: {@link DrawStartEvent}
     *   - `drawvertex`   payload: {@link DrawVertexEvent} (committed vertices only)
     *   - `drawcomplete` payload: {@link DrawCompleteEvent}
     *   - `drawcancel`   payload: {@link DrawCancelEvent}
     *
     * Keys: an engine binds Enter as a finish key for polygon and linestring
     * only, on the map element, which hears it while it has focus. Rectangle
     * and circle bind no finish key — they commit on their second click, and
     * {@link finishDrawing} returns false for them. No engine binds Escape or
     * any other key. Whoever starts a drawing owns the keys that end it and
     * drives the session with {@link finishDrawing} and
     * {@link disableDrawing}, from wherever its own UI holds focus.
     */
    enableDrawing(shape: DrawShape): void

    /**
     * End the active drawing session, removing any in-progress preview
     * geometry from the map. If a session was active, emits `drawcancel`.
     * No-op if no session is active.
     */
    disableDrawing(): void

    /**
     * Commit the current in-progress drawing as a Feature.
     *
     * When the current vertices form a valid shape, emits `drawcomplete`, ends
     * the session and returns true. When they do not (e.g. polygon with fewer
     * than 3 vertices), the drawing is left in progress and it returns false —
     * finishing early must not discard the user's work. With no session active
     * it is a no-op that also returns false.
     */
    finishDrawing(): boolean

    /**
     * Whether a drawing session is currently active.
     */
    isDrawing(): boolean

    /**
     * Attach an HTML overlay anchored to a geographic point.
     *
     * The engine creates a DOM node, appends it to its container, calls
     * `mount(node)` to let the caller render content into it, and keeps it
     * positioned across map view changes. If `mount` returns a function, the
     * engine calls it on `removeOverlay` / engine destroy.
     *
     * Calling `addOverlay` with an `id` that already exists removes the
     * prior overlay first.
     *
     * @deprecated Superseded by the `map:showPopup` provider, whose request is
     * serializable — a description of a card rather than a `mount` callback,
     * which is what lets it cross a sandbox boundary — and whose card the core
     * owns whole: it sanitizes the content, renders the chrome around it,
     * holds focus inside it, and answers the request with how the popup
     * closed. An overlay positions a node and leaves everything in it, and
     * every question of how it closes, to its caller.
     */
    addOverlay(options: OverlayOptions): void

    /**
     * Remove an overlay by id. Runs the cleanup returned by `mount` and
     * removes the DOM node from the container. No-op if the id is unknown.
     *
     * @deprecated Superseded by the `map:hidePopup` provider.
     */
    removeOverlay(id: string): void
}
