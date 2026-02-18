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
} from '../types/view'
import { LayerOptions } from '../types/layers'
import {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
} from '../types/events'
import { MapEngineType } from '../types/engine'

// Leaflet is loaded globally via window.L
declare const L: any

export default class LeafletAdapter implements IMapEngine<any, any, any> {
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
     * Registry of event handlers for cleanup
     */
    private _eventHandlers: Map<string, Function> = new Map()

    /**
     * Stored initialization options
     */
    private _initOptions: MapInitOptions | null = null

    /**
     * Initialize the Leaflet map instance
     */
    init(options: MapInitOptions): void {
        // Store options for reference
        this._initOptions = options

        // Destroy existing map if present before re-fetching the container
        if (this._map) {
            this.destroy()
        }

        // Get the container element
        this._container = document.getElementById(options.containerId)
        if (!this._container) {
            throw new Error(`Container element with id "${options.containerId}" not found`)
        }

        // Build Leaflet map options
        const leafletOptions: any = {
            zoomControl: options.zoomControl !== false,
            editable: options.editable !== false,
            keyboard: options.keyboard !== false,
            fadeAnimation: options.fadeAnimation !== false,
            worldCopyJump: options.worldCopyJump || false,
            maxBounds: this._normalizeMaxBounds(options.maxBounds),
        }

        // Handle custom projection for planetary missions (Mars, Moon, etc.)
        if (options.projection && (options.projection as any).custom) {
            const crs = this._createCustomCRS(options.projection)
            leafletOptions.crs = crs
            leafletOptions.zoomDelta = options.zoomDelta || 0.05
            leafletOptions.zoomSnap = options.zoomSnap || 0

                // Store custom CRS globally for MMGIS compatibility
                ; (window as any).mmgisglobal = (window as any).mmgisglobal || {}
                ; (window as any).mmgisglobal.customCRS = crs
        } else {
            // Default projection (Web Mercator)
            // Create custom CRS for planetary radius if provided
            if (options.projection && options.projection.radius) {
                const projString = `+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=${options.projection.radius} +b=${options.projection.radius} +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`
                const crs = new L.Proj.CRS('EPSG:3857', projString, null, options.projection.radius)
                crs.projString = projString

                    ; (window as any).mmgisglobal = (window as any).mmgisglobal || {}
                    ; (window as any).mmgisglobal.customCRS = crs
            }
        }

        // Handle zoom delta and snap if provided
        if (options.zoomDelta !== undefined) {
            leafletOptions.zoomDelta = options.zoomDelta
        }
        if (options.zoomSnap !== undefined) {
            leafletOptions.zoomSnap = options.zoomSnap
        }
        if (options.wheelPxPerZoomLevel !== undefined) {
            leafletOptions.wheelPxPerZoomLevel = options.wheelPxPerZoomLevel
        }

        // Create the Leaflet map
        this._map = L.map(options.containerId, leafletOptions)

        // Set initial view if provided
        const center = this._normalizeLatLng(options.center || { lat: 0, lng: 0 })
        const zoom = options.zoom !== undefined ? options.zoom : 2
        this._map.setView([center.lat, center.lng], zoom)

        // Position zoom control if enabled
        if (this._map.zoomControl) {
            this._map.zoomControl.setPosition('topright')
        }

        // Set min/max zoom if provided
        if (options.minZoom !== undefined) {
            this._map.setMinZoom(options.minZoom)
        }
        if (options.maxZoom !== undefined) {
            this._map.setMaxZoom(options.maxZoom)
        }

        // Remove Leaflet attribution (MMGIS handles this separately)
        const attributionControl = this._container.querySelector('.leaflet-control-attribution')
        if (attributionControl) {
            attributionControl.remove()
        }
    }

