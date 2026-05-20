import { LatLng, LatLngLike, PointLike, BoundsLike } from './types/geometry'
import {
    ViewState,
    ViewOptions,
    FlyToOptions,
    FitBoundsOptions,
    MapInitOptions,
} from './types/view'
import { LayerOptions } from './types/layers'
import {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
    DrawShape,
    DrawingOptions,
} from './types/events'
import { MapEngineType } from './types/engine'

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
     */
    setLayerOpacity(layer: TLayer | string, opacity: number): void

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
     * Register a handler called when the user clicks a feature.
     * Leaflet: wired through onEachFeature click handlers.
     * deck.gl: uses onClick picking callback.
     */
    onFeatureClick(handler: FeatureInteractionHandler): void

    /**
     * Register a handler called when the user hovers over a feature.
     * Leaflet: mouseover/mouseout on vector layers.
     * deck.gl: onHover picking callback.
     */
    onFeatureHover(handler: FeatureInteractionHandler): void

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
     */
    enableDrawing(shape: DrawShape, options?: DrawingOptions): void

    /**
     * End the active drawing session, removing any in-progress preview
     * geometry from the map. If a session was active, emits `drawcancel`.
     * No-op if no session is active.
     */
    disableDrawing(): void

    /**
     * Commit the current in-progress drawing as a Feature.
     *
     * Emits `drawcomplete` when the current vertices form a valid shape and
     * `drawcancel` when they do not (e.g. polygon with fewer than 3 vertices).
     * Either way the session ends; isDrawing() returns false afterward.
     *
     * This is what plugin "Confirm" buttons should call. Adapters that auto-
     * finish on a built-in interaction (e.g. polygon double-click) call this
     * internally too — there is one finalisation path.
     */
    finishDrawing(): void

    /**
     * Whether a drawing session is currently active.
     */
    isDrawing(): boolean
}
