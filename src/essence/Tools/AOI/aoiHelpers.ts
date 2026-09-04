/**
 * AOI plugin — pure helpers.
 *
 * No MMGIS imports, no DOM mutation, no network. Inputs in, values out.
 * The MMGIS wrapper (AOITool.js) calls these; the React component never does.
 */

import type { Feature, FeatureCollection, Geometry } from 'geojson'
import shp from 'shpjs'

export type BoundaryKind = 'state' | 'county' | 'city'

export interface AOISearchEntry {
    id: string
    label: string
    kind: BoundaryKind
    feature: Feature
}

export function buildSearchIndex(input: {
    states?: FeatureCollection | null
    counties?: FeatureCollection | null
    cities?: FeatureCollection | null
}): AOISearchEntry[] {
    const out: AOISearchEntry[] = []
    const push = (kind: BoundaryKind, fc?: FeatureCollection | null) => {
        if (!fc || !Array.isArray(fc.features)) return
        fc.features.forEach((f, i) => {
            const props = (f.properties ?? {}) as Record<string, unknown>
            const label =
                (props.name as string) ||
                (props.NAME as string) ||
                (props.title as string) ||
                `Unnamed ${kind} ${i + 1}`
            const id = (props.id as string) || `${kind}-${i}-${slug(label)}`
            out.push({ id, label, kind, feature: f })
        })
    }
    push('state', input.states)
    push('county', input.counties)
    push('city', input.cities)
    return out
}

export function searchIndex(
    query: string,
    entries: AOISearchEntry[],
    limit = 8
): AOISearchEntry[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: AOISearchEntry[] = []
    for (const e of entries) {
        if (e.label.toLowerCase().includes(q)) {
            out.push(e)
            if (out.length >= limit) break
        }
    }
    return out
}

export interface ParseResult {
    feature: Feature | null
    error?: string
}

export function parseGeoJSONText(text: string): ParseResult {
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        return { feature: null, error: 'Not valid JSON.' }
    }
    if (!json || typeof json !== 'object') {
        return { feature: null, error: 'Not a GeoJSON object.' }
    }
    const obj = json as { type?: string; features?: unknown }
    if (obj.type === 'FeatureCollection') {
        const features = Array.isArray(obj.features) ? (obj.features as Feature[]) : []
        const first = features.find(isPolygonal)
        if (!first) {
            return { feature: null, error: 'No polygonal feature found.' }
        }
        return { feature: first }
    }
    if (obj.type === 'Feature') {
        const f = obj as unknown as Feature
        if (!isPolygonal(f)) {
            return { feature: null, error: 'Feature must be a Polygon or MultiPolygon.' }
        }
        return { feature: f }
    }
    return { feature: null, error: 'Top-level type must be Feature or FeatureCollection.' }
}

export async function parseShapefileBuffer(buffer: ArrayBuffer): Promise<ParseResult> {
    try {
        const result = (await shp(buffer)) as
            | FeatureCollection
            | FeatureCollection[]
        const fcs = Array.isArray(result) ? result : [result]
        for (const fc of fcs) {
            if (!fc || !Array.isArray(fc.features)) continue
            const first = fc.features.find(isPolygonal)
            if (first) {
                const props = (first.properties ?? {}) as Record<string, unknown>
                const name =
                    (props.name as string) ||
                    (props.NAME as string) ||
                    (props.title as string) ||
                    'Uploaded shapefile'
                return {
                    feature: {
                        ...first,
                        properties: { ...props, name, source: 'shapefile' },
                    },
                }
            }
        }
        return { feature: null, error: 'No polygonal feature in shapefile.' }
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not parse shapefile.'
        return { feature: null, error: msg }
    }
}

export function parseKMLText(text: string): ParseResult {
    let doc: Document
    try {
        doc = new DOMParser().parseFromString(text, 'application/xml')
    } catch {
        return { feature: null, error: 'Could not read KML.' }
    }
    if (doc.getElementsByTagName('parsererror').length > 0) {
        return { feature: null, error: 'Malformed XML in KML.' }
    }

    const placemarks = Array.from(doc.getElementsByTagName('Placemark'))
    if (placemarks.length === 0) {
        return { feature: null, error: 'No <Placemark> elements found.' }
    }

    for (const pm of placemarks) {
        const geometry = readKmlGeometry(pm)
        if (!geometry) continue
        if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue
        const name = textOf(pm, 'name') || 'Uploaded area'
        const feature: Feature = {
            type: 'Feature',
            properties: { name, source: 'kml' },
            geometry,
        }
        return { feature }
    }

    return { feature: null, error: 'No polygonal Placemark found.' }
}

