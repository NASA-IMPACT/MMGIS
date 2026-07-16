/**
 * LeafletAdapter.ts
 * 
 * Implements the IMapEngine interface for Leaflet.
 * This adapter encapsulates all Leaflet-specific logic and provides
 * a unified interface for MMGIS to interact with the Leaflet map engine.
 * 
 */

import { IMapEngine, MapScreenshotResult } from '../IMapEngine'
import {
    LatLng,
    LatLngLike,
    PointLike,
    BoundsLike,
    PaddingLike,
} from '../types/geometry'
import {
    ViewState,
    ViewOptions,
    FlyToOptions,
    FitBoundsOptions,
    MapInitOptions,
    ProjectionOptions,
} from '../types/view'
import {
    LayerOptions,
    TileLayerOptions,
    MarkerOptions,
    OverlayOptions,
} from '../types/layers'
import { IMapEngineMarkers } from '../IMapEngineMarkers'
import {
    buildLeafletLayer,
    buildLeafletMarker,
    resolveLeafletLayerId,
    resolveLeafletMarkerId,
} from './LeafletHelpers'
import {
    TerraDraw,
    TerraDrawPointMode,
    TerraDrawLineStringMode,
    TerraDrawPolygonMode,
    TerraDrawRectangleMode,
    TerraDrawCircleMode,
} from 'terra-draw'
import { TerraDrawLeafletAdapter } from 'terra-draw-leaflet-adapter'
import { extractVerticesFromGeometry } from './DrawingHelpers'
import { getMapScreenshot } from './LeafletScreenshot'
import {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
    DrawShape,
    DrawingOptions,
} from '../types/events'
import { MapEngineType } from '../types/engine'

// Leaflet is loaded globally via window.L
declare const L: any

export default class LeafletAdapter implements IMapEngine<any, any, any>, IMapEngineMarkers {
    /**
     * Engine type identifier
     */
    readonly engineType: MapEngineType = 'leaflet'

    /**
     * The underlying Leaflet map instance
     */
    private _map: any = null

    /**
     * The DOM container element
     */
    private _container: HTMLElement | null = null

    /**
     * Registry of layers by ID
     */
    private _layers: Map<string, any> = new Map()

    /**
     * Registry of markers by ID
     */
    private _markers: Map<string, any> = new Map()

    /**
     * Registry of anchored HTML overlays (id -> teardown function).
     */
    private _overlays: Map<string, () => void> = new Map()

    /**
     * Registry of event handlers for cleanup
     */
    private _eventHandlers: Map<string, Function> = new Map()

    /**
     * Stored initialization options
     */
    private _initOptions: MapInitOptions | null = null

    /**
     * Wrapped map listeners installed by onFeatureClick / onFeatureHover.
     * Stored so replacing the handler (or destroying the adapter) cleanly
     * detaches the prior listener — without this Leaflet's `.on()` would
     * accumulate one extra click listener per call.
     */
    private _featureClickListener: ((e: any) => void) | null = null
    private _featureHoverMoveListener: ((e: any) => void) | null = null
    private _featureHoverOutListener: (() => void) | null = null

    private _terraDraw: TerraDraw | null = null
    private _drawingShape: DrawShape | null = null
    private _terraDrawListeners: Array<() => void> = []

    /**
     * Initialize the Leaflet map instance
     */
    init(options: MapInitOptions): void {
        // Store options for reference
        this._initOptions = options

        if (this._map) {
            this.destroy()
        }

        this._container = document.getElementById(options.containerId)
        if (!this._container) {
            throw new Error(`Container element with id "${options.containerId}" not found`)
        }

        const leafletOptions: any = {
            zoomControl: options.zoomControl !== false,
            editable: options.editable !== false,
            keyboard: options.keyboard !== false,
            fadeAnimation: options.fadeAnimation !== false,
            worldCopyJump: options.worldCopyJump || false,
            maxBounds: this._normalizeMaxBounds(options.maxBounds),
        }

        if (options.projection && (options.projection as any).custom) {
            const crs = this._createCustomCRS(options.projection, options.maxZoom)
            leafletOptions.crs = crs
            leafletOptions.zoomDelta = options.zoomDelta || 0.05
            leafletOptions.zoomSnap = options.zoomSnap || 0

                ; (window as any).mmgisglobal = (window as any).mmgisglobal || {}
                ; (window as any).mmgisglobal.customCRS = crs
        } else {
            if (options.projection && options.projection.radius) {
                const projString = `+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=${options.projection.radius} +b=${options.projection.radius} +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`
                const crs = new L.Proj.CRS('EPSG:3857', projString, null, options.projection.radius)
                crs.projString = projString

                    ; (window as any).mmgisglobal = (window as any).mmgisglobal || {}
                    ; (window as any).mmgisglobal.customCRS = crs
            }
        }

        if (options.zoomDelta !== undefined) {
            leafletOptions.zoomDelta = options.zoomDelta
        }
        if (options.zoomSnap !== undefined) {
            leafletOptions.zoomSnap = options.zoomSnap
        }
        if (options.wheelPxPerZoomLevel !== undefined) {
            leafletOptions.wheelPxPerZoomLevel = options.wheelPxPerZoomLevel
        }

        this._map = L.map(options.containerId, leafletOptions)

        const center = this._normalizeLatLng(options.center || { lat: 0, lng: 0 })
        const zoom = options.zoom !== undefined ? options.zoom : 2
        this._map.setView([center.lat, center.lng], zoom)

        if (this._map.zoomControl) {
            this._map.zoomControl.setPosition('topright')
        }

        if (options.minZoom !== undefined) {
            this._map.setMinZoom(options.minZoom)
        }
        if (options.maxZoom !== undefined) {
            this._map.setMaxZoom(options.maxZoom)
        }

        const attributionControl = this._container.querySelector('.leaflet-control-attribution')
        if (attributionControl) {
            attributionControl.remove()
        }
    }

