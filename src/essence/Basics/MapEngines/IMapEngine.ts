import { LatLng, LatLngLike, PointLike, BoundsLike } from './types/geometry'
import {
    ViewState,
    ViewOptions,
    FlyToOptions,
    FitBoundsOptions,
    MapInitOptions,
} from './types/view'
import { LayerOptions, OverlayOptions, RefreshContext } from './types/layers'
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
     * Take ownership of an externally-built native layer under `id`, so
     * id-addressed methods can find it. Holding is not drawing on either
     * engine; {@link setLayerVisibility} decides what is shown.
     */
    registerLayer(id: string, layer: TLayer): void

    /**
     * Register how one layer recomputes itself, or pass null to clear.
     *
     * Called by the module that owns the layer kind, at creation — never by
     * an adapter, which stays layer-type-agnostic. The engine invokes it with
     * the live instance and remains its owner; the function must not retain
     * it.
     *
     * deck.gl layers are immutable, so a refresher returns a replacement and
     * the engine adopts it (returning nothing keeps what's held). Leaflet
     * layers are mutable and already on the map, so a refresher mutates in
     * place and any return value is ignored. The signature stays
     * `TLayer | void` for that reason; the Leaflet adapter narrows its own
     * parameter to void.
     */
    setLayerRefresher(
        id: string,
        refresh: ((layer: TLayer, ctx: RefreshContext) => TLayer | void) | null
    ): void

    /**
     * Re-render a layer from its current configuration.
     *
     * The single update entry point for time changes, colormap/rescale changes
     * and any other "your config moved, redraw" event. Callers never branch on
     * the active engine or renderer.
     *
     * @returns Whether the engine had a layer to refresh.
     */
    refreshLayer(id: string, ctx?: RefreshContext): boolean

    /**
     * Show or hide a layer the engine already holds. A no-op for one it does
     * not.
     *
     * Hiding never gives up the hold: a hidden layer stays addressable by id,
     * so an opacity write or a {@link refreshLayer} while it is off lands on
     * the instance shown next, and callers never replay settings at show
     * time. How "off" is implemented differs per engine and stays there.
     */
    setLayerVisibility(layer: TLayer | string, visible: boolean): void

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
     * Set a layer's opacity. Both engines return nothing — each owns its
     * instance and applies the change internally: Leaflet mutates in place,
     * deck.gl replaces the instance it holds. Callers never adopt a
     * replacement.
     *
     * `fillOpacity` is not honoured uniformly, deliberately: Leaflet applies
     * it to the fill of layers that paint one separately from their stroke
     * (`setStyle`'s `fillOpacity`). deck.gl has no separate fill channel —
     * its single `opacity` prop scales stroke and fill together, so the value
     * is accepted here to satisfy the signature but subsumed into `opacity`.
     *
     * @param options.fillOpacity - Absolute fill opacity, not a multiplier.
     * Defaults to `opacity`. See per-engine note above.
     */
    setLayerOpacity(
        layer: TLayer | string,
        opacity: number,
        options?: { fillOpacity?: number }
    ): void

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
     */
    addOverlay(options: OverlayOptions): void

    /**
     * Remove an overlay by id. Runs the cleanup returned by `mount` and
     * removes the DOM node from the container. No-op if the id is unknown.
     */
    removeOverlay(id: string): void

    // ── Comparison / swipe ────────────────────────────────────────────────────

    /**
     * Enable (or reconfigure) side-by-side swipe comparison mode.
     * Renders each side's layer set into its own canvas stacked over the map and
     * reveals them on either side of a draggable divider; the underlying basemap
     * stays shared and all other data layers are hidden. Calling again while
     * already enabled re-applies the (possibly changed) layer sets.
     * Optional per-side date overrides for time-enabled layers are a follow-up.
     */
    enableComparison?(config: ComparisonConfig): void

    /** Disable comparison mode and restore the normal single-viewport view. */
    disableComparison?(): void

    /**
     * Move the comparison divider to `pos` (0–1 fraction of container width).
     * No-op if comparison mode is off.
     */
    setComparisonDivider?(pos: number): void

    /**
     * Switch between the two ways the sides can share the viewport. Rebuilds
     * the rendering surfaces, keeping the layer sets and the divider where
     * they are. No-op if comparison mode is off.
     */
    setComparisonLayout?(layout: ComparisonLayout): void

    /** Returns true when comparison mode is currently active. */
    isComparisonEnabled?(): boolean

    /** The layout comparison is currently drawn in. */
    getComparisonLayout?(): ComparisonLayout
}

/**
 * How the two comparison sides share the map viewport.
 *
 * - `'swipe'` — one camera, one basemap. Both sides draw the same view and the
 *   divider wipes between them, so a place is seen under one layer or the
 *   other.
 * - `'sideBySide'` — two cameras locked to the same centre and zoom, each with
 *   its own basemap, in panes that meet at the divider without overlapping. A
 *   place is seen under both layers at once, once per pane.
 */
export type ComparisonLayout = 'swipe' | 'sideBySide'

/** Configuration for {@link IMapEngine.enableComparison}. */
export interface ComparisonConfig {
    /** deck.gl layer IDs (= MMGIS layer names) to render on the left side. */
    leftLayerIds: string[]
    /** deck.gl layer IDs (= MMGIS layer names) to render on the right side. */
    rightLayerIds: string[]
    /** Defaults to the layout already in effect, or `'swipe'` on first enable. */
    layout?: ComparisonLayout
    /**
     * Layer props to override on the left side only, keyed by layer id — how a
     * side is drawn from a source the other side does not share, such as a
     * different date's tiles. Props are engine-level (`data`, `geotiff`); the
     * engine applies what it is given and never derives them. `id` is not among
     * them: a clone is paired to its layer by id, and overriding it breaks the
     * pairing the renderer diffs on.
     */
    leftLayerProps?: Record<string, Record<string, unknown>>
    /** As {@link ComparisonConfig.leftLayerProps}, for the right side. */
    rightLayerProps?: Record<string, Record<string, unknown>>
}
