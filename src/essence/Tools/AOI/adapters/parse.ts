import type { Feature, FeatureCollection, Geometry } from 'geojson'
import shp from 'shpjs'
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
        const result = (await shp(buffer)) as FeatureCollection | FeatureCollection[]
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

function isPolygonal(f: Feature | undefined | null): f is Feature {
    return (
        !!f &&
        f.type === 'Feature' &&
        !!f.geometry &&
        (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    )
}
