// The one shape every colour ramp takes inside the app.
//
// A ramp is a table of 256 RGBA colours, in order: index 0 is the low end of
// the ramp, index 255 the high end, four bytes per colour. It is the shape the
// tiling service publishes at `/colorMaps/{name}`, so a ramp read from the
// service and the same ramp read from the bundle (standardColormaps) are
// interchangeable. The GPU renderer uploads a table as-is; legends and
// swatches read colours straight off it.
//
// This module has no imports, so a Node script can load it directly
// (scripts/colormaps.mjs) without a bundler.

/** Colours in every ramp. */
export const COLORMAP_SIZE = 256

/** 256 RGBA colours, 4 bytes each: `[r0, g0, b0, a0, r1, g1, ...]`. */
export type ColormapTable = Uint8ClampedArray

/** A ramp that could not be read. The message names the ramp. */
export class ColormapFormatError extends Error {
    rampName: string

    constructor(rampName: string, problem: string) {
        super(`Colormap "${rampName}": ${problem}`)
        this.name = 'ColormapFormatError'
        this.rampName = rampName
    }
}

const MAX_DETAIL_LENGTH = 200

/**
 * The message in a tiling service error body, `{"detail": ...}`, or null when
 * `body` is not one. FastAPI services such as TiTiler answer with a string
 * detail, or a list of validation errors each carrying a `msg`. Long messages
 * (an unknown ramp's error lists every valid name) are shortened.
 */
export const describeServiceError = (body: unknown): string | null => {
    if (body == null || typeof body !== 'object' || Array.isArray(body))
        return null
    const detail = (body as Record<string, unknown>).detail
    if (detail == null) return null
    let message: string
    if (typeof detail === 'string') {
        message = detail
    } else if (Array.isArray(detail)) {
        message = detail
            .map((item) =>
                item && typeof item === 'object' && 'msg' in item
                    ? String((item as Record<string, unknown>).msg)
                    : JSON.stringify(item)
            )
            .join('; ')
    } else {
        message = JSON.stringify(detail)
    }
    return message.length > MAX_DETAIL_LENGTH
        ? `${message.slice(0, MAX_DETAIL_LENGTH)}...`
        : message
}

const isChannel = (value: unknown): boolean =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255

/**
 * Reads a `/colorMaps/{name}` response — `{"0": [r, g, b, a], ..., "255":
 * [...]}` — into a table. Throws a ColormapFormatError naming the ramp when
 * the response is anything else, so a malformed ramp is reported rather than
 * painted wrong. A service error body (`{"detail": ...}`) is reported with
 * its detail.
 *
 * Keys are numeric strings whose order in the object is not guaranteed to be
 * ramp order, so each colour is read by its index rather than by position.
 * A colour given as `[r, g, b]` is opaque.
 */
export const colormapResponseToTable = (
    rampName: string,
    response: unknown
): ColormapTable => {
    if (
        response == null ||
        typeof response !== 'object' ||
        Array.isArray(response)
    ) {
        throw new ColormapFormatError(
            rampName,
            `expected an object of ${COLORMAP_SIZE} indexed colours, got ${
                Array.isArray(response) ? 'an array' : String(response)
            }`
        )
    }
    // A `detail` key alongside colour 0 is a malformed table, not an error.
    const serviceError = Object.prototype.hasOwnProperty.call(response, '0')
        ? null
        : describeServiceError(response)
    if (serviceError != null) {
        throw new ColormapFormatError(
            rampName,
            `the service answered with an error: ${serviceError}`
        )
    }
    const entries = response as Record<string, unknown>
    const keys = Object.keys(entries)
    if (keys.length !== COLORMAP_SIZE) {
        throw new ColormapFormatError(
            rampName,
            `expected ${COLORMAP_SIZE} colours, got ${keys.length}`
        )
    }

    const table = new Uint8ClampedArray(COLORMAP_SIZE * 4)
    for (let i = 0; i < COLORMAP_SIZE; i++) {
        const key = String(i)
        if (!Object.prototype.hasOwnProperty.call(entries, key)) {
            throw new ColormapFormatError(
                rampName,
                `missing colour at index ${i} (keys must be 0-${
                    COLORMAP_SIZE - 1
                })`
            )
        }
        const colour = entries[key]
        if (
            !Array.isArray(colour) ||
            (colour.length !== 3 && colour.length !== 4) ||
            !colour.every(isChannel)
        ) {
            throw new ColormapFormatError(
                rampName,
                `colour at index ${i} is not [r, g, b] or [r, g, b, a] with 0-255 integers: ${JSON.stringify(
                    colour
                )}`
            )
        }
        table[i * 4] = colour[0]
        table[i * 4 + 1] = colour[1]
        table[i * 4 + 2] = colour[2]
        table[i * 4 + 3] = colour.length === 4 ? colour[3] : 255
    }
    return table
}

