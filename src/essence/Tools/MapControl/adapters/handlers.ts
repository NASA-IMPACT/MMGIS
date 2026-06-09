// MapControl actions, each translating a lib callback into event-bus calls.
// MMGIS-coupled — stays in MMGIS.
import { mmgisOn, mmgisRequest } from './mmgisAPI'
import type {
    BasemapStyle,
    ContainerPoint,
    GeocodeResult,
    LatLng,
    MapOverlayOpts,
    MapSubscribeHandlers,
} from '../lib'

const SEARCH_OVERLAY_ID = 'plugin:mapcontrol:search'
const MAP_CURSOR_IDS = ['mapScreen', 'map']

export const selectBasemap = (style: BasemapStyle): void => {
    void mmgisRequest('map:setBasemap', style.name)
}

export const zoomIn = (): void => {
    void mmgisRequest('map:zoomIn')
}

export const zoomOut = (): void => {
    void mmgisRequest('map:zoomOut')
}

/** Subscribe to map click/move; returns an unsubscribe fn. */
export const subscribeToMap = (handlers: MapSubscribeHandlers): (() => void) => {
    const offClick = mmgisOn('map:click', (e) => handlers.onClick(e as LatLng))
    const offMove = mmgisOn('map:mousemove', (e) => handlers.onMouseMove(e as LatLng))
    return () => {
        offClick()
        offMove()
    }
}

/** Draw an ephemeral vector overlay (measure line). map:createLayer is provided by #90. */
export const drawOverlay = (opts: MapOverlayOpts): void => {
    void mmgisRequest('map:createLayer', {
        id: opts.id,
        type: 'vector',
        geojson: opts.geojson,
        style: opts.style,
        interactive: false,
    })
}

export const removeOverlay = (id: string): void => {
    void mmgisRequest('map:removeLayer', { id })
}

export const projectLatLng = async (latlng: LatLng): Promise<ContainerPoint | null> => {
    return (await mmgisRequest<ContainerPoint>('map:latLngToContainerPoint', latlng)) ?? null
}

/** Set the cursor on the live map canvas (DOM, not bus). */
export const setCursor = (cursor: string): void => {
    for (const id of MAP_CURSOR_IDS) {
        const el = document.getElementById(id)
        if (el) {
            el.style.cursor = cursor
            return
        }
    }
}

/** Fly to a geocode result and drop a pin overlay. */
export const flyToResult = (result: GeocodeResult): void => {
    // Nominatim bbox: [min_lat, max_lat, min_lon, max_lon]
    // map:fitBounds expects [[south, west], [north, east]]
    void mmgisRequest('map:fitBounds', [
        [result.bbox[0], result.bbox[2]],
        [result.bbox[1], result.bbox[3]],
    ])
    void mmgisRequest('map:createLayer', {
        id: SEARCH_OVERLAY_ID,
        type: 'vector',
        interactive: false,
        geojson: {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [result.lng, result.lat] },
                    properties: {},
                },
            ],
        },
        style: { color: '#005ea2', fillColor: '#005ea2', fillOpacity: 0.85, radius: 7, weight: 2 },
    })
}