    /**
     * Create a custom CRS for planetary projections
     */
    private _createCustomCRS(projection: ProjectionOptions, maxZoom?: number): any {
        const resolutions: number[] = []
        const baseResolution = parseFloat(projection.resunitsperpixel as string || '1')
        const zoomLevel = parseInt(projection.reszoomlevel as string) || 0
        const levels = projection.maxResolutionLevels ?? maxZoom ?? 20

        for (let i = 0; i <= levels; i++) {
            const zoomDiff = i - zoomLevel
            resolutions.push(baseResolution / Math.pow(2, zoomDiff))
        }

        const epsgCode = Number.isFinite(parseInt((projection as any).epsg?.[0]))
            ? `EPSG:${(projection as any).epsg}`
            : (projection as any).epsg

        const crsOptions: any = {
            origin: [
                parseFloat((projection.origin as any)?.[0] || 0),
                parseFloat((projection.origin as any)?.[1] || 0),
            ],
            resolutions,
        }

        if (projection.bounds) {
            const bounds = projection.bounds as any
            crsOptions.bounds = L.bounds(
                [parseFloat(bounds[0]), parseFloat(bounds[1])],
                [parseFloat(bounds[2]), parseFloat(bounds[3])]
            )
        }

        const crs = new L.Proj.CRS(
            epsgCode,
            projection.proj4 || (projection as any).proj,
            crsOptions,
            parseFloat(projection.radius?.toString() || '6371000')
        )

        crs.projString = projection.proj4 || (projection as any).proj

        return crs
    }

    /**
     * Normalize maxBounds to Leaflet format
     */
    private _normalizeMaxBounds(bounds: BoundsLike | null | undefined): any {
        if (!bounds) return null

        if (Array.isArray(bounds)) {
            return bounds
        }

        if ((bounds as any).southWest && (bounds as any).northEast) {
            const sw = this._normalizeLatLng((bounds as any).southWest)
            const ne = this._normalizeLatLng((bounds as any).northEast)
            return [[sw.lat, sw.lng], [ne.lat, ne.lng]]
        }

        return null
    }

    /**
     * Normalize LatLngLike to {lat, lng} object
     */
    private _normalizeLatLng(latLng: LatLngLike): LatLng {
        if (Array.isArray(latLng)) {
            return { lat: latLng[0], lng: latLng[1] }
        }
        return latLng as LatLng
    }

    /**
     * Normalize PointLike to {x, y} object
     */
    private _normalizePoint(point: PointLike): { x: number; y: number } {
        if (Array.isArray(point)) {
            return { x: point[0], y: point[1] }
        }
        return point
    }

    /**
     * Destroy the map and clean up resources
     */
    destroy(): void {
        if (!this._map) return

        this._eventHandlers.forEach((handler, eventName) => {
            this._map.off(eventName, handler)
        })
        this._eventHandlers.clear()

        this._overlays.forEach((teardown) => {
            try {
                teardown()
            } catch {
                // ignore — destroy must remain idempotent
            }
        })
        this._overlays.clear()

        if (this._terraDraw) {
            this._terraDrawListeners.forEach((off) => { try { off() } catch { /* ignore */ } })
            this._terraDrawListeners = []
            try { this._terraDraw.stop() } catch { /* ignore */ }
            this._terraDraw = null
        }
        this._drawingShape = null

        this._detachFeatureClickListener()
        this._detachFeatureHoverListeners()

        this._layers.clear()
        this._markers.clear()

        this._map.remove()
        this._map = null
        this._container = null
        this._initOptions = null
    }

