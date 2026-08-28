/**
 * Legend-driven per-feature styling, shared by every renderer.
 *
 * A layer's legend doubles as a style specification: entries flagged
 * `styleMatching` pair a feature property with a value and a colour, and each
 * feature is coloured from whichever entry its property value selects. Entries
 * marked `shape: 'continuous'` form a colour ramp that numeric values are
 * interpolated across; every other entry matches by exact value.
 *
 * This logic used to live inside the Leaflet vector construction path, so
 * vector tile layers and the deck.gl engine silently ignored a legend
 * configured for exactly this purpose (see issue #345). It lives here instead
 * so every renderer resolves the same configuration the same way.
 *
 * The work is split in two so callers can pay the grouping and sorting cost
 * once: `compileLegendStyle` digests the legend into ramps and lookup tables,
 * and `resolveLegendStyle` — the half that runs once per feature, whenever a
 * renderer styles it — does lookup and interpolation only.
 *
 * Both halves are pure, and neither touches the DOM: colours are parsed with
 * d3-color rather than by measuring a throwaway element, so this module works
 * under plain Node and adds no layout work to the render path. Resolution
 * returns colours rather than writing them anywhere, because a shared mutable
 * slot leaks one feature's colour into the next feature's fallback.
 */

import { color as parseColor } from 'd3'

/**
 * A single legend row, as authored in the layer config or a legend CSV.
 *
 * A CSV legend reaches here through `F_.csvToJSON`, which assigns every cell
 * as a raw string, so the fields below hold `'true'` where an inline JSON
 * legend holds `true`, and `'30'` where it holds `30`.
 */
export interface LegendStyleEntry {
    styleMatching?: boolean | string
    propertyName?: string
    propertyValue?: unknown
    shape?: string
    color?: string
    strokecolor?: string
}

/** Colours a feature's legend entry supplies. Either half may be absent. */
export interface LegendStyleResult {
    /** Stroke colour. */
    color?: string
    /** Fill colour. */
    fillColor?: string
}

/** A ramp stop, already normalised to its 0-1 position along the ramp. */
interface ColorStop {
    position: number
    color: string
}

interface ContinuousRamp {
    minValue: number
    maxValue: number
    fillColorStops: ColorStop[]
    strokeColorStops: ColorStop[]
}

interface CompiledPropertyGroup {
    propertyName: string
    /** Null unless the group holds two or more numeric continuous entries. */
    ramp: ContinuousRamp | null
    discreteEntries: LegendStyleEntry[]
}

/** Opaque digest of a legend, produced by {@link compileLegendStyle}. */
export type CompiledLegendStyle = CompiledPropertyGroup[]

interface Rgb {
    r: number
    g: number
    b: number
}

// Helper function to interpolate between two colors using RGB
function interpolateColor(
    color1: string,
    color2: string,
    factor: number
): string | undefined {
    if (!color1 || !color2) return color1 || color2

    // Ensure factor is between 0 and 1
    factor = Math.max(0, Math.min(1, factor))

    const rgb1 = colorToRgb(color1)
    const rgb2 = colorToRgb(color2)

    if (!rgb1 || !rgb2) return color1 // Fallback if color parsing fails

    // Interpolate each RGB component
    const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor)
    const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor)
    const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor)

    return `rgb(${r}, ${g}, ${b})`
}

// Enhanced function to interpolate between multiple colors using color stops
function interpolateMultipleColors(
    colorStops: ColorStop[],
    value: number,
    minValue: number,
    maxValue: number
): string | undefined | null {
    if (!colorStops || colorStops.length === 0) return null
    if (colorStops.length === 1) return colorStops[0].color

    // Normalize the value to 0-1 range
    const normalizedValue =
        maxValue === minValue ? 0 : (value - minValue) / (maxValue - minValue)

    // Clamp the normalized value
    const clampedValue = Math.max(0, Math.min(1, normalizedValue))

    // If we're at the extremes, return the boundary colors
    if (clampedValue === 0) return colorStops[0].color
    if (clampedValue === 1) return colorStops[colorStops.length - 1].color

    // Find the two color stops that bracket our value
    for (let i = 0; i < colorStops.length - 1; i++) {
        const currentStop = colorStops[i]
        const nextStop = colorStops[i + 1]

        if (
            clampedValue >= currentStop.position &&
            clampedValue <= nextStop.position
        ) {
            // Calculate the local factor between these two stops
            const stopRange = nextStop.position - currentStop.position
            const localFactor =
                stopRange === 0
                    ? 0
                    : (clampedValue - currentStop.position) / stopRange

            // Interpolate between the two colors
            return interpolateColor(
                currentStop.color,
                nextStop.color,
                localFactor
            )
        }
    }

    // Fallback (shouldn't reach here)
    return colorStops[colorStops.length - 1].color
}