function readKmlGeometry(pm: Element): Geometry | null {
    const polygons = Array.from(pm.getElementsByTagName('Polygon'))
        .map(parseKmlPolygon)
        .filter((c): c is number[][][] => !!c)
    if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] }
    if (polygons.length > 1) return { type: 'MultiPolygon', coordinates: polygons }
    return null
}

function parseKmlPolygon(poly: Element): number[][][] | null {
    const outer = poly.getElementsByTagName('outerBoundaryIs')[0]
    if (!outer) return null
    const outerCoords = readCoordinates(outer)
    if (!outerCoords) return null
    const rings: number[][][] = [outerCoords]
    Array.from(poly.getElementsByTagName('innerBoundaryIs')).forEach((inner) => {
        const c = readCoordinates(inner)
        if (c) rings.push(c)
    })
    return rings
}

function readCoordinates(el: Element): number[][] | null {
    const node = el.getElementsByTagName('coordinates')[0]
    if (!node || !node.textContent) return null
    const pairs = node.textContent.trim().split(/\s+/)
    const out: number[][] = []
    for (const p of pairs) {
        const parts = p.split(',').map((n) => Number(n))
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
            out.push([parts[0], parts[1]])
        }
    }
    return out.length >= 3 ? out : null
}

function textOf(el: Element, tag: string): string | null {
    const node = el.getElementsByTagName(tag)[0]
    return node?.textContent?.trim() || null
}

/**
 * A geometry as a list of vertex lists — rings for the polygons, the line
 * itself for the linestrings, a one-vertex list for a point. The centroid and
 * the bounds both read a selection through this, so the two agree on which
 * geometries a selection can be made of.
 */
function vertexParts(g: Geometry | null | undefined): number[][][] | null {
    if (!g) return null
    if (g.type === 'Point') return [[g.coordinates as number[]]]
    if (g.type === 'Polygon') return g.coordinates as number[][][]
    if (g.type === 'MultiPolygon')
        return (g.coordinates as number[][][][]).flat() as number[][][]
    if (g.type === 'LineString') return [g.coordinates as number[][]]
    if (g.type === 'MultiLineString') return g.coordinates as number[][][]
    return null
}

/** The unweighted mean of a selection's vertices. */
export function featureCentroid(f: Feature): [number, number] | null {
    const parts = vertexParts(f.geometry)
    if (!parts) return null

    let sx = 0
    let sy = 0
    let n = 0
    for (const part of parts) {
        // A closed ring repeats its first vertex as its last; count it once.
        const last = part.length - 1
        const stopAt =
            part.length > 1 &&
            part[0][0] === part[last][0] &&
            part[0][1] === part[last][1]
                ? last
                : part.length
        for (let i = 0; i < stopAt; i++) {
            sx += part[i][0]
            sy += part[i][1]
            n++
        }
    }
    return n > 0 ? [sx / n, sy / n] : null
}

/**
 * The west/south/east/north envelope of a selection's vertices. A point, and a
 * line with no width or no height, give a degenerate box — too thin for
 * {@link selectionFitBounds} to frame, which leaves the camera where it is and
 * the popup anchored against the view it can still see.
 */
export function featureBounds(f: Feature): [number, number, number, number] | null {
    const parts = vertexParts(f.geometry)
    if (!parts) return null
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let n = -Infinity
    for (const part of parts) {
        for (const [x, y] of part) {
            if (x < w) w = x
            if (y < s) s = y
            if (x > e) e = x
            if (y > n) n = y
        }
    }
    return Number.isFinite(w) ? [w, s, e, n] : null
}

/**
 * A map view as the engines report it back from `map:getBounds`. Latitude
 * always runs south to north.
 *
 * Longitude does not. Every engine that answers this request — Leaflet,
 * deck.gl drawn over a basemap, and standalone deck.gl, which takes the
 * min/max envelope of its container corners — reports longitudes unwrapped and
 * west to east. Two things follow:
 *
 * - A view straddling the antimeridian is written by running past ±180, as
 *   170..190.
 * - Standalone deck.gl, zoomed out, can report a window wider than a full
 *   360° turn.
 */
export interface ViewBounds {
    southWest: { lat: number; lng: number }
    northEast: { lat: number; lng: number }
}