    /**
     * Get the native Leaflet map instance
     */
    getNativeMap(): any {
        return this._map
    }

    /**
     * Get the container element
     */
    getContainer(): HTMLElement {
        return this._container!
    }

    /**
     * Capture the current Leaflet view as a PNG Blob result.
     *
     * Delegates to the shared {@link getMapScreenshot} helper, which performs
     * the html2canvas rasterization plus the Leaflet-specific DOM prep
     * (pane z-index normalization, SVG re-parenting, UI-chrome hide/restore).
     * That logic is correct for Leaflet's DOM/SVG/tile rendering and is left
     * unchanged here.
     */
    captureScreenshot(): Promise<MapScreenshotResult> {
        return getMapScreenshot()
    }

    // ========================================
    // VIEW CONTROL METHODS
    // ========================================

    /**
     * Set the map view (center and zoom)
     */
    setView(center: LatLngLike, zoom?: number, options: ViewOptions = {}): void {
        const normalizedCenter = this._normalizeLatLng(center)
        const currentZoom = zoom !== undefined ? zoom : this._map.getZoom()

        const leafletOptions: any = {}
        if (options.animate !== undefined) {
            leafletOptions.animate = options.animate
        }
        if (options.duration !== undefined) {
            leafletOptions.duration = options.duration
        }
        if (options.easeLinearity !== undefined) {
            leafletOptions.easeLinearity = options.easeLinearity
        }

        this._map.setView([normalizedCenter.lat, normalizedCenter.lng], currentZoom, leafletOptions)
    }

    /**
     * Set the zoom level
     */
    setZoom(zoom: number, options: ViewOptions = {}): void {
        const leafletOptions: any = {}
        if (options.animate !== undefined) {
            leafletOptions.animate = options.animate
        }

        this._map.setZoom(zoom, leafletOptions)
    }

    /**
     * Set the center without changing zoom
     */
    setCenter(center: LatLngLike, options: ViewOptions = {}): void {
        const normalizedCenter = this._normalizeLatLng(center)
        const currentZoom = this._map.getZoom()
        this.setView(normalizedCenter, currentZoom, options)
    }

    /**
     * Get the current zoom level
     */
    getZoom(): number {
        return this._map.getZoom()
    }

    /**
     * Get the minimum zoom level
     */
    getMinZoom(): number {
        return this._map.getMinZoom()
    }

    /**
     * Get the maximum zoom level
     */
    getMaxZoom(): number {
        return this._map.getMaxZoom()
    }

    /**
     * Get the current center
     */
    getCenter(): LatLng {
        const center = this._map.getCenter()
        return { lat: center.lat, lng: center.lng }
    }

    /**
     * Get the current bounds
     */
    getBounds(): BoundsLike {
        const bounds = this._map.getBounds()
        return {
            southWest: { lat: bounds.getSouth(), lng: bounds.getWest() },
            northEast: { lat: bounds.getNorth(), lng: bounds.getEast() }
        }
    }

    /**
     * Get the current view state
     */
    getViewState(): ViewState {
        const center = this.getCenter()
        return {
            center: center,
            zoom: this.getZoom(),
            bearing: 0,
            pitch: 0
        }
    }

    /**
     * Set the view state
     */
    setViewState(state: ViewState, options: ViewOptions = {}): void {
        this.setView(state.center, state.zoom, options)
    }

    /**
     * Set maximum bounds
     */
    setMaxBounds(bounds: BoundsLike | null): void {
        const normalizedBounds = this._normalizeMaxBounds(bounds)
        this._map.setMaxBounds(normalizedBounds)
    }

    /**
     * Fit the map to bounds
     */
    fitBounds(bounds: BoundsLike, options: FitBoundsOptions = {}): void {
        let leafletBounds: any

        if (Array.isArray(bounds)) {
            leafletBounds = bounds
        } else if ((bounds as any).southWest && (bounds as any).northEast) {
            const sw = this._normalizeLatLng((bounds as any).southWest)
            const ne = this._normalizeLatLng((bounds as any).northEast)
            leafletBounds = [[sw.lat, sw.lng], [ne.lat, ne.lng]]
        }

        const leafletOptions: any = {}
        if (options.padding !== undefined) {
            leafletOptions.padding = this._normalizePadding(options.padding)
        }
        if (options.maxZoom !== undefined) {
            leafletOptions.maxZoom = options.maxZoom
        }
        if (options.animate !== undefined) {
            leafletOptions.animate = options.animate
        }

        this._map.fitBounds(leafletBounds, leafletOptions)
    }

    /**
     * Normalize padding to Leaflet format
     */
    private _normalizePadding(padding: PaddingLike): any {
        if (typeof padding === 'number') {
            return [padding, padding]
        }
        if (Array.isArray(padding)) {
            return [padding[0], padding[3]]
        }
        return padding
    }

