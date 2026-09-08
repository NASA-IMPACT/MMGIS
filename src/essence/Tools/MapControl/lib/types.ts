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

// The action button's icon: `src` is a URL the browser can fetch as given,
// `className` a finished class attribute rather than an icon name.
export type ActionIcon =
    | { kind: 'image'; src: string }
    | { kind: 'mdi'; className: string }

/** Pixel point relative to the map container. */