/** Folds a longitude difference into [0, 360). */
function wrap360(d: number): number {
    return ((d % 360) + 360) % 360
}

/**
 * How wide a view is in degrees of longitude, measured east from its west
 * edge.
 *
 * An engine may report a view that straddles the antimeridian either way: as
 * `sw.lng` 170 with `ne.lng` -170, or, after panning, as 190..210. Both
 * describe the same 20° window.
 *
 * The two corner longitudes are never put back in order here. `sw.lng >
 * ne.lng` is how a straddling view is written, so swapping them would change
 * which window is meant.
 */
function viewLngExtent(view: ViewBounds): number {
    const raw = view.northEast.lng - view.southWest.lng
    return raw > 0 ? raw : wrap360(raw)
}

/** How many degrees east of the view's west edge a longitude sits, in [0, 360). */
function lngOffset(lng: number, view: ViewBounds): number {
    return wrap360(lng - view.southWest.lng)
}

/**
 * Decide whether committing a selection should move the camera.
 *
 * Returns null — meaning leave the camera where it is — in two cases:
 *
 * - The selection's bbox already fits inside the current view.
 * - The bbox cannot be framed: it has zero area, or it is 180° or more of
 *   longitude wide.
 *
 * That 180° rule is blunt on purpose. It drops any selection spanning half the
 * globe, not only the naive antimeridian sweeps that motivate it (Alaska's
 * MultiPolygon reads ~359° wide). For both, doing nothing beats jumping out to
 * a view of nearly the whole world.
 *
 * Otherwise it returns a `map:fitBounds` payload that frames the selection as
 * tightly as it can: a small padding, and a maxZoom ceiling set high enough
 * that an ordinary selection never reaches it.
 */
export function selectionFitBounds(
    bbox: [number, number, number, number],
    view: ViewBounds | null | undefined
): {
    bounds: [{ lat: number; lng: number }, { lat: number; lng: number }]
    options: { padding: number; maxZoom: number }
} | null {
    const [w, s, e, n] = bbox
    if (e - w <= 0 || n - s <= 0 || e - w >= 180) return null
    if (view) {
        const extent = viewLngExtent(view)
        // A view at least a full turn wide already shows every longitude, so
        // nothing can sit outside it east-west. Measuring such a view instead
        // would put a seam in it: offsets fold into [0, 360), so a selection a
        // full turn east of the west edge reads as an offset of ~355 and looks
        // like it overflows.
        const inLng = extent >= 360 || lngOffset(w, view) + (e - w) <= extent
        const inLat = s >= view.southWest.lat && n <= view.northEast.lat
        if (inLng && inLat) return null
    }
    return {
        bounds: [
            { lat: s, lng: w },
            { lat: n, lng: e },
        ],
        options: { padding: 40, maxZoom: 18 },
    }
}

/**
 * Pick where to anchor the selection's popup card. The card holds the only
 * Analyze and Cancel buttons a selection has, so mounting it off-screen
 * strands the selection.
 *
 * That is a risk whenever the camera stays put: the selection was already in
 * view, or its extent could not be framed (a zero-area polygon, or Alaska's
 * naive ~360° sweep, whose vertex-mean centroid lands near -140°). In those
 * cases the centroid can sit outside the current view, so fall back to the
 * centre of the view.
 *
 * Pass no view once the camera has been fitted to the selection — the centroid
 * is on-screen by then.
 */
export function selectionPopupAnchor(
    centroid: { lat: number; lng: number },
    view?: ViewBounds | null
): { lat: number; lng: number } {
    if (!view) return centroid
    const extent = viewLngExtent(view)
    // A single point needs no allowance for width, and an offset is always
    // under 360, so a view wider than a full turn already contains every
    // longitude here — without the explicit full-turn case
    // `selectionFitBounds` needs.
    const inView =
        lngOffset(centroid.lng, view) <= extent &&
        centroid.lat >= view.southWest.lat &&
        centroid.lat <= view.northEast.lat
    if (inView) return centroid
    return {
        lat: (view.southWest.lat + view.northEast.lat) / 2,
        // A view reported wider than a full turn still centres on its own
        // middle rather than on its west edge plus 180°.
        lng: view.southWest.lng + extent / 2,
    }
}

function isPolygonal(f: Feature | undefined | null): f is Feature {
    return (
        !!f &&
        f.type === 'Feature' &&
        !!f.geometry &&
        (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    )
}

export function slug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
