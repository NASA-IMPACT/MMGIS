/**
 * Feature properties that arrive packed into a single JSON string.
 *
 * Vector tiles served from a geodataset carry each feature's properties this
 * way: the geodatasets MVT endpoint selects the stored jsonb `properties`
 * column whole, and an MVT attribute holds only a scalar, so a feature arrives
 * as `{ id, properties: '{"frp": 12, ...}' }`. Anything that reads a property
 * by name — style accessors, colorBy, legend rows, feature ids — has to unpack
 * it first, and every renderer has to unpack it the same way or the same tile
 * styles differently on each engine.
 */

const unpacked = new WeakMap<object, Record<string, unknown>>()

/**
 * A feature's properties, unpacked when they arrive as one JSON string under
 * `properties`.
 *
 * The unpacked object replaces the packed one rather than being merged into
 * it, which is what the Leaflet vector tile path has always done. The result
 * is memoised on the packed object, because a renderer may ask for the same
 * feature's properties once per style accessor.
 *
 * @returns The input itself when there is nothing to unpack, including when
 *   the string is not a JSON object.
 */
export function unpackFeatureProperties<T>(properties: T): T {
    if (properties == null || typeof properties !== 'object') return properties
    const packed = (properties as Record<string, unknown>).properties
    if (typeof packed !== 'string') return properties

    const memo = unpacked.get(properties as object)
    if (memo) return memo as T

    let parsed: unknown
    try {
        parsed = JSON.parse(packed)
    } catch {
        return properties
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
        return properties

    unpacked.set(properties as object, parsed as Record<string, unknown>)
    return parsed as T
}
