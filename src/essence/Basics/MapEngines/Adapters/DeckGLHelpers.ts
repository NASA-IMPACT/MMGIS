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
import { GeoJsonLayer, BitmapLayer, PointCloudLayer, ScatterplotLayer } from '@deck.gl/layers'
import { TileLayer, Tile3DLayer, MVTLayer } from '@deck.gl/geo-layers'
import { Tiles3DLoader } from '@loaders.gl/3d-tiles'

import type { LatLng, LatLngLike, BoundsLike, PointLike, PaddingLike } from '../types/geometry'
import type { LayerOptions, TileLayerOptions, GeoJSONLayerOptions, VectorTileLayerOptions, PointCloudLayerOptions } from '../types/layers'
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
 * Parse a CSS hex color string (`#RGB`, `#RRGGBB`, `#RRGGBBAA`) and an
 * optional separate opacity (0–1) into a deck.gl RGBA tuple [r, g, b, a].
 * `opacity` overrides any alpha embedded in the hex string.
 * Falls back to `defaultColor` on any parse failure.
 */
export function hexToRgba(
    hex: string | undefined | null,
    opacity?: number,
    defaultColor: [number, number, number, number] = [255, 255, 255, 255]
): [number, number, number, number] {
    if (!hex || typeof hex !== 'string') return applyOpacity(defaultColor, opacity)
    const clean = hex.replace('#', '')
    let r: number, g: number, b: number, a: number

    if (clean.length === 3) {
        r = parseInt(clean[0] + clean[0], 16)
        g = parseInt(clean[1] + clean[1], 16)
        b = parseInt(clean[2] + clean[2], 16)
        a = 255
    } else if (clean.length === 6) {
        r = parseInt(clean.slice(0, 2), 16)
        g = parseInt(clean.slice(2, 4), 16)
        b = parseInt(clean.slice(4, 6), 16)
        a = 255
    } else if (clean.length === 8) {
        r = parseInt(clean.slice(0, 2), 16)
        g = parseInt(clean.slice(2, 4), 16)
        b = parseInt(clean.slice(4, 6), 16)
        a = parseInt(clean.slice(6, 8), 16)
    } else {
        return applyOpacity(defaultColor, opacity)
    }

    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) return applyOpacity(defaultColor, opacity)
    return applyOpacity([r, g, b, a], opacity)
}

