// Shared domain types for the MapControl library. Framework-agnostic — no MMGIS.

export type LatLng = { lat: number; lng: number }

export type BasemapStyle = { name: string }

/**
 * A named set of basemap layers shown or hidden together. Its state is
 * 'mixed' when some of its layers are on and some off.
 */
export type BasemapGroupState = {
    /** A group's name; a child's is `<parent>/<child>`. */
    id: string
    name: string
    state: 'on' | 'off' | 'mixed'
}

/** A group, with its children when it has them; children do not nest. */
export type BasemapGroup = BasemapGroupState & {
    children?: BasemapGroupState[]
}

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
