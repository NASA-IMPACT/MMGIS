/**
 * Pure utility functions and the shared DeckViewState type used by
 * DeckGLAdapter. Nothing here depends on class state.
 */

import {
    WebMercatorViewport,
    type Layer,
    type PickingInfo,
    type TransitionInterpolator,
} from '@deck.gl/core'
import { GeoJsonLayer, BitmapLayer, PointCloudLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'

import type { LatLng, LatLngLike, BoundsLike, PointLike, PaddingLike } from '../types/geometry'
import type { LayerOptions, TileLayerOptions, GeoJSONLayerOptions, PointCloudLayerOptions } from '../types/layers'
import type { FeaturePickResult } from '../types/events'

/**
 * View state shape for deck.gl's WebMercatorView.
 */
export interface DeckViewState {
    longitude: number
    latitude: number
    zoom: number
    bearing: number
    pitch: number
    minZoom?: number
    maxZoom?: number
    transitionDuration?: number | 'auto'
    transitionInterpolator?: TransitionInterpolator
}

/** Normalises LatLngLike to {lat, lng}. Tuples are treated as Leaflet order [lat, lng]. */
export function resolveLatLng(latLng: LatLngLike): LatLng {
    if (Array.isArray(latLng)) {
        return { lat: latLng[0], lng: latLng[1] }
    }
    return latLng as LatLng
}

/** Converts BoundsLike to [[west, south], [east, north]] for WebMercatorViewport.fitBounds. */
export function resolveBounds(bounds: BoundsLike): [[number, number], [number, number]] {
    if (Array.isArray(bounds)) {
        const sw = resolveLatLng(bounds[0])
        const ne = resolveLatLng(bounds[1])
        return [[sw.lng, sw.lat], [ne.lng, ne.lat]]
    }
    const sw = resolveLatLng(bounds.southWest)
    const ne = resolveLatLng(bounds.northEast)
    return [[sw.lng, sw.lat], [ne.lng, ne.lat]]
}

/** Normalises PointLike to {x, y}. */
export function resolvePoint(point: PointLike): { x: number; y: number } {
    if (Array.isArray(point)) return { x: point[0], y: point[1] }
    return point as { x: number; y: number }
}

/** Normalises PaddingLike to a value accepted by WebMercatorViewport.fitBounds. */
export function resolvePadding(
    padding?: PaddingLike
): number | { top: number; right: number; bottom: number; left: number } {
    if (!padding) return 0
    if (typeof padding === 'number') return padding
    if (Array.isArray(padding)) {
        const [top, right, bottom, left] = padding
        return { top, right, bottom, left }
    }
    return padding
}

/**
 * Builds a WebMercatorViewport from the given state and container size.
 * Pass `zoom` to override `state.zoom`.
 */
export function makeViewport(
    state: DeckViewState,
    container: HTMLElement,
    zoom?: number
): WebMercatorViewport {
    return new WebMercatorViewport({
        width: container.offsetWidth,
        height: container.offsetHeight,
        longitude: state.longitude,
        latitude: state.latitude,
        zoom: zoom ?? state.zoom,
        bearing: state.bearing,
        pitch: state.pitch,
    })
}

/**
 * Resolve a layer reference (layer object or string id) to its string id.
 */
export function resolveLayerId(layer: Layer | string): string {
    return typeof layer === 'string' ? layer : layer.id
}

/**
 * Convert a deck.gl PickingInfo object to the engine-agnostic
 * {@link FeaturePickResult} shape.
 */
export function pickInfoToResult(info: PickingInfo): FeaturePickResult {
    if (!info.picked) {
        return { feature: null }
    }
    const [lng, lat] = (info.coordinate as [number, number]) ?? [0, 0]
    return {
        feature: (info.object as Record<string, unknown>) ?? null,
        layerId: info.layer?.id,
        latlng: { lat, lng },
        pixel: { x: info.x, y: info.y },
    }
}

/**
 * Construct a deck.gl layer from a {@link LayerOptions} spec.
 * Supports `'tile'` (TileLayer + BitmapLayer), `'vector'` (GeoJsonLayer),
 * and `'pointcloud'` (PointCloudLayer).
 * Use `nativeOptions` on the layer options for deck.gl-specific props.
 *
 * @throws {Error} If `options.type` is not a supported layer type.
 */
/**
 * Coerce a color input into deck.gl's [r, g, b, a] (0–255) format.
 *
 * Accepts:
 *   - already-RGBA arrays like [26, 115, 232, 255] — passed through, alpha defaults to 255
 *   - CSS hex strings: `#rgb`, `#rrggbb`, `#rrggbbaa`
 *   - anything else → `fallback`
 *
 * This lets callers pass Leaflet-flavoured style (`color: '#1a73e8'`) without
 * having to know deck.gl's native RGBA expectation.
 */
function _toRgba(
    input: unknown,
    fallback: [number, number, number, number]
): [number, number, number, number] {
    if (Array.isArray(input) && input.length >= 3) {
        const [r, g, b, a] = input as number[]
        return [r, g, b, a ?? 255]
    }
    if (typeof input === 'string') {
        let s = input.trim()
        if (s.startsWith('#')) s = s.slice(1)
        if (s.length === 3) s = s.split('').map((c) => c + c).join('')
        if (s.length === 6 || s.length === 8) {
            const r = parseInt(s.slice(0, 2), 16)
            const g = parseInt(s.slice(2, 4), 16)
            const b = parseInt(s.slice(4, 6), 16)
            const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r, g, b, a]
        }
    }
    return fallback
}