function applyOpacity(
    color: [number, number, number, number],
    opacity?: number
): [number, number, number, number] {
    if (opacity === undefined || opacity === null) return color
    return [color[0], color[1], color[2], Math.round(Math.max(0, Math.min(1, opacity)) * 255)]
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
 * Maps DeckGL class names (as stored in legacy layer configs) to the
 * canonical MMGIS type string used by buildDeckLayer's switch.
 * Add entries here when new DeckGL layer types are introduced.
 */
export const DECKGL_TYPE_ALIAS: Record<string, string> = {
    GeoJsonLayer: 'vector',
    ScatterplotLayer: 'ScatterplotLayer',
    PathLayer: 'vector',
    PolygonLayer: 'vector',
    IconLayer: 'vector',
    TextLayer: 'vector',
    TileLayer: 'tile',
    BitmapLayer: 'tile',
    MVTLayer: 'vectortile',
    pointcloud: 'PointCloudLayer',
}

/**
 * Construct a deck.gl layer from a {@link LayerOptions} spec.
 * Supports `'tile'` (TileLayer + BitmapLayer), `'vector'` (GeoJsonLayer),
 * and `'pointcloud'` (PointCloudLayer).
 * DeckGL class names (e.g. `'GeoJsonLayer'`) are automatically normalised
 * via {@link DECKGL_TYPE_ALIAS}. Use `nativeOptions` for deck.gl-specific props.
 *
 * @throws {Error} If `options.type` is not a supported layer type.
 */
export function buildDeckLayer(id: string, options: LayerOptions): Layer {
    const resolvedType = DECKGL_TYPE_ALIAS[options.type ?? ''] ?? options.type
    switch (resolvedType) {
        case 'tile': {
            const o = options as TileLayerOptions
            const tileElevation = Number(o.tileElevation)
            return new TileLayer({
                id,
                data: o.url,
                tileSize: o.tileSize ?? 256,
                minZoom: o.minZoom,
                maxZoom: o.maxNativeZoom ?? o.maxZoom,
                opacity: o.opacity ?? 1,
                renderSubLayers: (props: Record<string, unknown>) => {
                    const bbox = (props.tile as { bbox: { west: number; south: number; east: number; north: number } }).bbox
                    const bounds = Number.isFinite(tileElevation)
                        ? [
                              [bbox.west, bbox.south, tileElevation],
                              [bbox.west, bbox.north, tileElevation],
                              [bbox.east, bbox.north, tileElevation],
                              [bbox.east, bbox.south, tileElevation],
                          ]
                        : [bbox.west, bbox.south, bbox.east, bbox.north]
                    return new BitmapLayer({
                        ...(props as object),
                        data: undefined,
                        image: props.data as string,
                        bounds,
                    } as ConstructorParameters<typeof BitmapLayer>[0])
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

            const staticFillColor = hexToRgba(
                style.fillColor as string | undefined,
                style.fillOpacity !== undefined ? Number(style.fillOpacity) : 0.8,
                [0, 120, 255, 200]
            )
            const staticLineColor = hexToRgba(
                style.color as string | undefined,
                style.opacity !== undefined ? Number(style.opacity) : 1,
                [255, 255, 255, 220]
            )
            const staticLineWidth = style.weight !== undefined ? Number(style.weight) : 1
            const staticPointRadius = style.radius !== undefined ? Number(style.radius) : 6

            const fillColorProp = style.fillColorProp as string | undefined
            const fillOpacityProp = style.fillOpacityProp as string | undefined
            const colorProp = style.colorProp as string | undefined
            const opacityProp = style.opacityProp as string | undefined
            const weightProp = style.weightProp as string | undefined
            const radiusProp = style.radiusProp as string | undefined

            const getProp = (feature: Record<string, unknown>, path: string): unknown => {
                const props =
                    (feature as { properties?: Record<string, unknown> }).properties ?? {}
                return path
                    .split('.')
                    .reduce(
                        (obj: unknown, key) =>
                            obj != null && typeof obj === 'object'
                                ? (obj as Record<string, unknown>)[key]
                                : undefined,
                        props
                    )
            }

            const getFillColor =
                fillColorProp || fillOpacityProp
                    ? (feature: Record<string, unknown>) => {
                          const hexVal = fillColorProp
                              ? (getProp(feature, fillColorProp) as string | undefined)
                              : undefined
                          const alphaVal = fillOpacityProp
                              ? getProp(feature, fillOpacityProp)
                              : undefined
                          if (hexVal === undefined && alphaVal === undefined) return staticFillColor
                          return hexToRgba(
                              hexVal ?? (style.fillColor as string | undefined),
                              alphaVal !== undefined
                                  ? Number(alphaVal)
                                  : style.fillOpacity !== undefined
                                    ? Number(style.fillOpacity)
                                    : 0.8,
                              staticFillColor
                          )
                      }
                    : staticFillColor

            const getLineColor =
                colorProp || opacityProp
                    ? (feature: Record<string, unknown>) => {
                          const hexVal = colorProp
                              ? (getProp(feature, colorProp) as string | undefined)
                              : undefined
                          const alphaVal = opacityProp
                              ? getProp(feature, opacityProp)
                              : undefined
                          if (hexVal === undefined && alphaVal === undefined) return staticLineColor
                          return hexToRgba(
                              hexVal ?? (style.color as string | undefined),
                              alphaVal !== undefined
                                  ? Number(alphaVal)
                                  : style.opacity !== undefined
                                    ? Number(style.opacity)
                                    : 1,
                              staticLineColor
                          )
                      }
                    : staticLineColor

            const getLineWidth = weightProp
                ? (feature: Record<string, unknown>) => {
                      const v = getProp(feature, weightProp)
                      return v !== undefined ? Number(v) : staticLineWidth
                  }
                : staticLineWidth

            const getPointRadius = radiusProp
                ? (feature: Record<string, unknown>) => {
                      const v = getProp(feature, radiusProp)
                      return v !== undefined ? Number(v) : staticPointRadius
                  }
                : staticPointRadius

            const markerIcon = o.variables?.markerIcon
            const iconUrl = markerIcon?.iconUrl
            const iconW = markerIcon?.iconSize?.[0] ?? 32
            const iconH = markerIcon?.iconSize?.[1] ?? 32
            const anchorX = markerIcon?.iconAnchor?.[0] ?? iconW / 2
            const anchorY = markerIcon?.iconAnchor?.[1] ?? iconH / 2

            return new GeoJsonLayer({
                id,
                data: o.geojson as unknown as ConstructorParameters<typeof GeoJsonLayer>[0]['data'],
                filled: o.filled ?? true,
                stroked: o.stroked ?? true,
                extruded: o.extruded ?? false,
                getFillColor,
                getLineColor,
                getLineWidth,
                getPointRadius,
                pointType: iconUrl ? 'icon' : (o.pointType ?? 'circle'),
                lineWidthUnits: o.lineWidthUnits ?? 'pixels',
                pointRadiusUnits: 'pixels',
                pickable: o.interactive ?? true,
                ...(iconUrl
                    ? {
                          getIcon: () => ({
                              url: iconUrl,
                              width: iconW,
                              height: iconH,
                              anchorX,
                              anchorY,
                          }),
                          getIconSize: iconH,
                          iconSizeUnits: 'pixels' as const,
                      }
                    : {}),
                ...(o.nativeOptions ?? {}),
            } as ConstructorParameters<typeof GeoJsonLayer>[0]) as unknown as Layer
        }

        case 'vectortile': {
            const o = options as VectorTileLayerOptions
            const style =
                o.style && typeof o.style === 'object' && !Array.isArray(o.style)
                    ? (o.style as Record<string, unknown>)
                    : {}
            return new MVTLayer({
                id,
                data: o.url,
                minZoom: o.minZoom,
                maxZoom: o.maxNativeZoom ?? o.maxZoom,
                opacity: o.opacity ?? 1,
                pickable: o.interactive ?? true,
                getFillColor: hexToRgba(
                    style.fillColor as string | undefined,
                    style.fillOpacity !== undefined ? Number(style.fillOpacity) : 0.8,
                    [0, 120, 255, 200]
                ),
                getLineColor: hexToRgba(
                    style.color as string | undefined,
                    style.opacity !== undefined ? Number(style.opacity) : 1,
                    [255, 255, 255, 220]
                ),
                getLineWidth: style.weight !== undefined ? Number(style.weight) : 1,
                lineWidthUnits: 'pixels',
                ...(o.nativeOptions ?? {}),
            } as ConstructorParameters<typeof MVTLayer>[0]) as unknown as Layer
        }

        case 'ScatterplotLayer': {
            const o = options as LayerOptions & {
                data?: unknown
                nativeOptions?: Record<string, unknown>
            }
            const style =
                o.style && typeof o.style === 'object' && !Array.isArray(o.style)
                    ? (o.style as Record<string, unknown>)
                    : {}
            const data =
                o.data &&
                typeof o.data === 'object' &&
                !Array.isArray(o.data) &&
                (o.data as { type?: unknown }).type === 'FeatureCollection'
                    ? (o.data as { features?: unknown[] }).features
                    : o.data
            const getProp = (object: unknown, path: string | undefined): unknown => {
                if (!path || object == null || typeof object !== 'object') return undefined
                const source =
                    (object as { properties?: Record<string, unknown> }).properties ??
                    (object as Record<string, unknown>)
                return path
                    .split('.')
                    .reduce(
                        (obj: unknown, key) =>
                            obj != null && typeof obj === 'object'
                                ? (obj as Record<string, unknown>)[key]
                                : undefined,
                        source
                    )
            }
            const getPosition = (object: unknown): [number, number] | [number, number, number] => {
                if (object == null || typeof object !== 'object') return [0, 0]
                const record = object as {
                    coordinates?: unknown
                    position?: unknown
                    geometry?: { coordinates?: unknown }
                }
                const coords = record.coordinates ?? record.position ?? record.geometry?.coordinates
                if (Array.isArray(coords) && coords.length >= 3)
                    return [Number(coords[0]), Number(coords[1]), Number(coords[2])]
                if (Array.isArray(coords) && coords.length >= 2)
                    return [Number(coords[0]), Number(coords[1])]
                return [0, 0]
            }
            const radiusProp = style.radiusProp as string | undefined
            const staticRadius = style.radius !== undefined ? Number(style.radius) : 6

            return new ScatterplotLayer({
                id,
                data: data as ConstructorParameters<typeof ScatterplotLayer>[0]['data'],
                opacity: o.opacity ?? 1,
                pickable: o.interactive ?? true,
                filled: true,
                stroked: style.weight !== undefined ? Number(style.weight) > 0 : true,
                getPosition,
                getRadius: radiusProp
                    ? (object: unknown) => {
                          const value = getProp(object, radiusProp)
                          return value !== undefined ? Number(value) : staticRadius
                      }
                    : staticRadius,
                getFillColor: hexToRgba(
                    style.fillColor as string | undefined,
                    style.fillOpacity !== undefined ? Number(style.fillOpacity) : 0.8,
                    [0, 120, 255, 200]
                ),
                getLineColor: hexToRgba(
                    style.color as string | undefined,
                    style.opacity !== undefined ? Number(style.opacity) : 1,
                    [255, 255, 255, 220]
                ),
                getLineWidth: style.weight !== undefined ? Number(style.weight) : 1,
                radiusUnits: 'pixels',
                lineWidthUnits: 'pixels',
                ...(o.nativeOptions ?? {}),
            } as ConstructorParameters<typeof ScatterplotLayer>[0]) as unknown as Layer
        }

        case 'Tile3DLayer': {
            const o = options as PointCloudLayerOptions
            return new Tile3DLayer({
                id,
                data: o.data ?? o.url,
                loader: Tiles3DLoader,
                opacity: o.opacity ?? 1,
                pickable: o.interactive ?? true,
                pointSize: o.pointSize ?? 2,
                ...(o.nativeOptions ?? {}),
            } as ConstructorParameters<typeof Tile3DLayer>[0]) as unknown as Layer
        }

        case 'PointCloudLayer': {
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
                `buildDeckLayer: unsupported layer type "${options.type}"` +
                    (resolvedType !== options.type ? ` (resolved to "${resolvedType}")` : '') +
                    `. Supported types: 'tile', 'vector', 'pointcloud'.`
            )
    }
}