    /**
     * Fly to a location with animation
     */
    flyTo(options: FlyToOptions): void {
        const normalizedCenter = this._normalizeLatLng(options.center)

        const leafletOptions: any = {
            animate: options.animate !== false,
        }

        if (options.duration !== undefined) {
            leafletOptions.duration = options.duration
        }
        if (options.easeLinearity !== undefined) {
            leafletOptions.easeLinearity = options.easeLinearity
        }

        const zoom = options.zoom !== undefined ? options.zoom : this._map.getZoom()
        this._map.flyTo([normalizedCenter.lat, normalizedCenter.lng], zoom, leafletOptions)
    }

    /**
     * Pan to a location with animation
     */
    panTo(center: LatLngLike, options: ViewOptions = {}): void {
        const normalizedCenter = this._normalizeLatLng(center)

        const leafletOptions: any = {}
        if (options.animate !== undefined) {
            leafletOptions.animate = options.animate
        }
        if (options.duration !== undefined) {
            leafletOptions.duration = options.duration
        }

        this._map.panTo([normalizedCenter.lat, normalizedCenter.lng], leafletOptions)
    }

    /**
     * Invalidate the map size (call after container resize)
     */
    invalidateSize(): void {
        this._map.invalidateSize()
    }

    /**
     * Get the size of the map container
     */
    getSize(): PointLike {
        const size = this._map.getSize()
        return { x: size.x, y: size.y }
    }

    // ========================================
    // COORDINATE CONVERSION METHODS
    // ========================================

    /**
     * Project geographic coordinates to pixel coordinates
     */
    projectCoordinates(latLng: LatLngLike, zoom?: number): PointLike {
        const normalizedLatLng = this._normalizeLatLng(latLng)
        const zoomLevel = zoom !== undefined ? zoom : this._map.getZoom()
        const point = this._map.project([normalizedLatLng.lat, normalizedLatLng.lng], zoomLevel)
        return { x: point.x, y: point.y }
    }

    /**
     * Unproject pixel coordinates to geographic coordinates
     */
    unprojectCoordinates(point: PointLike, zoom?: number): LatLngLike {
        const normalizedPoint = this._normalizePoint(point)
        const zoomLevel = zoom !== undefined ? zoom : this._map.getZoom()
        const latLng = this._map.unproject([normalizedPoint.x, normalizedPoint.y], zoomLevel)
        return { lat: latLng.lat, lng: latLng.lng }
    }

    /**
     * Convert container pixel position to geographic coordinates
     */
    containerPointToLatLng(point: PointLike): LatLngLike {
        const normalizedPoint = this._normalizePoint(point)
        const latLng = this._map.containerPointToLatLng([normalizedPoint.x, normalizedPoint.y])
        return { lat: latLng.lat, lng: latLng.lng }
    }

    /**
     * Convert geographic coordinates to container pixel position
     */
    latLngToContainerPoint(latLng: LatLngLike): PointLike {
        const normalizedLatLng = this._normalizeLatLng(latLng)
        const point = this._map.latLngToContainerPoint([normalizedLatLng.lat, normalizedLatLng.lng])
        return { x: point.x, y: point.y }
    }

    // ========================================
    // LAYER MANAGEMENT METHODS
    // ========================================

    getLayers(): any[] {
        return Array.from(this._layers.values())
    }

    hasLayer(layer: any | string): boolean {
        if (typeof layer === 'string') {
            return this._layers.has(layer)
        }
        return this._map.hasLayer(layer)
    }

    /**
     * Backward-compatible addLayer.
     *
     * If a raw Leaflet layer object is passed (has _leaflet_id), it is forwarded
     * directly to the native map — preserving all existing Map_.js / Layers_.js call sites.
     *
     * If a LayerOptions spec is passed, createLayer() is called so the layer is
     * also registered in the internal registry for later lookup by ID.
     */
    addLayer(layer: any): void {
        if (
            layer !== null &&
            typeof layer === 'object' &&
            typeof layer.type === 'string' &&
            layer._leaflet_id === undefined
        ) {
            this.createLayer(layer as LayerOptions)
            return
        }
        this._map.addLayer(layer)
    }

    /**
     * Create a Leaflet layer from a LayerOptions spec, register it by ID, and
     * add it to the map (unless visible === false).
     *
     * Delegates construction to {@link buildLeafletLayer}.
     *
     * @throws {Error} If `options.type` is not a supported layer type.
     */
    createLayer(options: LayerOptions): any {
        if (!options.id) {
            throw new Error('createLayer: options.id is required')
        }

        const leafletLayer = buildLeafletLayer(options.id, options)

        this._layers.set(options.id, leafletLayer)

        if (typeof options.opacity === 'number' && typeof leafletLayer.setOpacity === 'function') {
            leafletLayer.setOpacity(options.opacity)
        }
        if (typeof options.zIndex === 'number' && typeof leafletLayer.setZIndex === 'function') {
            leafletLayer.setZIndex(options.zIndex)
        }

        if (options.visible !== false) {
            this._map.addLayer(leafletLayer)
        }

        return leafletLayer
    }

