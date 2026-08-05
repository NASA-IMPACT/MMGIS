/**
 * AOI plugin — boundary asset discovery + lazy loader.
 *
 * Scans assets/geo-data/{states,counties,cities}/*.geojson at build time via
 * webpack's require.context, lazy-fetches the files on first call to
 * loadBoundaries(). Filename without extension becomes the boundary's name.
 * Adding a new file is zero-config: drop the .geojson into the right folder
 * and rebuild.
 */

import type { Feature, FeatureCollection } from 'geojson'
import { slug } from './aoiHelpers'

declare const require: {
    context: (
        directory: string,
        useSubdirectories: boolean,
        regExp: RegExp
    ) => {
        keys: () => string[]
        (id: string): unknown
    }
}

type BoundaryKind = 'state' | 'county' | 'city'

interface BoundarySource {
    name: string
    url: string
    kind: BoundaryKind
}

export interface LoadedBoundaries {
    states: FeatureCollection
    counties: FeatureCollection
    cities: FeatureCollection
}

let cache: LoadedBoundaries | null = null
let inflight: Promise<LoadedBoundaries> | null = null

export function loadBoundaries(): Promise<LoadedBoundaries> {
    if (cache) return Promise.resolve(cache)
    if (inflight) return inflight

    const sources: BoundarySource[] = [
        ...discover('state'),
        ...discover('county'),
        ...discover('city'),
    ]

    inflight = Promise.all(sources.map(fetchAndNormalize)).then((featuresOrNulls) => {
        const result: LoadedBoundaries = {
            states: emptyFC(),
            counties: emptyFC(),
            cities: emptyFC(),
        }
        const seen = new Set<string>()
        featuresOrNulls.forEach((f) => {
            if (!f) return
            const props = (f.properties ?? {}) as { _aoiKind?: BoundaryKind; id?: string }
            const kind = props._aoiKind
            const dedupKey = `${kind}:${props.id ?? ''}`
            if (seen.has(dedupKey)) return
            seen.add(dedupKey)
            if (kind === 'state') result.states.features.push(f)
            else if (kind === 'county') result.counties.features.push(f)
            else if (kind === 'city') result.cities.features.push(f)
        })
        const total =
            result.states.features.length +
            result.counties.features.length +
            result.cities.features.length
        console.log(
            `[AOI] Loaded ${total} boundaries ` +
                `(states: ${result.states.features.length}, ` +
                `counties: ${result.counties.features.length}, ` +
                `cities: ${result.cities.features.length})`
        )
        cache = result
        inflight = null
        return result
    })
    return inflight
}

function emptyFC(): FeatureCollection {
    return { type: 'FeatureCollection', features: [] }
}

function discover(kind: BoundaryKind): BoundarySource[] {
    try {
        let ctx
        if (kind === 'state') {
            ctx = require.context('./assets/geo-data/states', false, /\.geojson$/)
        } else if (kind === 'county') {
            ctx = require.context('./assets/geo-data/counties', false, /\.geojson$/)
        } else {
            ctx = require.context('./assets/geo-data/cities', false, /\.geojson$/)
        }
        return ctx.keys().map((key) => ({
            name: keyToName(key),
            url: resolveAssetUrl(ctx(key)),
            kind,
        }))
    } catch {
        return []
    }
}

function keyToName(key: string): string {
    const pathWithoutExt = key.replace(/^\.\//, '').replace(/\.geojson$/i, '')
    const basename = pathWithoutExt.split('/').pop() || pathWithoutExt
    return decodeURIComponent(basename)
}

function resolveAssetUrl(value: unknown): string {
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
        const def = (value as { default?: unknown }).default
        if (typeof def === 'string') return def
    }
    return ''
}

async function fetchAndNormalize(src: BoundarySource): Promise<Feature | null> {
    try {
        const res = await fetch(src.url)
        if (!res.ok) return null
        const json = await res.json()
        const feature = extractFeature(json)
        if (!feature) return null
        return {
            ...feature,
            properties: {
                ...(feature.properties ?? {}),
                name: src.name,
                id: `${src.kind}-${slug(src.name)}`,
                _aoiKind: src.kind,
            },
        }
    } catch (err) {
        console.warn(`[AOI] failed to load ${src.kind} "${src.name}"`, err)
        return null
    }
}

function extractFeature(json: unknown): Feature | null {
    if (!json || typeof json !== 'object') return null
    const obj = json as { type?: string; features?: Feature[] }
    if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        return obj.features.find((f) => f && f.geometry) || null
    }
    if (obj.type === 'Feature') {
        return json as Feature
    }
    return null
}