/** The same ramp run high to low: colour i of the result is colour 255 - i. */
export const reverseColormapTable = (table: ColormapTable): ColormapTable => {
    const reversed = new Uint8ClampedArray(COLORMAP_SIZE * 4)
    for (let i = 0; i < COLORMAP_SIZE; i++) {
        const from = (COLORMAP_SIZE - 1 - i) * 4
        reversed.set(table.subarray(from, from + 4), i * 4)
    }
    return reversed
}

const HEX_LENGTH = COLORMAP_SIZE * 8
const HEX_PATTERN = /^[0-9a-f]*$/

/**
 * A table as one lowercase hex string, `rrggbbaa` per colour (2048
 * characters). This is how the bundle stores ramps: compact, diffable, and
 * decoded once per ramp.
 */
export const encodeColormapTable = (table: ColormapTable): string => {
    let hex = ''
    for (let i = 0; i < table.length; i++) {
        hex += table[i].toString(16).padStart(2, '0')
    }
    return hex
}

/** Reads a string written by encodeColormapTable back into a table. */
export const decodeColormapTable = (
    rampName: string,
    hex: string
): ColormapTable => {
    if (
        typeof hex !== 'string' ||
        hex.length !== HEX_LENGTH ||
        !HEX_PATTERN.test(hex)
    ) {
        throw new ColormapFormatError(
            rampName,
            `expected ${HEX_LENGTH} lowercase hex characters (rrggbbaa x ${COLORMAP_SIZE})`
        )
    }
    const table = new Uint8ClampedArray(COLORMAP_SIZE * 4)
    for (let i = 0; i < table.length; i++) {
        table[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return table
}

/**
 * The colour a ramp assigns to `x`, a position from 0 (low end) to 1 (high
 * end), as `[r, g, b, a]`. Picks one of the 256 colours rather than blending
 * neighbours, the way the tiling service paints a ramp: it rescales a value
 * to 0-255 as a float, converts that to an 8-bit integer by truncating, and
 * reads that index off the table. So index i covers [i/255, (i+1)/255), and
 * only x = 1 reaches index 255. Out-of-range and non-finite positions clamp
 * to the nearest end.
 */
export const sampleColormapTable = (
    table: ColormapTable,
    x: number
): [number, number, number, number] => {
    const position = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
    const offset = Math.floor(position * (COLORMAP_SIZE - 1)) * 4
    return [
        table[offset],
        table[offset + 1],
        table[offset + 2],
        table[offset + 3],
    ]
}

/** All 256 colours as CSS `rgba()` strings, low end first. */
export const colormapTableToCss = (table: ColormapTable): string[] => {
    const colours: string[] = []
    for (let i = 0; i < COLORMAP_SIZE; i++) {
        const o = i * 4
        colours.push(
            `rgba(${table[o]}, ${table[o + 1]}, ${table[o + 2]}, ${
                table[o + 3] / 255
            })`
        )
    }
    return colours
}

/**
 * The largest per-channel difference (0-255) between two tables, alpha
 * included, and how many of the 256 colours differ by more than `tolerance`.
 */
export const compareColormapTables = (
    a: ColormapTable,
    b: ColormapTable,
    tolerance = 0
): { maxDifference: number; colorsBeyondTolerance: number } => {
    let maxDifference = 0
    let colorsBeyondTolerance = 0
    for (let i = 0; i < COLORMAP_SIZE; i++) {
        let colourDifference = 0
        for (let c = 0; c < 4; c++) {
            const d = Math.abs(a[i * 4 + c] - b[i * 4 + c])
            if (d > colourDifference) colourDifference = d
        }
        if (colourDifference > maxDifference) maxDifference = colourDifference
        if (colourDifference > tolerance) colorsBeyondTolerance++
    }
    return { maxDifference, colorsBeyondTolerance }
}
