/**
 * LeafletAdapter.ts
 * 
 * Implements the IMapEngine interface for Leaflet.
 * This adapter encapsulates all Leaflet-specific logic and provides
 * a unified interface for MMGIS to interact with the Leaflet map engine.
 * 
 */

import { IMapEngine } from '../IMapEngine'
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
    BasemapOptions,
} from '../types/view'
import { LayerOptions, TileLayerOptions, MarkerOptions } from '../types/layers'
import { IMapEngineMarkers } from '../IMapEngineMarkers'
import {
    buildLeafletLayer,
    buildLeafletMarker,
    resolveLeafletLayerId,
    resolveLeafletMarkerId,
} from './LeafletHelpers'
import {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
} from '../types/events'
import { MapEngineType } from '../types/engine'
import { MAPBOX_STATIC_TILE_OPTIONS, OSM_FALLBACK_TILE } from './LeafletHelpers'

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
     * Registry of event handlers for cleanup
     */
    private _eventHandlers: Map<string, Function> = new Map()

    /**
     * Stored initialization options
     */
    private _initOptions: MapInitOptions | null = null

    private _basemapLayer: any = null
    private _basemapAccessToken: string | undefined

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

        if (options.basemap && options.basemap.provider && options.basemap.provider !== 'none') {
            this._initBasemapTileLayer(options.basemap)
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

        this._removeBasemapLayer()

        this._eventHandlers.forEach((handler, eventName) => {
            this._map.off(eventName, handler)
        })
        this._eventHandlers.clear()

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

    getBasemap(): any {
        return this._basemapLayer
    }

    /**
     * Get the container element
     */
    getContainer(): HTMLElement {
        return this._container!
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
     * Normalize Leaflet events to standard format
     */
    private _normalizeEvent(e: any, eventName: string): any {
        const normalized: any = {
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

        return normalized
    }

    /**
     * Register a handler called when the user clicks a rendered feature.
     * Attaches a map-level click listener; on each click iterates registered
     * vector layers to find the topmost feature under the cursor.
     */
    onFeatureClick(handler: FeatureInteractionHandler): void {
        this._map.on('click', (e: any) => {
            const result = this._pickFeatureAtLatLng(e.latlng)
            handler({
                feature: result?.feature ?? null,
                layerId: result?.layerId,
                latlng: { lat: e.latlng.lat, lng: e.latlng.lng },
                pixel: e.containerPoint
                    ? { x: e.containerPoint.x, y: e.containerPoint.y }
                    : undefined,
            })
        })
    }

    /**
     * Register a handler called when the user moves over a rendered feature.
     * Uses mousemove to track the hovered feature and mouseout to clear it.
     * Returns feature: null when the cursor leaves the map.
     */
    onFeatureHover(handler: FeatureInteractionHandler): void {
        this._map.on('mousemove', (e: any) => {
            const result = this._pickFeatureAtLatLng(e.latlng)
            handler({
                feature: result?.feature ?? null,
                layerId: result?.layerId,
                latlng: { lat: e.latlng.lat, lng: e.latlng.lng },
                pixel: e.containerPoint
                    ? { x: e.containerPoint.x, y: e.containerPoint.y }
                    : undefined,
            })
        })
        this._map.on('mouseout', () => {
            handler({ feature: null })
        })
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
     * Walk registered vector layers and return the first feature whose bounds
     * contain the given latlng. Used by onFeatureClick and onFeatureHover.
     */
    private _pickFeatureAtLatLng(
        latlng: any
    ): { feature: Record<string, unknown>; layerId: string } | null {
        for (const [id, leafletLayer] of this._layers) {
            if (typeof leafletLayer.getBounds !== 'function') continue
            try {
                if (leafletLayer.getBounds().contains(latlng)) {
                    return { feature: leafletLayer.toGeoJSON?.() ?? {}, layerId: id }
                }
            } catch {
                // layer bounds not yet available
            }
        }
        return null
    }

    // ========================================
    // BASEMAP TILE LAYER METHODS
    // ========================================

    private _initBasemapTileLayer(basemap: BasemapOptions): void {
        this._basemapAccessToken = basemap.accessToken
        const spec = this._resolveBasemapTileSpec(basemap)
        this._basemapLayer = L.tileLayer(spec.url, spec.options)
        this._basemapLayer.addTo(this._map)
        this._basemapLayer.bringToBack()

        const specMinZoom = (spec.options as { minZoom?: number }).minZoom
        if (typeof specMinZoom === 'number' && specMinZoom > this._map.getMinZoom()) {
            this._map.setMinZoom(specMinZoom)
        }
    }

    setBasemapStyle(styleUrl: string): void {
        if (!this._map) return
        const spec = this._resolveBasemapTileSpec({
            provider: this._inferProvider(styleUrl),
            style: styleUrl,
            accessToken: this._basemapAccessToken,
        })
        this._removeBasemapLayer()
        this._basemapLayer = L.tileLayer(spec.url, spec.options)
        this._basemapLayer.addTo(this._map)
        this._basemapLayer.bringToBack()
    }

    private _removeBasemapLayer(): void {
        if (this._basemapLayer && this._map) {
            this._map.removeLayer(this._basemapLayer)
        }
        this._basemapLayer = null
    }

    private _resolveBasemapTileSpec(basemap: BasemapOptions): {
        url: string
        options: Record<string, unknown>
    } {
        const style = basemap.style || ''

        const mapboxMatch = style.match(/^mapbox:\/\/styles\/([^/]+)\/(.+)$/)
        if (mapboxMatch) {
            const [, user, styleId] = mapboxMatch
            const token = basemap.accessToken || this._basemapAccessToken || ''
            return {
                url: `https://api.mapbox.com/styles/v1/${user}/${styleId}/tiles/{z}/{x}/{y}?access_token=${token}`,
                options: { ...MAPBOX_STATIC_TILE_OPTIONS },
            }
        }

        if (style.includes('{z}') && style.includes('{x}') && style.includes('{y}')) {
            return { url: style, options: {} }
        }

        return {
            url: OSM_FALLBACK_TILE.url,
            options: { ...OSM_FALLBACK_TILE.options },
        }
    }

    private _inferProvider(styleUrl: string): BasemapOptions['provider'] {
        if (styleUrl.startsWith('mapbox://')) return 'mapbox'
        return 'maplibre'
    }
}