/**
 * Parse any CSS colour string a legend might carry — `#rgb`, `#rrggbb`,
 * `rgb()`, `rgba()`, `hsl()`, a named colour — into RGB components.
 *
 * d3-color does the work, so this stays pure: the previous implementation
 * fell back to appending a probe element to `document.body` and reading its
 * computed style, which needed a DOM and forced a layout for every named
 * colour it parsed.
 *
 * @returns Null when the string is not a colour, so callers can fall back.
 */
function colorToRgb(color: string): Rgb | null {
    if (!color || typeof color !== 'string') return null

    // Legends are sometimes authored with a bare hex triplet. The previous
    // hex parser stripped an optional '#', so accept that spelling still.
    const trimmed = color.trim()
    const normalised = /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)
        ? `#${trimmed}`
        : trimmed

    const parsed = parseColor(normalised)
    if (!parsed) return null

    const { r, g, b } = parsed.rgb()
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null

    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) }
}

/**
 * Whether a legend row opts into style matching.
 *
 * An inline legend carries a real boolean here, but a legend parsed from CSV
 * carries the cell text, and the string `'false'` is truthy — so a row that
 * plainly opts out would otherwise style features anyway.
 */
function isStyleMatching(value: unknown): boolean {
    if (typeof value === 'string') {
        const normalised = value.trim().toLowerCase()
        return (
            normalised !== '' && normalised !== 'false' && normalised !== '0'
        )
    }
    return Boolean(value)
}

/**
 * Digest a layer's legend into the form {@link resolveLegendStyle} consumes.
 *
 * Everything that does not depend on a feature — which entries participate,
 * how they group by property, the sorted stops, the ramp's min and max, and
 * each stop's normalised position — is settled here, once per legend.
 *
 * @param legendData - `L_.layers.data[<layer>]._legend`, or anything else.
 * @returns Null when the legend is absent, malformed, or carries no
 *   `styleMatching` entries, so callers can keep a no-legend fast path.
 */
export function compileLegendStyle(
    legendData: unknown
): CompiledLegendStyle | null {
    if (!Array.isArray(legendData)) return null

    // Grouped through a parallel array of names rather than the object's own
    // key order, so the groups stay in the order the legend author wrote them.
    const propertyNames: string[] = []
    const groups: Record<string, LegendStyleEntry[]> = {}
    for (const entry of legendData as LegendStyleEntry[]) {
        if (
            !entry ||
            !isStyleMatching(entry.styleMatching) ||
            !entry.propertyName ||
            entry.propertyValue === undefined
        )
            continue
        if (!groups[entry.propertyName]) {
            groups[entry.propertyName] = []
            propertyNames.push(entry.propertyName)
        }
        groups[entry.propertyName].push(entry)
    }
    if (propertyNames.length === 0) return null

    return propertyNames.map((propertyName) => {
        const entries = groups[propertyName]

        const numericEntries = entries
            .filter((entry) => entry.shape === 'continuous')
            .map((entry) => ({
                entry,
                numericValue: parseFloat(entry.propertyValue as string),
            }))
            .filter((entry) => !isNaN(entry.numericValue))
            .sort((a, b) => a.numericValue - b.numericValue)

        // Interpolation needs something to interpolate between, so a lone
        // continuous entry leaves the group to exact matching.
        let ramp: ContinuousRamp | null = null
        if (numericEntries.length >= 2) {
            const minValue = numericEntries[0].numericValue
            const maxValue =
                numericEntries[numericEntries.length - 1].numericValue
            const positionOf = (value: number) =>
                maxValue === minValue
                    ? 0
                    : (value - minValue) / (maxValue - minValue)

            ramp = {
                minValue,
                maxValue,
                fillColorStops: numericEntries
                    .filter((e) => e.entry.color)
                    .map((e) => ({
                        position: positionOf(e.numericValue),
                        color: e.entry.color as string,
                    })),
                // Stroke stops fall back to the entry's fill colour, so a
                // legend authored with fill colours alone still produces a
                // border ramp.
                strokeColorStops: numericEntries
                    .filter((e) => e.entry.strokecolor || e.entry.color)
                    .map((e) => ({
                        position: positionOf(e.numericValue),
                        color: (e.entry.strokecolor || e.entry.color) as string,
                    })),
            }
        }

        return {
            propertyName,
            ramp,
            discreteEntries: entries.filter(
                (entry) => entry.shape !== 'continuous'
            ),
        }
    })
}

