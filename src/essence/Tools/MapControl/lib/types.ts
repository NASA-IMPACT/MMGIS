// Shared domain types for the MapControl library. Framework-agnostic — no MMGIS.

export type LatLng = { lat: number; lng: number }

export type BasemapStyle = { name: string }

export type GeocodeResult = {
    id: string
    displayName: string
    lat: number
    lng: number
    // Nominatim boundingbox: [min_lat, max_lat, min_lon, max_lon]
    bbox: [number, number, number, number]
}

export type MapOverlayOpts = {
    id: string
    geojson: object
    style: object
}

export type MapSubscribeHandlers = {
    onClick: (e: LatLng) => void
    onMouseMove: (e: LatLng) => void
}

/** Pixel point relative to the map container. */