    removeLayer(layer: any | string): void {
        if (typeof layer === 'string') {
            const leafletLayer = this._layers.get(layer)
            if (leafletLayer) {
                this._map.removeLayer(leafletLayer)
                this._layers.delete(layer)
            }
        } else {
            this._map.removeLayer(layer)
        }
    }

    /**
     * Mutate properties on an existing registered layer without recreating it.
     * `layer` can be the string ID used at `createLayer` time, or the native
     * Leaflet layer object (identified via its `_mmgisId` property set by
     * {@link buildLeafletLayer}).
     *
     * Supported mutations:
     *   opacity  → setOpacity()            (tile + GeoJSON)
     *   visible  → addLayer / removeLayer  (toggle without destroying)
     *   zIndex   → setZIndex()             (tile layers)
     *   style    → setStyle()              (GeoJSON layers)
     *   url      → setUrl()               (tile layers)
     */
    updateLayer(layer: any | string, updates: Partial<LayerOptions>): any {
        const id = resolveLeafletLayerId(layer)
        const leafletLayer = this._layers.get(id)
        if (!leafletLayer) {
            throw new Error(
                `updateLayer: no layer found with id "${id}". ` +
                `Ensure the layer was created with createLayer().`
            )
        }

        if (typeof updates.opacity === 'number' && typeof leafletLayer.setOpacity === 'function') {
            leafletLayer.setOpacity(updates.opacity)
        }

        if (typeof updates.visible === 'boolean') {
            const onMap = this._map.hasLayer(leafletLayer)
            if (updates.visible && !onMap) {
                this._map.addLayer(leafletLayer)
            } else if (!updates.visible && onMap) {
                this._map.removeLayer(leafletLayer)
            }
        }

        if (typeof updates.zIndex === 'number' && typeof leafletLayer.setZIndex === 'function') {
            leafletLayer.setZIndex(updates.zIndex)
        }

        if (updates.style !== undefined && typeof leafletLayer.setStyle === 'function') {
            leafletLayer.setStyle(updates.style)
        }

        if ((updates as TileLayerOptions).url !== undefined && typeof leafletLayer.setUrl === 'function') {
            leafletLayer.setUrl((updates as TileLayerOptions).url!)
        }

        return leafletLayer
    }

    setLayerZIndex(layer: any | string, zIndex: number): void {
        const leafletLayer = typeof layer === 'string' ? this._layers.get(layer) : layer
        if (leafletLayer && typeof leafletLayer.setZIndex === 'function') {
            leafletLayer.setZIndex(zIndex)
        }
    }

    bringToFront(layer: any | string): void {
        const leafletLayer = typeof layer === 'string' ? this._layers.get(layer) : layer
        if (leafletLayer && typeof leafletLayer.bringToFront === 'function') {
            leafletLayer.bringToFront()
        }
    }

    bringToBack(layer: any | string): void {
        const leafletLayer = typeof layer === 'string' ? this._layers.get(layer) : layer
        if (leafletLayer && typeof leafletLayer.bringToBack === 'function') {
            leafletLayer.bringToBack()
        }
    }

    setLayerOpacity(layer: any | string, opacity: number): void {
        const leafletLayer = typeof layer === 'string' ? this._layers.get(layer) : layer
        if (leafletLayer && typeof leafletLayer.setOpacity === 'function') {
            leafletLayer.setOpacity(opacity)
        }
    }

    // ========================================
    // EVENT METHODS
    // ========================================

    on(eventName: string, handler: MapEventHandler<any>, options: MapEventOptions = {}): void {
        // Wrap the handler to normalize event data
        const wrappedHandler = (e: any) => {
            const normalizedEvent = this._normalizeEvent(e, eventName)
            handler(normalizedEvent)
        }

        this._map.on(eventName, wrappedHandler)

        const key = `${eventName}_${handler.toString()}`
        this._eventHandlers.set(key, wrappedHandler)
    }

    off(eventName: string, handler?: MapEventHandler<any>): void {
        if (!handler) {
            this._map.off(eventName)
            this._eventHandlers.forEach((wrappedHandler, key) => {
                if (key.startsWith(eventName + '_')) {
                    this._eventHandlers.delete(key)
                }
            })
        } else {
            const key = `${eventName}_${handler.toString()}`
            const wrappedHandler = this._eventHandlers.get(key)
            if (wrappedHandler) {
                this._map.off(eventName, wrappedHandler)
                this._eventHandlers.delete(key)
            }
        }
    }