/**
 * Resolve one feature's legend colours.
 *
 * @param compiled - Output of {@link compileLegendStyle}.
 * @param properties - The feature's properties.
 * @returns The colours the legend dictates, or null when no legend property
 *   applies to this feature — in which case the caller keeps whatever style it
 *   would otherwise have used.
 */
export function resolveLegendStyle(
    compiled: CompiledLegendStyle | null | undefined,
    properties: Record<string, unknown> | null | undefined
): LegendStyleResult | null {
    if (!compiled || properties == null) return null

    for (const group of compiled) {
        const featureValue = properties[group.propertyName]

        // A missing, non-numeric or NaN value cannot be placed on the ramp, so
        // the feature falls through to exact matching and then to the layer's
        // configured style rather than drawing black or vanishing. NaN needs
        // saying separately because `typeof NaN` is 'number': left on the ramp
        // it normalises to NaN, brackets against no stop, and falls out of the
        // interpolator holding the ramp's top colour, so a null-sentinel
        // measurement would draw as the maximum of the scale.
        if (
            typeof featureValue === 'number' &&
            !Number.isNaN(featureValue) &&
            group.ramp
        ) {
            // The first property whose ramp is live owns the feature: no later
            // legend property is consulted, even when the ramp yields nothing.
            return resolveRamp(group.ramp, featureValue)
        }

        const match = matchDiscreteEntry(group.discreteEntries, featureValue)
        if (match) {
            const result: LegendStyleResult = {}
            if (match.color) result.fillColor = match.color
            if (match.strokecolor) result.color = match.strokecolor
            else if (match.color) result.color = match.color
            return result
        }
    }

    return null
}

function resolveRamp(ramp: ContinuousRamp, value: number): LegendStyleResult {
    const result: LegendStyleResult = {}
    const { minValue, maxValue, fillColorStops, strokeColorStops } = ramp

    if (fillColorStops.length >= 1) {
        const fillColor =
            fillColorStops.length === 1
                ? fillColorStops[0].color
                : interpolateMultipleColors(
                      fillColorStops,
                      value,
                      minValue,
                      maxValue
                  )
        if (fillColor) result.fillColor = fillColor
    }

    if (strokeColorStops.length >= 1) {
        const color =
            strokeColorStops.length === 1
                ? strokeColorStops[0].color
                : interpolateMultipleColors(
                      strokeColorStops,
                      value,
                      minValue,
                      maxValue
                  )
        if (color) result.color = color
    }

    return result
}

function matchDiscreteEntry(
    entries: LegendStyleEntry[],
    featureValue: unknown
): LegendStyleEntry | null {
    for (const entry of entries) {
        let matches = false
        if (
            typeof featureValue === 'string' &&
            typeof entry.propertyValue === 'string'
        ) {
            matches = featureValue === entry.propertyValue
        } else if (
            typeof featureValue === 'number' &&
            !isNaN(parseFloat(entry.propertyValue as string))
        ) {
            matches = featureValue === parseFloat(entry.propertyValue as string)
        } else if (typeof featureValue === 'boolean') {
            matches =
                featureValue ===
                (entry.propertyValue === 'true' || entry.propertyValue === true)
        } else {
            matches = String(featureValue) === String(entry.propertyValue)
        }

        if (matches) return entry
    }
    return null
}
