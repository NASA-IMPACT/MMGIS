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

export function featureCentroid(f: Feature): [number, number] | null {
    const g = f.geometry
    if (!g) return null
    if (g.type === 'Point') {
        const c = g.coordinates as [number, number]
        return [c[0], c[1]]
    }
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const rings: number[][][] =
            g.type === 'Polygon'
                ? (g.coordinates as number[][][])
                : ((g.coordinates as number[][][][]).flat() as number[][][])
        let sx = 0
        let sy = 0
        let n = 0
        for (const ring of rings) {
            const last = ring.length - 1
            const stopAt =
                ring.length > 1 &&
                ring[0][0] === ring[last][0] &&
                ring[0][1] === ring[last][1]
                    ? last
                    : ring.length
            for (let i = 0; i < stopAt; i++) {
                sx += ring[i][0]
                sy += ring[i][1]
                n++
            }
        }
        return n > 0 ? [sx / n, sy / n] : null
    }
    return null
}

export function featureBounds(f: Feature): [number, number, number, number] | null {
    const g = f.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null
    const rings: number[][][] =
        g.type === 'Polygon'
            ? (g.coordinates as number[][][])
            : ((g.coordinates as number[][][][]).flat() as number[][][])
    let w = Infinity
    let s = Infinity
    let e = -Infinity
    let n = -Infinity
    for (const ring of rings) {
        for (const [x, y] of ring) {
            if (x < w) w = x
            if (y < s) s = y
            if (x > e) e = x
            if (y > n) n = y
        }
    }
    return Number.isFinite(w) ? [w, s, e, n] : null
}

export interface ViewBounds {
    southWest: { lat: number; lng: number }
    northEast: { lat: number; lng: number }
}

/** Folds a longitude difference into [0, 360). */
function lngDelta(d: number): number {
    return ((d % 360) + 360) % 360
}

/**
 * Width of a view in degrees of longitude. An engine may report a view that
 * straddles the antimeridian wrapped (`sw.lng` 170, `ne.lng` -170) or unwrapped
 * after panning (190..210); both describe the same 20° window.
 */
function viewLngSpan(view: ViewBounds): number {
    const raw = view.northEast.lng - view.southWest.lng
    return raw > 0 ? Math.min(raw, 360) : lngDelta(raw)
}

/** How many degrees east of the view's west edge a longitude sits, in [0, 360). */
function lngOffset(lng: number, view: ViewBounds): number {
    return lngDelta(lng - view.southWest.lng)
}

/**
 * Decide whether committing a selection needs a camera move. Returns null —
 * leave the camera alone — when the selection's bbox already fits in the
 * current view, or when its extent is unframeable: zero-area, or a naive
 * antimeridian sweep (e.g. Alaska's MultiPolygon spans ~360°) where doing
 * nothing beats jumping to a near-world view. Otherwise returns a
 * `map:fitBounds` payload that fits the selection minimally: small padding,
 * and a maxZoom ceiling high enough to never bind on ordinary selections.
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
        const inLng = lngOffset(w, view) + (e - w) <= viewLngSpan(view)
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
 * Where to anchor the selection tooltip. It carries the only Analyze/Cancel
 * affordance, so when the camera stays put — a selection already in view, or
 * one whose extent is unframeable (a zero-area polygon, or Alaska's ~360°
 * naive sweep, whose vertex-mean centroid lands near -140°) — a centroid
 * outside the current view would mount it off-screen and strand the selection.
 * Fall back to the centre of the view in that case. Pass no view once the
 * camera has been fitted to the selection: the centroid is then on-screen.
 */
export function selectionTooltipAnchor(
    centroid: { lat: number; lng: number },
    view?: ViewBounds | null
): { lat: number; lng: number } {
    if (!view) return centroid
    const inView =
        lngOffset(centroid.lng, view) <= viewLngSpan(view) &&
        centroid.lat >= view.southWest.lat &&
        centroid.lat <= view.northEast.lat
    if (inView) return centroid
    return {
        lat: (view.southWest.lat + view.northEast.lat) / 2,
        lng: view.southWest.lng + viewLngSpan(view) / 2,
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