    emit(eventName: string, data?: unknown): void {
        this._map.fire(eventName, data)
    }

    /**
     * Normalize Leaflet events to a standard shape while preserving any
     * custom payload fields the emitter passed (e.g. `feature` on
     * `drawcomplete`, `vertices` on `drawvertex`). Without the spread,
     * `emit(name, { feature })` would silently strip `feature` and any
     * downstream consumer subscribed via `on(name, …)` would see nothing.
     */
    private _normalizeEvent(e: any, eventName: string): any {
        const normalized: any = {
            ...e,
            type: eventName,
            originalEvent: e.originalEvent,
        }

        if (e.latlng) {
            normalized.lat = e.latlng.lat
            normalized.lng = e.latlng.lng
            normalized.latlng = { lat: e.latlng.lat, lng: e.latlng.lng }
        }

        if (e.containerPoint) {
            normalized.containerPoint = { x: e.containerPoint.x, y: e.containerPoint.y }
        }

        if (e.layerPoint) {
            normalized.layerPoint = { x: e.layerPoint.x, y: e.layerPoint.y }
        }

        // Strip Leaflet internals that shouldn't leak to bus subscribers.
        delete normalized.target
        delete normalized.sourceTarget
        delete normalized.propagatedFrom

        return normalized
    }

    /**
     * Register a handler called when the user clicks a rendered feature.
     * Attaches a map-level click listener; on each click iterates registered
     * vector layers to find the topmost feature under the cursor. Returns an
     * unsubscribe function. Replace semantics: calling again with a new
     * handler detaches the prior listener first.
     */
    onFeatureClick(handler: FeatureInteractionHandler): () => void {
        this._detachFeatureClickListener()
        const listener = (e: any) => {
            const result = this._pickFeatureAtLatLng(e.latlng)
            handler({
                feature: result?.feature ?? null,
                layerId: result?.layerId,
                latlng: { lat: e.latlng.lat, lng: e.latlng.lng },
                pixel: e.containerPoint
                    ? { x: e.containerPoint.x, y: e.containerPoint.y }
                    : undefined,
            })
        }
        this._featureClickListener = listener
        this._map.on('click', listener)
        return () => {
            if (this._featureClickListener === listener) {
                this._detachFeatureClickListener()
            }
        }
    }

    private _detachFeatureClickListener(): void {
        if (this._featureClickListener && this._map) {
            this._map.off('click', this._featureClickListener)
        }
        this._featureClickListener = null
    }

    /**
     * Register a handler called when the user moves over a rendered feature.
     * Uses mousemove to track the hovered feature and mouseout to clear it.
     * Returns feature: null when the cursor leaves the map. Returns an
     * unsubscribe function. Replace semantics — see {@link onFeatureClick}.
     */
    onFeatureHover(handler: FeatureInteractionHandler): () => void {
        this._detachFeatureHoverListeners()
        const moveListener = (e: any) => {
            const result = this._pickFeatureAtLatLng(e.latlng)
            handler({
                feature: result?.feature ?? null,
                layerId: result?.layerId,
                latlng: { lat: e.latlng.lat, lng: e.latlng.lng },
                pixel: e.containerPoint
                    ? { x: e.containerPoint.x, y: e.containerPoint.y }
                    : undefined,
            })
        }
        const outListener = () => handler({ feature: null })
        this._featureHoverMoveListener = moveListener
        this._featureHoverOutListener = outListener
        this._map.on('mousemove', moveListener)
        this._map.on('mouseout', outListener)
        return () => {
            if (this._featureHoverMoveListener === moveListener) {
                this._detachFeatureHoverListeners()
            }
        }
    }

    private _detachFeatureHoverListeners(): void {
        if (this._map) {
            if (this._featureHoverMoveListener) {
                this._map.off('mousemove', this._featureHoverMoveListener)
            }
            if (this._featureHoverOutListener) {
                this._map.off('mouseout', this._featureHoverOutListener)
            }
        }
        this._featureHoverMoveListener = null
        this._featureHoverOutListener = null
    }

