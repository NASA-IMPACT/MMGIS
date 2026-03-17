/**
 * DeckGL map engine adapter implementing {@link IMapEngine}.
 *
 * Translates the imperative IMapEngine interface into deck.gl's declarative
 * layer-array and controlled-viewState patterns.
 *
 * Coordinate convention: IMapEngine uses {lat, lng} objects (or [lat, lng] tuples
 * in Leaflet order). deck.gl uses {longitude, latitude} and [lng, lat] GeoJSON order.
 * All conversion is internal to this adapter.
 */

import {
    Deck,
    FlyToInterpolator,
    LinearInterpolator,
    type PickingInfo,
    type Layer,
} from '@deck.gl/core'

import type { IMapEngine } from '../IMapEngine'
import { MAP_ENGINE } from '../types/engine'
import type { MapEngineType } from '../types/engine'
import type { LatLng, LatLngLike, BoundsLike, PointLike } from '../types/geometry'
import type {
    ViewState,
    ViewOptions,
    FlyToOptions,
    FitBoundsOptions,
    MapInitOptions,
} from '../types/view'
import type { LayerOptions } from '../types/layers'
import type {
    MapEventHandler,
    MapEventOptions,
    FeatureInteractionHandler,
    FeaturePickResult,
    QueryFeaturesOptions,
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

/**
 * DeckGL map engine adapter.
 *
 * Wraps a `Deck` instance in controlled viewState mode. All layer mutations
 * rebuild the declarative layers array and call `deck.setProps({ layers })`
 * so deck.gl diffs and re-renders only what changed.
 *
 * @example
 * ```ts
 * import { DeckGLAdapter } from './Adapters/DeckGLAdapter'
 * import { mapEngineRegistry, MAP_ENGINE } from '../MapEngines'
 *
 * mapEngineRegistry.register(MAP_ENGINE.DECKGL, DeckGLAdapter)
 * const engine = mapEngineRegistry.createEngine(MAP_ENGINE.DECKGL)
 * await engine.init({ containerId: 'map', zoom: 4, center: { lat: 0, lng: 0 } })
 * ```
 */
export class DeckGLAdapter implements IMapEngine<Deck, Layer, PickingInfo> {
    readonly engineType: MapEngineType = MAP_ENGINE.DECKGL

    private _container!: HTMLElement
    private _deck: Deck | null = null

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

    /**
     * Create and mount the Deck instance inside the element identified by
     * `options.containerId`.
     *
     * @throws {Error} If the container element is not found in the DOM.
     */
    async init(options: MapInitOptions): Promise<void> {
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

        // DeckProps generics don't accept our plain DeckViewState shape directly.
        this._deck = new Deck({
            parent: this._container,
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
                this._featureClickHandler?.(pickInfoToResult(info))
            },
            onHover: (info: PickingInfo) => {
                this._featureHoverHandler?.(pickInfoToResult(info))
            },
        } as any)
    }

    /**
     * Tear down the Deck instance, remove all layers, and clear all listeners.
     * The adapter must not be used again after this call.
     */
    destroy(): void {
        this._deck?.finalize()
        this._deck = null
        this._layers.clear()
        this._layerZIndices.clear()
        this._eventListeners.clear()
        this._featureClickHandler = null
        this._featureHoverHandler = null
    }

    getNativeMap(): Deck {
        return this._deck as Deck
    }

    getContainer(): HTMLElement {
        return this._container
    }

    setView(center: LatLngLike, zoom?: number, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(center)
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
        this._applyViewState({ ...this._viewState, zoom }, options)
    }

    setCenter(center: LatLngLike, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(center)
        this._applyViewState({ ...this._viewState, longitude: lng, latitude: lat }, options)
    }

    getZoom(): number {
        return this._viewState.zoom
    }

    getMinZoom(): number {
        return this._minZoom
    }

    getMaxZoom(): number {
        return this._maxZoom
    }

    getCenter(): LatLng {
        return { lat: this._viewState.latitude, lng: this._viewState.longitude }
    }

    /**
     * Derive visible geographic bounds by unprojecting the container corners
     * via WebMercatorViewport.
     */
    getBounds(): BoundsLike {
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
        return {
            center: { lat: this._viewState.latitude, lng: this._viewState.longitude },
            zoom: this._viewState.zoom,
            bearing: this._viewState.bearing,
            pitch: this._viewState.pitch,
        }
    }

    setViewState(state: ViewState, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(state.center)
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
    }

    /**
     * Compute the target view state for the given bounds using
     * WebMercatorViewport.fitBounds, then apply it.
     */
    fitBounds(bounds: BoundsLike, options?: FitBoundsOptions): void {
        const [[west, south], [east, north]] = resolveBounds(bounds)
        const fitted = makeViewport(this._viewState, this._container).fitBounds(
            [[west, south], [east, north]],
            {
                padding: resolvePadding(options?.padding),
                ...(options?.maxZoom !== undefined ? { maxZoom: options.maxZoom } : {}),
            }
        )
        this._applyViewState(
            { ...this._viewState, longitude: fitted.longitude, latitude: fitted.latitude, zoom: fitted.zoom },
            options
        )
    }

    /**
     * Animate to the target using FlyToInterpolator for a curved flight path.
     */
    flyTo(options: FlyToOptions): void {
        const { lat, lng } = resolveLatLng(options.center)
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
     * Smoothly pan to a new center using LinearInterpolator.
     */
    panTo(center: LatLngLike, options?: ViewOptions): void {
        const { lat, lng } = resolveLatLng(center)
        const duration = options?.duration ?? 300
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
     * Force a full redraw. deck.gl auto-handles container resize via
     * ResizeObserver; call this only when that detection does not fire (e.g.
     * inside a panel that becomes visible after being hidden).
     */
    invalidateSize(): void {
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
        }) as Layer
        this._layers.set(id, updated)
        this._syncLayers()
        return updated
    }

    /**
     * Assign a logical z-index. Because deck.gl renders layers by array order
     * (index 0 = bottom), this re-sorts the internal map by ascending z-index.
     */
    setLayerZIndex(layer: Layer | string, zIndex: number): void {
        const id = resolveLayerId(layer)
        this._layerZIndices.set(id, zIndex)
        this._sortLayersByZIndex()
        this._syncLayers()
    }

    /**
     * Move a layer to the end of the layers array so deck.gl renders it on top.
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
     * Move a layer to the start of the layers array so deck.gl renders it below
     * all others.
     */
    bringToBack(layer: Layer | string): void {
        const id = resolveLayerId(layer)
        const existing = this._layers.get(id)
        if (!existing) return
        const remaining = [...this._layers.entries()].filter(([k]) => k !== id)
        this._layers = new Map([[id, existing], ...remaining])
        this._syncLayers()
    }

    setLayerOpacity(layer: Layer | string, opacity: number): void {
        this.updateLayer(layer, { opacity })
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

    onFeatureClick(handler: FeatureInteractionHandler): void {
        this._featureClickHandler = handler
    }

    onFeatureHover(handler: FeatureInteractionHandler): void {
        this._featureHoverHandler = handler
    }

    /**
     * Pick features at a pixel point or within a pixel bounding box.
     *
     * - Point form: calls `deck.pickObject` with radius 1.
     * - Box form `[topLeft, bottomRight]`: calls `deck.pickMultipleObjects`.
     */
    queryRenderedFeatures(
        geometry: PointLike | [PointLike, PointLike],
        options?: QueryFeaturesOptions
    ): FeaturePickResult[] {
        if (!this._deck) return []

        const isBox =
            Array.isArray(geometry) &&
            (Array.isArray((geometry as unknown[])[0]) || typeof (geometry as unknown[])[0] === 'object')

        if (isBox) {
            const [p1, p2] = geometry as [PointLike, PointLike]
            const { x: x1, y: y1 } = resolvePoint(p1)
            const { x: x2, y: y2 } = resolvePoint(p2)
            return this._deck
                .pickMultipleObjects({
                    x: Math.min(x1, x2),
                    y: Math.min(y1, y2),
                    radius: Math.abs(x2 - x1),
                    layerIds: options?.layers,
                })
                .map(pickInfoToResult)
        }

        const { x, y } = resolvePoint(geometry as PointLike)
        const pick = this._deck.pickObject({ x, y, radius: 1, layerIds: options?.layers })
        return pick ? [pickInfoToResult(pick)] : []
    }

    /**
     * Project geographic coordinates to container pixel coordinates using the
     * current viewport. Pass `zoom` to override the viewport zoom.
     */
    projectCoordinates(latLng: LatLngLike, zoom?: number): PointLike {
        const { lat, lng } = resolveLatLng(latLng)
        const [x, y] = makeViewport(this._viewState, this._container, zoom).project([lng, lat]) as [number, number]
        return { x, y }
    }

    unprojectCoordinates(point: PointLike, zoom?: number): LatLngLike {
        const { x, y } = resolvePoint(point)
        const [lng, lat] = makeViewport(this._viewState, this._container, zoom).unproject([x, y]) as [number, number]
        return { lat, lng }
    }

    containerPointToLatLng(point: PointLike): LatLngLike {
        return this.unprojectCoordinates(point)
    }

    latLngToContainerPoint(latLng: LatLngLike): PointLike {
        return this.projectCoordinates(latLng)
    }

    /**
     * Apply a new view state to the Deck instance.
     *
     * When `options.animate` is absent or false, transition props are cleared
     * so the camera jumps immediately. Callers that want animation attach the
     * appropriate `transitionInterpolator` and `transitionDuration` to `state`
     * before calling this method.
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
     * Clamp longitude and latitude to `_maxBounds` if set. Applied inside
     * `onViewStateChange` to constrain user-driven pan gestures.
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
     * Push the current layer registry to deck.gl. Called after any mutation
     * to `_layers` so the GPU render state stays in sync.
     */
    private _syncLayers(): void {
        this._deckSetProps({ layers: [...this._layers.values()] })
    }

    /**
     * Re-order the layer Map by ascending z-index so `_syncLayers` sends them
     * in the correct draw order (lower z-index = rendered first = behind).
     */
    private _sortLayersByZIndex(): void {
        const entries = [...this._layers.entries()].sort(
            ([aId], [bId]) => (this._layerZIndices.get(aId) ?? 0) - (this._layerZIndices.get(bId) ?? 0)
        )
        this._layers = new Map(entries)
    }

    /**
     * Call `deck.setProps` with a partial props object. The cast is scoped
     * here so the rest of the adapter works with concrete types.
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
}

export default DeckGLAdapter
