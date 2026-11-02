export interface PointValue {
    value: number | null
    band?: string
    item?: string
    asOf?: string
}

export interface FetchPointOptions {
    fetchImpl?: typeof fetch
    timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 20000

// Tile-rendering parameters; a point answer is a number, and some service
// versions refuse them on the point route.
const RENDER_ONLY_PARAMS = new Set([
    'colormap_name',
    'colormap',
    'rescale',
    'color_formula',
    'return_mask',
    'tilesize',
    'tile_scale',
    'buffer',
    'format',
])

const TILE_PATH =
    /\/tiles(?:\/[^/?#]+)?\/\{z\}\/\{x\}\/\{y\}(?:@\d+x)?(?:\.[A-Za-z0-9]+)?(?=[?#]|$)/

const FILE_URL = /\.tiff?(?=[?#]|$)/i

/**
 * The point-query URL for a tile URL, or null when none can be derived.
 *
 * THIS IS A DEDUCTION FROM A CONVENTION, NOT A STANDARD. Pairing
 * `/tiles/{tms}/{z}/{x}/{y}` with `/point/{lon},{lat}`, both routes reading
 * the same query parameters, is how TiTiler's factories are written, and
 * titiler, titiler-pgstac, titiler-multidim/xarray and titiler-cmr all build
 * on them. No OGC rule says so: WMS and WMTS answer a point by GetFeatureInfo
 * on a pixel, OGC API Tiles has no point route, and other tile servers have
 * their own or none. So this covers every TiTiler-family service and nothing
 * else, by design. A tile URL of any other shape gets null, and the layer
 * cannot answer a click.
 *
 * A bare GeoTIFF, which the client-side COG renderer draws from, is asked
 * through TiTiler's `/cog/point` when a TiTiler base is known for the layer.
 */
export function toPointUrl(
    tileUrl: string,
    lng: number,
    lat: number,
    titilerBase?: string | null
): string | null {
    const point = `${lng},${lat}`
    if (TILE_PATH.test(tileUrl)) {
        return dropRenderParams(tileUrl.replace(TILE_PATH, `/point/${point}`))
    }
    if (FILE_URL.test(tileUrl) && titilerBase) {
        const base = titilerBase.replace(/\/$/, '')
        return `${base}/cog/point/${point}?url=${encodeURIComponent(tileUrl)}`
    }
    return null
}

// Split, not parsed: URLSearchParams would re-encode every value, and the
// point request should carry the parameters exactly as the tiles did.
function dropRenderParams(url: string): string {
    const hash = url.indexOf('#')
    const withoutHash = hash === -1 ? url : url.slice(0, hash)
    const q = withoutHash.indexOf('?')
    if (q === -1) return withoutHash
    const kept = withoutHash
        .slice(q + 1)
        .split('&')
        .filter((pair) => pair !== '' && !RENDER_ONLY_PARAMS.has(pair.split('=')[0]))
    const path = withoutHash.slice(0, q)
    return kept.length ? `${path}?${kept.join('&')}` : path
}

// Two answer shapes: a single dataset gives `values: [number|null]`; a
// mosaic gives `[itemId, [values], [bandNames]]` per item, newest first.
export function readPointValue(json: unknown): PointValue | undefined {
    const body = json as {
        values?: unknown[]
        band_names?: unknown[]
        band_descriptions?: unknown[]
    } | null
    if (body == null || typeof body !== 'object' || !Array.isArray(body.values)) {
        return undefined
    }
    const first = body.values[0]
    if (first === undefined || first === null || typeof first === 'number') {
        return withDefined({
            value: typeof first === 'number' ? first : null,
            band: asString(body.band_names?.[0]),
            asOf: asInstant(body.band_descriptions?.[0]),
        })
    }
    if (Array.isArray(first)) {
        for (const entry of body.values) {
            if (!Array.isArray(entry)) continue
            const [item, values, bands] = entry as [unknown, unknown, unknown]
            const value = Array.isArray(values) ? values[0] : undefined
            if (typeof value === 'number') {
                return withDefined({
                    value,
                    item: asString(item),
                    band: Array.isArray(bands) ? asString(bands[0]) : undefined,
                })
            }
        }
        return { value: null }
    }
    return undefined
}

const asString = (v: unknown): string | undefined =>
    typeof v === 'string' && v !== '' ? v : undefined

const asInstant = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined
    const m = v
        .trim()
        .match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/)
    if (!m) return undefined
    return `${m[1]}${m[2] ?? 'Z'}`
}

function withDefined(answer: PointValue): PointValue {
    const out: PointValue = { value: answer.value }
    if (answer.band !== undefined) out.band = answer.band
    if (answer.item !== undefined) out.item = answer.item
    if (answer.asOf !== undefined) out.asOf = answer.asOf
    return out
}

export async function fetchPointValue(
    url: string,
    options: FetchPointOptions = {}
): Promise<PointValue | null> {
    const fetchImpl: typeof fetch =
        options.fetchImpl ?? ((input, init) => fetch(input, init))
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetchImpl(url, { signal: controller.signal })
        if (!response.ok) {
            console.warn(`[Layers] point query ${url} responded ${response.status}.`)
            return null
        }
        const answer = readPointValue(await response.json())
        if (answer === undefined) {
            console.warn(`[Layers] point query ${url} answered in a shape not read.`)
            return null
        }
        return answer
    } catch (err) {
        const reason = controller.signal.aborted
            ? `timed out after ${timeoutMs} ms`
            : `failed (${(err as Error)?.message ?? err})`
        console.warn(`[Layers] point query ${url} ${reason}.`)
        return null
    } finally {
        clearTimeout(timer)
    }
}

// `boundingBox` is `[west, south, east, north]`; no usable box means the
// service decides.
export function boundsContain(boundingBox: unknown, lng: number, lat: number): boolean {
    if (!Array.isArray(boundingBox) || boundingBox.length < 4) return true
    const [w, s, e, n] = boundingBox.map(Number)
    if ([w, s, e, n].some((v) => !Number.isFinite(v))) return true
    return lng >= w && lng <= e && lat >= s && lat <= n
}