    private _ensureTerraDraw(options: DrawingOptions): TerraDraw {
        if (this._terraDraw) return this._terraDraw

        const finishKey = 'Enter'
        const cancelKey = options.cancelOnEscape === false ? null : 'Escape'

        const td = new TerraDraw({
            adapter: new TerraDrawLeafletAdapter({ lib: L, map: this._map }),
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
            this.emit('drawcomplete', { feature })
        }

        const onChange = (ids: any[], type: string) => {
            if (type !== 'create' && type !== 'update') return
            if (!this._drawingShape) return
            const lastId = ids[ids.length - 1]
            const snap = td.getSnapshotFeature(lastId)
            if (!snap) return
            const vertices = extractVerticesFromGeometry(snap.geometry as GeoJSON.Geometry)
            if (!vertices) return
            this.emit('drawvertex', { shape: this._drawingShape, vertices })
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
        if (!td.enabled) td.start()
        td.clear()
        td.setMode(shape)
        this._drawingShape = shape
        this.emit('drawstart', { shape })
    }

    /**
     * Tear down the terra-draw session and clear in-progress geometry
     * without emitting any lifecycle event. Used by both the user-facing
     * cancel path ({@link disableDrawing}) and the internal finish path
     * ({@link enableDrawing}'s `onFinish`) so the latter can emit
     * `drawcomplete` instead of `drawcancel`.
     */
    private _stopDrawing(): DrawShape | null {
        if (!this._drawingShape) return null
        const shape = this._drawingShape
        this._drawingShape = null
        if (this._terraDraw) {
            try { this._terraDraw.clear() } catch { /* terra-draw mid-vertex */ }
            try { this._terraDraw.stop() } catch { /* idempotent */ }
        }
        return shape
    }

    disableDrawing(): void {
        const shape = this._stopDrawing()
        if (shape) this.emit('drawcancel', { shape })
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

    /**
     * Query registered vector layers for features near a point or within a box.
     * Filters by `options.layers` (array of layer ids) when provided.
     * Leaflet has no GPU picking — this uses bounding-box intersection as a
     * fast approximation. Callers needing precise picking should use
     * onFeatureClick / onFeatureHover instead.
     */
    queryRenderedFeatures(
        geometry: PointLike | [PointLike, PointLike],
        options: QueryFeaturesOptions = {}
    ): FeaturePickResult[] {
        const results: FeaturePickResult[] = []

        this._layers.forEach((leafletLayer, id) => {
            if (options.layers && !options.layers.includes(id)) return
            if (typeof leafletLayer.getBounds !== 'function') return

            try {
                const bounds = leafletLayer.getBounds()
                const queryPoint = Array.isArray(geometry)
                    ? (geometry as [PointLike, PointLike])[0]
                    : geometry as PointLike
                const latlng = this._map.containerPointToLatLng(
                    Array.isArray(queryPoint)
                        ? queryPoint
                        : [queryPoint.x, queryPoint.y]
                )
                if (bounds.contains(latlng)) {
                    results.push({ feature: null, layerId: id, latlng })
                }
            } catch {
                // layer may not have valid bounds yet — skip silently
            }
        })

        return results
    }

    // ========================================
    // MARKER METHODS (IMapEngineMarkers)
    // ========================================

    /**
     * Add a marker to the map and register it by ID.
     * Defaults to L.circleMarker (dominant MMGIS pattern).
     * Uses L.marker + L.icon when options.icon.url is provided.
     *
     * @throws {Error} If options.id or options.position is missing.
     */
    addMarker(options: MarkerOptions): any {
        if (!options.id) {
            throw new Error('addMarker: options.id is required')
        }

        const leafletMarker = buildLeafletMarker(options.id, options)
        this._markers.set(options.id, leafletMarker)
        this._map.addLayer(leafletMarker)
        return leafletMarker
    }

    /**
     * Remove a marker from the map by string ID or native marker object.
     * No-op for unknown IDs.
     */
    removeMarker(marker: any | string): void {
        const id = resolveLeafletMarkerId(marker)
        const leafletMarker = this._markers.get(id)
        if (leafletMarker) {
            this._map.removeLayer(leafletMarker)
            this._markers.delete(id)
        }
    }

    /**
     * Mutate properties of an existing registered marker without recreating it.
     * `marker` can be the string ID or the native Leaflet marker object.
     *
     * Supported mutations:
     *   position      → setLatLng()
     *   icon          → setIcon()        (L.marker only)
     *   zIndexOffset  → setZIndexOffset()
     *   draggable     → dragging.enable() / .disable()
     *
     * @throws {Error} If the marker ID is not found in the registry.
     */
    /**
     * Anchored HTML overlay. Mirrors {@link DeckGLAdapter.addOverlay}: own
     * the DOM node directly (appended to the map container), project
     * lat/lng -> pixel on every view change, reposition. Avoids
     * L.marker + L.divIcon quirks (0×0 hit box, interactive-flag CSS
     * surprises) that diverged from the deck.gl behaviour.
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
        // Above all default Leaflet panes (popup-pane is 700) so clicks land
        // on the overlay, not on hidden marker/popup panes layered above us.
        node.style.zIndex = '1000'
        container.appendChild(node)

        // Tell Leaflet not to forward DOM events on this node up to the map's
        // click pipeline. This is Leaflet's canonical "popup absorbs clicks"
        // primitive — equivalent to L.DomEvent.disableClickPropagation. Without
        // it, clicking a tooltip button bubbles to the map, re-fires
        // feature:active, and AOI re-renders the tooltip — which masks the
        // dismiss and looks like "nothing happened".
        const Lib = (L as any)
        if (Lib?.DomEvent?.disableClickPropagation) {
            Lib.DomEvent.disableClickPropagation(node)
            Lib.DomEvent.disableScrollPropagation?.(node)
        }

        let userCleanup: (() => void) | void
        try {
            userCleanup = options.mount(node)
        } catch (err) {
            console.warn('[LeafletAdapter] addOverlay mount threw:', err)
        }

        const ll = this._normalizeLatLng(options.latlng)
        const reposition = (): void => {
            try {
                const pt = this._map.latLngToContainerPoint([ll.lat, ll.lng])
                node.style.left = pt.x - node.offsetWidth / 2 + 'px'
                node.style.top = pt.y - node.offsetHeight / 2 + 'px'
            } catch {
                // projection not ready yet — try again on next view change
            }
        }
        reposition()
        this._map.on('move', reposition)
        this._map.on('moveend', reposition)

        this._overlays.set(options.id, () => {
            this._map.off('move', reposition)
            this._map.off('moveend', reposition)
            try {
                if (typeof userCleanup === 'function') userCleanup()
            } catch (err) {
                console.warn('[LeafletAdapter] addOverlay cleanup threw:', err)
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

    updateMarker(marker: any | string, updates: Partial<MarkerOptions>): any {
        const id = resolveLeafletMarkerId(marker)
        const leafletMarker = this._markers.get(id)
        if (!leafletMarker) {
            throw new Error(
                `updateMarker: no marker found with id "${id}". ` +
                `Ensure the marker was created with addMarker().`
            )
        }

        if (updates.position !== undefined) {
            const pos = Array.isArray(updates.position)
                ? updates.position
                : [updates.position.lat, updates.position.lng]
            leafletMarker.setLatLng(pos)
        }

        if (updates.icon?.url !== undefined && typeof leafletMarker.setIcon === 'function') {
            const leafletIcon = (window as any).L.icon({
                iconUrl: updates.icon.url,
                ...(updates.icon.size ? { iconSize: updates.icon.size } : {}),
                ...(updates.icon.anchor ? { iconAnchor: updates.icon.anchor } : {}),
                ...(updates.icon.className ? { className: updates.icon.className } : {}),
            })
            leafletMarker.setIcon(leafletIcon)
        }

        if (typeof updates.zIndexOffset === 'number' &&
            typeof leafletMarker.setZIndexOffset === 'function') {
            leafletMarker.setZIndexOffset(updates.zIndexOffset)
        }

        if (typeof updates.draggable === 'boolean' && leafletMarker.dragging) {
            updates.draggable
                ? leafletMarker.dragging.enable()
                : leafletMarker.dragging.disable()
        }

        return leafletMarker
    }

    // ========================================
    // PRIVATE HELPERS
    // ========================================

    /**
     * Walk registered vector layers and return the specific feature under
     * the click point. Uses leaflet-pip for point-in-polygon picking when
     * available (handles the common case of a GeoJSON layer with many
     * polygon features). Falls back to bounds-intersection for single-feature
     * layers or layers without polygons.
     */
    private _pickFeatureAtLatLng(
        latlng: any
    ): { feature: Record<string, unknown>; layerId: string } | null {
        const pip = (L as any)?.leafletPip
        const lnglat = [latlng.lng, latlng.lat] as [number, number]
        for (const [id, leafletLayer] of this._layers) {
            try {
                if (
                    pip?.pointInLayer &&
                    typeof leafletLayer.eachLayer === 'function'
                ) {
                    // Collect all polygons under the click and return the
                    // last one (= topmost rendered, since L.GeoJSON renders
                    // in eachLayer / insertion order). This matches the
                    // expected "topmost wins" behaviour of every mapping
                    // library — plugins control which feature wins by
                    // controlling render order.
                    const hits = pip.pointInLayer(lnglat, leafletLayer, false)
                    if (hits && hits.length) {
                        const top = hits[hits.length - 1]
                        if (top?.feature) return { feature: top.feature, layerId: id }
                    }
                    continue
                }
                if (
                    typeof leafletLayer.getBounds === 'function' &&
                    leafletLayer.getBounds().contains(latlng)
                ) {
                    return { feature: leafletLayer.toGeoJSON?.() ?? {}, layerId: id }
                }
            } catch {
                // layer not ready / unsupported geometry — skip
            }
        }
        return null
    }
}
