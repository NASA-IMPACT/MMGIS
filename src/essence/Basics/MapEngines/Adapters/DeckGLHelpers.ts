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
// _WMSLayer is experimental (underscore prefix): deck.gl gives no semver
// guarantee, so re-verify WMS rendering on every deck.gl upgrade. It also
// behaves unlike the tile layers — one whole-viewport GetMap request per view
// change instead of per-tile fetches.
import { TileLayer, Tile3DLayer, MVTLayer, _WMSLayer as WMSLayer } from '@deck.gl/geo-layers'
import { Tiles3DLoader } from '@loaders.gl/3d-tiles'
// Transitive dep of @deck.gl/geo-layers (same experimental WMS family as
// _WMSLayer) — import the same (hoisted) copy the WMSLayer uses so its
// `data instanceof ImageSource` check holds.
import { WMSImageSource } from '@loaders.gl/wms'
import { color as parseColor } from 'd3'

import type { LatLng, LatLngLike, BoundsLike, PointLike, PaddingLike } from '../types/geometry'
import type { LayerOptions, TileLayerOptions, GeoJSONLayerOptions, VectorTileLayerOptions, PointCloudLayerOptions } from '../types/layers'
import type { FeaturePickResult } from '../types/events'
import { toCanonicalLayerType } from '../types/engine'

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
 * Parse any CSS color string (hex `#RGB`, `#RRGGBB`, `#RRGGBBAA`, named colors,
 * `rgb(...)`, etc.) and an optional opacity (0-1) into a deck.gl RGBA tuple [r, g, b, a].
 * `opacity` overrides any alpha embedded in the color string.
 * Falls back to `defaultColor` on any parse failure.
 * Uses d3-color for parsing so all CSS Color Level 4 formats are supported.
 */
export function hexToRgba(
    hex: string | undefined | null,
    opacity?: number,
    defaultColor: [number, number, number, number] = [255, 255, 255, 255]
): [number, number, number, number] {
    if (!hex || typeof hex !== 'string') return applyOpacity(defaultColor, opacity)
    const parsed = parseColor(hex)
    if (!parsed) return applyOpacity(defaultColor, opacity)
    const { r, g, b, opacity: a } = parsed.rgb()
    if (isNaN(r) || isNaN(g) || isNaN(b)) return applyOpacity(defaultColor, opacity)
    const alpha = Math.round((a ?? 1) * 255)
    return applyOpacity([Math.round(r), Math.round(g), Math.round(b), alpha], opacity)
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
    const coordinate = info.coordinate as [number, number] | undefined
    return {
        feature: (info.object as Record<string, unknown>) ?? null,
        layerId: info.layer?.id,
        ...(coordinate
            ? { latlng: { lat: coordinate[1], lng: coordinate[0] } }
            : {}),
        pixel: { x: info.x, y: info.y },
    }
}

/**
 * Reads a nested value from a GeoJSON feature or plain object by dot-notation path.
 * Checks `.properties` first, then the object itself.
 * @param object - GeoJSON feature or plain data record.
 * @param path - Dot-notation key path, e.g. `"meta.score"`.
 */
