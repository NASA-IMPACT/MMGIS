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

/**
 * The action button's icon, reduced to the one thing the bar needs in order to
 * draw it: whether it paints an image or an icon-font glyph.
 *
 * `image` covers both an uploaded file (a mission-relative path from a
 * Configure upload field) and a link to one hosted elsewhere — the bar draws
 * the two the same way, so the distinction ends at the config.
 *
 * `mdi` carries a finished class attribute rather than an icon name. Which
 * spellings a config author may write, and how each maps to a class, belongs
 * to whoever owns the icon stylesheet; by the time an icon reaches the bar
 * that question is settled and the class is put on the element as given.
 */
export type ActionIcon =
    | { kind: 'image'; src: string }
    | { kind: 'mdi'; className: string }

/** Pixel point relative to the map container. */