    /**
     * Create a custom CRS for planetary projections
     */
    private _createCustomCRS(projection: ProjectionOptions): any {
        // Calculate resolutions array from zoom level and units per pixel
        const resolutions: number[] = []
        const baseResolution = parseFloat(projection.resunitsperpixel as string || '1')
        const zoomLevel = parseInt(projection.reszoomlevel as string) || 0

        // Generate resolutions for zoom levels, hardcoded to 20
        for (let i = 0; i <= 20; i++) {
            const zoomDiff = i - zoomLevel
            const resolution = baseResolution / Math.pow(2, zoomDiff)
            resolutions.push(resolution)
        }

        // Determine EPSG code
        const epsgCode = Number.isFinite(parseInt((projection as any).epsg?.[0]))
            ? `EPSG:${(projection as any).epsg}`
            : (projection as any).epsg

        // Build CRS options
        const crsOptions: any = {
            origin: [
                parseFloat((projection.origin as any)?.[0] || 0),
                parseFloat((projection.origin as any)?.[1] || 0),
            ],
            resolutions: resolutions,
        }

        // Add bounds if provided
        if (projection.bounds) {
            const bounds = projection.bounds as any
            crsOptions.bounds = L.bounds(
                [parseFloat(bounds[0]), parseFloat(bounds[1])],
                [parseFloat(bounds[2]), parseFloat(bounds[3])]
            )
        }

        // Create the CRS
        const crs = new L.Proj.CRS(
            epsgCode,
            projection.proj4 || (projection as any).proj,
            crsOptions,
            parseFloat(projection.radius?.toString() || '6371000')
        )

        // Store proj string for reference
        crs.projString = projection.proj4 || (projection as any).proj

        return crs
    }

    /**
     * Normalize maxBounds to Leaflet format
     */
    private _normalizeMaxBounds(bounds: BoundsLike | null | undefined): any {
        if (!bounds) return null

        // Handle array format [[lat, lng], [lat, lng]]
        if (Array.isArray(bounds)) {
            return bounds
        }

        // Handle object format { southWest: {...}, northEast: {...} }
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
            // Assume Leaflet order [lat, lng]
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

        // Remove all event handlers
        this._eventHandlers.forEach((handler, eventName) => {
            this._map.off(eventName, handler)
        })
        this._eventHandlers.clear()

        // Clear layers
        this._layers.clear()

        // Remove the map
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
        this._map.invalidateSize()
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
            bearing: 0, // Leaflet doesn't support bearing
            pitch: 0    // Leaflet doesn't support pitch
        }
    }

    /**
     * Set the view state
     */
    setViewState(state: ViewState, options: ViewOptions = {}): void {
        // Leaflet ignores bearing and pitch
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
            // [[lat, lng], [lat, lng]] format
            leafletBounds = bounds
        } else if ((bounds as any).southWest && (bounds as any).northEast) {
            // Object format
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
            // [top, right, bottom, left] -> Leaflet uses [top/bottom, left/right]
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
    // LAYER MANAGEMENT METHODS (Stubs for now)
    // These will be implemented in subsequent tickets
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

    addLayer(layer: any): void {
        this._map.addLayer(layer)
    }

    createLayer(options: LayerOptions): any {
        // To be implemented in layer management tickets
        throw new Error('createLayer not yet implemented')
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

    updateLayer(layer: any | string, options: Partial<LayerOptions>): any {
        // To be implemented in layer management tickets
        throw new Error('updateLayer not yet implemented')
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

        // Store for cleanup
        const key = `${eventName}_${handler.toString()}`
        this._eventHandlers.set(key, wrappedHandler)
    }

    off(eventName: string, handler?: MapEventHandler<any>): void {
        if (!handler) {
            this._map.off(eventName)
            // Remove all handlers for this event
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

        // Add lat/lng if available
        if (e.latlng) {
            normalized.lat = e.latlng.lat
            normalized.lng = e.latlng.lng
            normalized.latlng = { lat: e.latlng.lat, lng: e.latlng.lng }
        }

        // Add container point if available
        if (e.containerPoint) {
            normalized.containerPoint = { x: e.containerPoint.x, y: e.containerPoint.y }
        }

        // Add layer point if available
        if (e.layerPoint) {
            normalized.layerPoint = { x: e.layerPoint.x, y: e.layerPoint.y }
        }

        return normalized
    }

    onFeatureClick(handler: FeatureInteractionHandler): void {
        // To be implemented in event management tickets
        throw new Error('onFeatureClick not yet implemented')
    }

    onFeatureHover(handler: FeatureInteractionHandler): void {
        // To be implemented in event management tickets
        throw new Error('onFeatureHover not yet implemented')
    }

    queryRenderedFeatures(
        geometry: PointLike | [PointLike, PointLike],
        options: QueryFeaturesOptions = {}
    ): FeaturePickResult[] {
        // To be implemented in feature query tickets
        throw new Error('queryRenderedFeatures not yet implemented')
    }
}