function getPropValue(object: unknown, path: string | undefined): unknown {
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

/**
 * Split a full WMS url into its service endpoint and LAYERS list. Mirrors the
 * param parsing Leaflet's WMSColorFilter does, so a single layer url renders
 * the same way in both engines.
 */
// Per-request params the engine computes per viewport (or props we set
// explicitly) — forwarding stale pasted values would corrupt every request.
// TILED is a GeoServer cache directive expecting grid-aligned tile requests;
// WMSLayer issues one whole-viewport GetMap, which a cache grid rejects.
const WMS_MANAGED_KEYS = new Set([
    'service',
    'request',
    'layers',
    'bbox',
    'width',
    'height',
    'srs',
    'crs',
    'tiled',
])
// Standard GetMap params loaders.gl accepts as typed wmsParameters (it handles
// version-specific encoding itself, e.g. SRS= for 1.1.1 vs CRS= for 1.3.0).
const WMS_STANDARD_KEYS = new Set([
    'version',
    'format',
    'transparent',
    'styles',
    'time',
    'elevation',
])

// The base URL must be split from its query string: loaders.gl appends
// '?SERVICE=WMS&...' to it blindly, so a leftover '?' would malform every
// request. LAYERS becomes the layers prop; recognized GetMap params become
// wmsParameters; everything else (API keys, vendor params) is preserved as
// vendorParameters.
function parseWmsUrl(url: string): {
    base: string
    layers: string[]
    wmsParameters: Record<string, unknown>
    vendorParameters: Record<string, unknown>
} {
    const qIdx = url.indexOf('?')
    const base = qIdx === -1 ? url : url.slice(0, qIdx)
    const search = qIdx === -1 ? '' : url.slice(qIdx + 1)
    let layersVal = ''
    const wmsParameters: Record<string, unknown> = {}
    const vendorParameters: Record<string, unknown> = {}
    for (const [key, val] of new URLSearchParams(search)) {
        const lower = key.toLowerCase()
        if (lower === 'layers') {
            layersVal = val
        } else if (WMS_STANDARD_KEYS.has(lower)) {
            wmsParameters[lower] = lower === 'transparent' ? val.toLowerCase() === 'true' : val
        } else if (!WMS_MANAGED_KEYS.has(lower)) {
            vendorParameters[key] = val
        }
    }
    const layers = layersVal ? layersVal.split(',').filter(Boolean) : []
    return { base, layers, wmsParameters, vendorParameters }
}

/**
 * Construct a deck.gl layer from a {@link LayerOptions} spec.
 * Supports `'tile'` (TileLayer + BitmapLayer, or WMSLayer when tileformat is
 * 'wms'), `'vector'` (GeoJsonLayer), and `'pointcloud'` (PointCloudLayer).
 * DeckGL class names (e.g. `'GeoJsonLayer'`) are automatically normalised
 * via {@link toCanonicalLayerType}. Use `nativeOptions` for deck.gl-specific props.
 *
 * @throws {Error} If `options.type` is not a supported layer type.
 */
export function buildDeckLayer(id: string, options: LayerOptions): Layer {
    const resolvedType = toCanonicalLayerType(options.type)
    switch (resolvedType) {
        case 'tile': {
            const o = options as TileLayerOptions
            const tileElevation = Number(o.tileElevation)

            // WMS can't be a {z}/{x}/{y} template — the GetMap BBOX is computed
            // per view. Route to deck.gl's WMSLayer, parsing the service URL and
            // LAYERS out of the full WMS url (same params Leaflet reads).
            if (o.tileformat === 'wms') {
                const { base, layers, wmsParameters, vendorParameters } =
                    parseWmsUrl(o.url)
                return new WMSLayer({
                    id,
                    // A pre-built source (instead of the base-URL string) is the
                    // only channel WMSLayer offers for forwarding the pasted
                    // URL's GetMap/vendor params on every request.
                    data: new WMSImageSource(base, {
                        wms: { wmsParameters, vendorParameters },
                    } as ConstructorParameters<typeof WMSImageSource>[1]),
                    serviceType: 'wms',
                    layers,
                    srs: 'EPSG:3857',
                    opacity: o.opacity ?? 1,
                    ...(o.nativeOptions ?? {}),
                }) as unknown as Layer
            }

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

            const getFillColor =
                fillColorProp || fillOpacityProp
                    ? (feature: Record<string, unknown>) => {
                          const hexVal = fillColorProp
                              ? (getPropValue(feature, fillColorProp) as string | undefined)
                              : undefined
                          const alphaVal = fillOpacityProp
                              ? getPropValue(feature, fillOpacityProp)
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
                              ? (getPropValue(feature, colorProp) as string | undefined)
                              : undefined
                          const alphaVal = opacityProp
                              ? getPropValue(feature, opacityProp)
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
                      const v = getPropValue(feature, weightProp)
                      return v !== undefined ? Number(v) : staticLineWidth
                  }
                : staticLineWidth

            const getPointRadius = radiusProp
                ? (feature: Record<string, unknown>) => {
                      const v = getPropValue(feature, radiusProp)
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
                opacity: o.opacity ?? 1,
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

        case 'scatterplot': {
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
                          const value = getPropValue(object, radiusProp)
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

        case 'tile3d': {
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
                `buildDeckLayer: unsupported layer type "${options.type}"` +
                    (resolvedType !== options.type ? ` (resolved to "${resolvedType}")` : '') +
                    `. Supported types: 'tile', 'vector', 'vectortile', 'scatterplot', 'tile3d', 'pointcloud'.`
            )
    }
}

export { buildDeckCOGLayer } from './DeckCOGLayer'
