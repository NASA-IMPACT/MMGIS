/**
 * A layer's runtime time-extent source: a URL returning JSON plus a path
 * into that JSON for each of the four static data-time fields. Fetched once
 * while the mission's layers load, before any reader sees the layer, and
 * merged onto `layer.time` so every existing reader of `dataStartTime`,
 * `dataEndTime`, `interval` and `dataDates` sees the fetched values without
 * knowing where they came from. The static fields are the fallback for
 * anything the source cannot supply.
 *
 * Pure except for the injected `fetch`; nothing here touches the DOM, an
 * engine or the layer registry.
 */

/**
 * Path grammar, deliberately small: an optional leading `$` or `$.`,
 * dot-separated object keys, `[n]` array indexes and `[*]` for every element
 * of an array, flattened one level. Filters, recursive descent and quoted
 * keys are invalid and match nothing.
 */
const SEGMENT_RE = /^([^.[\]]+)|^\[(\d+|\*)\]/

type Segment = { key: string } | { index: number } | { all: true }

function parsePath(path: string): Segment[] | null {
    let rest = path.trim()
    if (rest.startsWith('$.')) rest = rest.slice(2)
    else if (rest.startsWith('$')) rest = rest.slice(1)
    // A path begins with a key: a bare index or a leading dot has no object
    // to apply to, so `$..a`, `$[0]` and `[0]` are all invalid.
    if (rest === '' || rest.startsWith('[') || rest.startsWith('.')) return null

    const segments: Segment[] = []
    while (rest.length > 0) {
        // A dot separates a key from what precedes it; a dot followed by
        // nothing, another dot or an index is malformed.
        if (rest.startsWith('.')) {
            rest = rest.slice(1)
            if (rest === '' || rest.startsWith('.') || rest.startsWith('['))
                return null
        }
        const m = SEGMENT_RE.exec(rest)
        if (!m) return null
        if (m[1] != null) segments.push({ key: m[1] })
        else if (m[2] === '*') segments.push({ all: true })
        else segments.push({ index: Number(m[2]) })
        rest = rest.slice(m[0].length)
    }
    return segments
}

function step(value: unknown, segment: Segment): unknown {
    if (value == null) return undefined
    if ('all' in segment) {
        return Array.isArray(value) && value.length > 0 ? value : undefined
    }
    if ('index' in segment) {
        return Array.isArray(value) ? value[segment.index] : undefined
    }
    if (typeof value !== 'object' || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[segment.key]
}

/**
 * The value a path names inside `json`, or undefined when the path is
 * invalid or matches nothing. A `[*]` fans out: every later segment is
 * applied to each element, and elements that match nothing are dropped.
 * A fan-out that leaves no elements matches nothing.
 */
export function readPath(json: unknown, path: string): unknown {
    const segments = parsePath(path)
    if (segments == null) return undefined

    let fannedOut = false
    let current: unknown = json
    for (const segment of segments) {
        if (fannedOut) {
            const next = (current as unknown[])
                .map((el) => step(el, segment))
                .filter((v) => v !== undefined)
            if (next.length === 0) return undefined
            current = next
        } else {
            current = step(current, segment)
            if (current === undefined) return undefined
            if ('all' in segment) fannedOut = true
        }
    }
    return current
}
