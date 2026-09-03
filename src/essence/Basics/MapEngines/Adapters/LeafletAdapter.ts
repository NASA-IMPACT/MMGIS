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
    BasemapOptions,
} from '../types/view'
import {
    LayerOptions,
    TileLayerOptions,
    MarkerOptions,
    OverlayOptions,
    RefreshContext,
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
import {
    committedVerticesFromChange,
    DoubleClickZoomHandler,
    DrawEndClickGuard,
    drawModeKeyEvents,
    DrawPointerWatch,
    drawStyles,
    validateDrawnLineString,
} from './DrawingHelpers'
import { getMapScreenshot } from './LeafletScreenshot'
import {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
    DrawShape,
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
     * Per-layer refresh hooks, keyed the same way as {@link _layers}. They
     * mutate in place and return nothing — see {@link setLayerRefresher}.
     */
    private _refreshers: Map<string, (layer: any, ctx: RefreshContext) => void> = new Map()

    /**
     * Registry of markers by ID
     */
    private _markers: Map<string, any> = new Map()

    /**
     * Registry of anchored HTML overlays (id -> teardown function).
     */
    private _overlays: Map<string, () => void> = new Map()

    /**
     * Registry of event handlers for cleanup, keyed by event name and the
     * subscriber's source so {@link off} can find the wrapper it made. The
     * event name is kept alongside the wrapper because the key is not one.
     */
    private _eventHandlers: Map<
        string,
        { eventName: string; wrapped: (e: any) => void }
    > = new Map()

    /**
     * Click subscribers registered through {@link on}. They hang off the
     * adapter's own map listener rather than off Leaflet directly, so that
     * whether a drawing session owns a click is answered once, where clicks
     * are reported, instead of at every subscription — the same shape
     * DeckGLAdapter's pointer-click path has.
     */
    private _clickListeners: Set<(e: any) => void> = new Set()

    /** Whether {@link _onMapClick} is currently on the map. */
    private _mapClickAttached = false

    /**
     * Stored initialization options
     */
    private _initOptions: MapInitOptions | null = null

    private _basemapLayer: any = null
    private _basemapAccessToken: string | undefined

    /**
     * The listeners onFeatureClick / onFeatureHover installed. The click one
     * is called by {@link _onMapClick}, the hover ones sit on the map. Stored
     * so replacing the handler (or destroying the adapter) cleanly detaches
     * the prior listener — without this, each call to onFeatureHover would
     * leave Leaflet with one more `mousemove`/`mouseout` listener than the
     * last.
     */
    private _featureClickListener: ((e: any) => void) | null = null
    private _featureHoverMoveListener: ((e: any) => void) | null = null
    private _featureHoverOutListener: (() => void) | null = null

    private _terraDraw: TerraDraw | null = null
    private _drawingShape: DrawShape | null = null
    private _terraDrawListeners: Array<() => void> = []
    private _drawEndClick = new DrawEndClickGuard()
    private _drawPointers = new DrawPointerWatch()

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

        // End a live session the normal way, while its listeners are still
        // attached, so its initiator hears `drawcancel` and stops driving a
        // session that is about to have no engine.
        this.disableDrawing()

        this._removeBasemapLayer()

        this._eventHandlers.forEach(({ eventName, wrapped }) => {
            // Click subscribers never went on the map — they hang off
            // {@link _onMapClick}, which _detachMapClickListener takes off.
            if (eventName !== 'click') this._map.off(eventName, wrapped)
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

        this._drawEndClick.dispose()
        this._drawPointers.stop()

        if (this._terraDraw) {
            this._terraDrawListeners.forEach((off) => { try { off() } catch { /* ignore */ } })
            this._terraDrawListeners = []
            try { this._terraDraw.stop() } catch { /* ignore */ }
            this._terraDraw = null
        }

        this._clickListeners.clear()
        this._detachMapClickListener()
        this._featureClickListener = null
        this._detachFeatureHoverListeners()

        this._layers.clear()
        this._refreshers.clear()
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

    /**
     * Whether the layer is currently on the map.
     *
     * Both forms ask the map, never the registry: `_layers` holds every
     * MMGIS-built tile layer whether or not it is on the map, so membership
     * there does not answer "is it on the map". `hasLayer(id)` and
     * `hasLayer(layerObject)` must not disagree, because mmgisAPI's
     * `map:hasLayer` exposes this answer publicly.
     */
    hasLayer(layer: any | string): boolean {
        const leafletLayer =
            typeof layer === 'string' ? this._layers.get(layer) : layer
        if (!leafletLayer) return false
        return this._map?.hasLayer(leafletLayer) === true
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

        // Re-creating an id replaces the prior layer; without this the old
        // layer stays on the map with no registry entry left to remove it by.
        if (this._layers.has(options.id)) {
            this.removeLayer(options.id)
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
                this._refreshers.delete(layer)
            }
        } else {
            // Deliberately keeps the registration. Map_.rmNotNull removes
            // layers by object every time one is toggled off, and a toggled-off
            // layer still has to be refreshable — TimeControl.reloadLayer's
            // `evenIfOff` path depends on it. Only the id form, which means
            // "destroy this layer", drops the entry.
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

    registerLayer(id: string, layer: any): void {
        // resolveLeafletLayerId reads _mmgisId, so stamp it: the layer must be
        // findable by object as well as by id.
        if (layer != null && typeof layer === 'object') layer._mmgisId = id
        this._layers.set(id, layer)
    }

    /**
     * Mutates the layer in place; any return value is ignored. See
     * {@link IMapEngine.setLayerRefresher}.
     */
    setLayerRefresher(
        id: string,
        refresh: ((layer: any, ctx: RefreshContext) => void) | null
    ): void {
        if (refresh == null) this._refreshers.delete(id)
        else this._refreshers.set(id, refresh)
    }

    refreshLayer(id: string, ctx: RefreshContext = {}): boolean {
        const layer = this._layers.get(id)
        if (!layer) return false

        // Return value deliberately ignored — see setLayerRefresher above.
        const refresh = this._refreshers.get(id)
        if (refresh) {
            refresh(layer, {
                url: ctx.url,
                tileOptions: ctx.tileOptions,
                force: ctx.force,
            })
            return true
        }

        // A Leaflet tile layer recompiles its URL per tile from this.options,
        // which is what refresh() merges tileOptions into — that is why Leaflet
        // keeps its tile cache where deck.gl cannot.
        if (typeof layer.refresh !== 'function') return false
        layer.refresh(ctx.url, ctx.force === true, ctx.tileOptions)
        return true
    }

    /**
     * Visibility is map membership here; the registry entry is untouched
     * either way. See {@link IMapEngine.setLayerVisibility}.
     */
    setLayerVisibility(layer: any | string, visible: boolean): void {
        const leafletLayer = this._layers.get(resolveLeafletLayerId(layer))
        if (!leafletLayer) return

        const onMap = this._map?.hasLayer(leafletLayer) === true
        if (visible && !onMap) this._map.addLayer(leafletLayer)
        else if (!visible && onMap) this._map.removeLayer(leafletLayer)
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

    setLayerOpacity(
        layer: any | string,
        opacity: number,
        options?: { fillOpacity?: number }
    ): void {
        const leafletLayer = typeof layer === 'string' ? this._layers.get(layer) : layer
        if (!leafletLayer) return

        // Tile, image and video layers carry a whole-element opacity; vector
        // layers have to be re-styled, and paint stroke and fill separately.
        if (typeof leafletLayer.setOpacity === 'function') {
            leafletLayer.setOpacity(opacity)
            return
        }
        if (typeof leafletLayer.setStyle === 'function') {
            leafletLayer.setStyle({
                opacity,
                fillOpacity: options?.fillOpacity ?? opacity,
            })
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

        // Clicks reach their subscribers through the adapter's own map
        // listener, the one place a drawing session is checked for all of them
        // (see {@link _onMapClick}). Every other event goes straight to
        // Leaflet.
        if (eventName === 'click') {
            this._clickListeners.add(wrappedHandler)
            this._attachMapClickListener()
        } else {
            this._map.on(eventName, wrappedHandler)
        }

        const key = `${eventName}_${handler.toString()}`
        this._eventHandlers.set(key, { eventName, wrapped: wrappedHandler })
    }

    /**
     * Report a click Leaflet delivered, unless the drawing session owns it:
     * the ones terra-draw is taking as vertices, and the ones that arrive once
     * the session has ended (see {@link DrawEndClickGuard}). Nothing in
     * Leaflet holds a vertex click back on its own — terra-draw's adapter
     * never stops click propagation — so the session is checked here, at the
     * single point every click the adapter reports passes through, as
     * DeckGLAdapter's own click path does.
     */
    private _onMapClick = (e: any): void => {
        if (this._drawingShape || this._drawEndClick.owns(e?.originalEvent)) return
        this._featureClickListener?.(e)
        this._clickListeners.forEach((listener) => listener(e))
    }

    /** Put {@link _onMapClick} on the map, once, for its first subscriber. */
    private _attachMapClickListener(): void {
        if (this._mapClickAttached || !this._map) return
        this._map.on('click', this._onMapClick)
        this._mapClickAttached = true
    }

    private _detachMapClickListener(): void {
        if (!this._mapClickAttached) return
        this._map?.off('click', this._onMapClick)
        this._mapClickAttached = false
    }

    off(eventName: string, handler?: MapEventHandler<any>): void {
        if (!handler) {
            if (eventName === 'click') {
                this._clickListeners.clear()
            } else {
                this._map.off(eventName)
            }
            for (const key of this._eventHandlers.keys()) {
                if (key.startsWith(eventName + '_')) {
                    this._eventHandlers.delete(key)
                }
            }
        } else {
            const key = `${eventName}_${handler.toString()}`
            const entry = this._eventHandlers.get(key)
            if (entry) {
                if (eventName === 'click') {
                    this._clickListeners.delete(entry.wrapped)
                } else {
                    this._map.off(eventName, entry.wrapped)
                }
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
     * Hangs off the adapter's map click listener; on each click iterates
     * registered vector layers to find the topmost feature under the cursor.
     * Returns an unsubscribe function. Replace semantics: calling again
     * replaces the handler.
     */
    onFeatureClick(handler: FeatureInteractionHandler): () => void {
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
        this._attachMapClickListener()
        return () => {
            if (this._featureClickListener === listener) {
                this._featureClickListener = null
            }
        }
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

    private _ensureTerraDraw(): TerraDraw {
        if (this._terraDraw) return this._terraDraw

        // The drawing is rendered in the theme's accent, at the stroke width
        // a committed shape is drawn with; terra-draw's own defaults supply
        // the opacities.
        const styles = drawStyles()

        const td = new TerraDraw({
            adapter: new TerraDrawLeafletAdapter({ lib: L, map: this._map }),
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
            this.emit('drawcomplete', { feature })
        }

        const onChange = (ids: any[], type: string) => {
            if (type !== 'create' && type !== 'update') return
            const shape = this._drawingShape
            if (!shape) return
            const vertices = committedVerticesFromChange(shape, ids, (id) =>
                td.getSnapshotFeature(id)
            )
            if (vertices) this.emit('drawvertex', { shape, vertices })
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
        // Swapping the engine's own mode is not the user backing out of a
        // drawing, so the restart ends the previous session without emitting —
        // unless no new session takes its place, and the one it ended is owed
        // its cancel after all.
        const previous = this._stopDrawing()

        const td = this._ensureTerraDraw()
        // Handed over before the mode starts, while double-click zoom is still
        // the map's own: terra-draw disables it from here to the end of the
        // session, and the guard is what gives it back.
        this._drawEndClick.holdDoubleClickZoom(this._doubleClickZoom())
        try {
            if (!td.enabled) td.start()
            td.clear()
            td.setMode(shape)
        } catch (err) {
            // terra-draw throws on a shape it has no mode for, from a start
            // that has already put its listeners back on the map routed to
            // whichever mode it was last in. Stopping unregisters them, and a
            // session that never began has no end to give double-click zoom
            // back at.
            try { td.stop() } catch { /* map already gone */ }
            this._drawEndClick.dispose()
            if (previous) this.emit('drawcancel', { shape: previous })
            throw err
        }
        this._drawingShape = shape
        this._drawPointers.start(this._drawEventElement())
        this.emit('drawstart', { shape })
    }

    private _doubleClickZoom(): DoubleClickZoomHandler | undefined {
        return (this._map as { doubleClickZoom?: DoubleClickZoomHandler })
            ?.doubleClickZoom
    }

    /** The element terra-draw's Leaflet adapter attaches its listeners to. */
    private _drawEventElement(): HTMLElement | null {
        return this._map?.getContainer?.() ?? null
    }

    /**
     * Tear down the terra-draw session and clear in-progress geometry
     * without emitting any lifecycle event. The caller decides what the end
     * means: {@link disableDrawing} adds the `drawcancel`, the finish in
     * {@link _ensureTerraDraw} emits `drawcomplete` instead, and the restart
     * in {@link enableDrawing} says nothing unless the new mode fails to
     * start, leaving no session to have restarted into.
     */
    private _stopDrawing(): DrawShape | null {
        if (!this._drawingShape) return null
        const shape = this._drawingShape
        this._drawingShape = null
        if (this._terraDraw) {
            try { this._terraDraw.clear() } catch { /* terra-draw mid-vertex */ }
            try { this._terraDraw.stop() } catch { /* idempotent */ }
        }
        // The drawing's clicks reach Leaflet after this, on the native clicks
        // that follow its pointerups; the watch is what knows whether one is
        // still owed. Arming is also what puts double-click zoom back on the
        // clock, so it happens on every end of a session.
        this._drawEndClick.arm(
            this._drawPointers.pendingClick,
            this._drawEventElement()
        )
        this._drawPointers.stop()
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
     * keyup on the map container — the element terra-draw listens on. The
     * mode emits `finish` if the geometry is valid, which ends the session; if
     * it isn't (e.g. polygon with <3 vertices), the dispatch is a no-op and the
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

    ownsDrawEndClick(source: unknown): boolean {
        return this._drawEndClick.owns(source)
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

    // ========================================
    // BASEMAP TILE LAYER METHODS
    // ========================================

    private _initBasemapTileLayer(basemap: BasemapOptions): void {
        this._basemapAccessToken = basemap.accessToken
        const spec = this._resolveBasemapTileSpec(basemap)
        if (!spec) return
        this._basemapLayer = L.tileLayer(spec.url, spec.options)
        this._basemapLayer.addTo(this._map)
        this._basemapLayer.bringToBack()

        const specMinZoom = (spec.options as { minZoom?: number }).minZoom
        if (typeof specMinZoom === 'number' && specMinZoom > this._map.getMinZoom()) {
            this._map.setMinZoom(specMinZoom)
        }
    }

    setBasemapStyle(styleUrl: string): boolean {
        if (!this._map) return false
        const spec = this._resolveBasemapTileSpec({
            provider: this._inferProvider(styleUrl),
            style: styleUrl,
            accessToken: this._basemapAccessToken,
        })
        if (!spec) return false
        this._removeBasemapLayer()
        this._basemapLayer = L.tileLayer(spec.url, spec.options)
        this._basemapLayer.addTo(this._map)
        this._basemapLayer.bringToBack()
        return true
    }

    private _removeBasemapLayer(): void {
        if (this._basemapLayer && this._map) {
            this._map.removeLayer(this._basemapLayer)
        }
        this._basemapLayer = null
    }

    /**
     * Resolve a basemap config into a Leaflet tile-layer spec, or null when
     * the style cannot be rendered by this engine: a mapbox:// style with no
     * access token (every tile would 401), or a GL style.json URL (Leaflet
     * consumes raster XYZ templates only). Returning null skips the basemap
     * rather than silently rendering the wrong one.
     */
    private _resolveBasemapTileSpec(basemap: BasemapOptions): {
        url: string
        options: Record<string, unknown>
    } | null {
        const style = basemap.style || ''

        const mapboxMatch = style.match(/^mapbox:\/\/styles\/([^/]+)\/(.+)$/)
        if (mapboxMatch) {
            const [, user, styleId] = mapboxMatch
            const token = basemap.accessToken || this._basemapAccessToken || ''
            if (!token) {
                console.warn(
                    `[LeafletAdapter] Skipping basemap "${style}": mapbox styles require an accessToken`
                )
                return null
            }
            return {
                url: `https://api.mapbox.com/styles/v1/${user}/${styleId}/tiles/{z}/{x}/{y}?access_token=${token}`,
                options: {
                    tileSize: 512,
                    zoomOffset: -1,
                    minZoom: 1,
                    attribution: '© Mapbox © OpenStreetMap',
                },
            }
        }

        if (style.includes('{z}') && style.includes('{x}') && style.includes('{y}')) {
            return { url: style, options: {} }
        }

        console.warn(
            `[LeafletAdapter] Skipping basemap "${style}": the Leaflet engine renders raster {z}/{x}/{y} templates or mapbox:// styles, not GL style URLs`
        )
        return null
    }

    private _inferProvider(styleUrl: string): BasemapOptions['provider'] {
        if (styleUrl.startsWith('mapbox://')) return 'mapbox'
        return 'maplibre'
    }
}