export function buildDeckLayer(id: string, options: LayerOptions): Layer {
    switch (options.type) {
        case 'tile': {
            const o = options as TileLayerOptions
            return new TileLayer({
                id,
                data: o.url,
                tileSize: o.tileSize ?? 256,
                minZoom: o.minZoom,
                maxZoom: o.maxNativeZoom ?? o.maxZoom,
                opacity: o.opacity ?? 1,
                renderSubLayers: (props: Record<string, unknown>) => {
                    const bbox = (props.tile as { bbox: { west: number; south: number; east: number; north: number } }).bbox
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    return new BitmapLayer({
                        ...(props as object),
                        data: undefined,
                        image: props.data as string,
                        bounds: [bbox.west, bbox.south, bbox.east, bbox.north] as [number, number, number, number],
                    } as any)
                },
                ...(o.nativeOptions ?? {}),
            }) as unknown as Layer
        }

        case 'vector': {
            const o = options as GeoJSONLayerOptions
            const style =
                o.style && typeof o.style === 'object' && !Array.isArray(o.style)
                    ? (o.style as Record<string, unknown>)
                    : {}

            // Accept either deck.gl-native style keys (strokeColor, strokeWidth)
            // or Leaflet-style keys (color, weight, fillColor, fillOpacity,
            // radius). Deck.gl-native wins when both are provided so existing
            // callers aren't broken.
            const lineColor = _toRgba(style.strokeColor ?? style.color, [0, 0, 0, 255])
            const lineWidth = (style.strokeWidth as number) ?? (style.weight as number) ?? 1

            const baseFill = _toRgba(style.fillColor, [0, 0, 255, 128])
            const fillAlpha =
                typeof style.fillOpacity === 'number'
                    ? Math.round(Math.max(0, Math.min(1, style.fillOpacity as number)) * 255)
                    : baseFill[3]
            const fillColor: [number, number, number, number] = [
                baseFill[0], baseFill[1], baseFill[2], fillAlpha,
            ]

            return new GeoJsonLayer({
                id,
                data: o.geojson as unknown as ConstructorParameters<typeof GeoJsonLayer>[0]['data'],
                opacity: o.opacity ?? 1,
                filled: o.filled ?? true,
                stroked: o.stroked ?? true,
                extruded: o.extruded ?? false,
                getFillColor: fillColor,
                getLineColor: lineColor,
                getLineWidth: lineWidth,
                // Point features need an explicit radius accessor. Without it,
                // deck.gl's default renders circles in meters (sub-pixel at most
                // real-world zooms — effectively invisible).
                getPointRadius: (style.radius as number) ?? 5,
                pointRadiusUnits: 'pixels',
                pointType: o.pointType ?? 'circle',
                lineWidthUnits: o.lineWidthUnits ?? 'pixels',
                pickable: o.interactive ?? true,
                ...(o.nativeOptions ?? {}),
            }) as unknown as Layer
        }

        case 'pointcloud': {
            const o = options as PointCloudLayerOptions
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return new PointCloudLayer({
                id,
                data: o.data ?? o.url,
                pointSize: o.pointSize ?? 2,
                sizeUnits: o.sizeUnits ?? 'pixels',
                opacity: o.opacity ?? 1,
                pickable: o.interactive ?? true,
                loaders: o.loaders,
                ...(o.coordinateOrigin !== undefined ? { coordinateOrigin: o.coordinateOrigin } : {}),
                ...(o.material !== undefined ? { material: o.material } : {}),
                ...(o.nativeOptions ?? {}),
            } as any) as unknown as Layer
        }

        default:
            throw new Error(
                `buildDeckLayer: unsupported layer type "${options.type}". ` +
                    `Supported types: 'tile', 'vector', 'pointcloud'.`
            )
    }
}
