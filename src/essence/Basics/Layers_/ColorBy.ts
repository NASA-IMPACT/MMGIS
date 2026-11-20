/**
 * Colour-by-value styling for vector layers, configured at `style.colorBy`.
 *
 * A layer names one feature property and a mode that turns its value into a
 * colour. `ranges` places the value in explicit bands:
 *
 *     "colorBy": {
 *         "mode": "ranges",
 *         "property": "frp",
 *         "ranges": [
 *             { "min": 0,   "color": "#FEF0D9", "label": "<10 MW" },
 *             { "min": 10,  "color": "#FDCC8A", "label": "10-49 MW" },
 *             { "min": 350, "color": "#B30000", "label": "≥350 MW" }
 *         ]
 *     }
 *
 * A value takes the band with the greatest `min` at or below it. The last
 * band is open above; the first is open below when its `min` is null.
 *
 * `colormap` scales the value linearly across a named ramp, the same names
 * raster layers use, clamping below `min` and above `max` to the end colours:
 *
 *     "colorBy": {
 *         "mode": "colormap",
 *         "property": "sample_measurement",
 *         "colormap": "jet",
 *         "reversed": false,
 *         "min": 1,
 *         "max": 18,
 *         "unit": "µg/m³"
 *     }
 *
 * A ramp named with an `_r` suffix is reversed as well.
 *
 * Only the fill is coloured unless `applyToStroke` is true. A feature the
 * setting cannot place (property missing or not a number, or below a closed
 * first band) keeps the layer's fixed colour. A setting this build cannot use
 * (unknown mode, no property, no usable band, an unknown ramp, `max <= min`)
 * compiles to null, and the layer styles as if it had none.
 *
 * `compileColorBy` digests the setting once per layer; `resolveColorBy` runs
 * per feature. A compiled setting is plain data, so it can be serialised as
 * a deck.gl update trigger.
 */

import {
    colorToRgb,
    normaliseColor,
    resolveLegendStyle,
    type CompiledLegendStyle,
    type LegendStyleResult,
} from './LegendStyle'
import { toCanonicalLayerType, MAP_ENGINE } from '../MapEngines/types/engine'
import { bundledColormapColors } from '../Colormaps/resolveColormapColors'
import {
    getBaseColormapName,
    isReversedColormap,
} from '../Colormaps/colormapNaming'

/**
 * Canonical layer types whose features are styled by value: from legend rows
 * flagged `styleMatching` and from `colorBy`. A `query` layer counts because
 * it is drawn through the same vector construction once its data loads.
 */
const VALUE_STYLED_TYPES = new Set(['vector', 'vectortile', 'query'])

/** Whether a layer of this type colours its features by value. */
export function isValueStyledLayerType(type: unknown): boolean {
    return (
        typeof type === 'string' &&
        VALUE_STYLED_TYPES.has(toCanonicalLayerType(type))
    )
}

/**
 * Whether a layer of this type is coloured by its `colorBy` setting on the
 * given map engine. Leaflet draws vector tiles through a plugin that does not
 * read the setting, so there it is ignored, legend included.
 */
export function readsColorBy(type: unknown, engineType?: string): boolean {
    if (!isValueStyledLayerType(type)) return false
    return !(
        engineType === MAP_ENGINE.LEAFLET &&
        toCanonicalLayerType(type as string) === 'vectortile'
    )
}

/** `style.colorBy` as authored. */
export interface ColorByConfig {
    mode?: string
    property?: string
    applyToStroke?: boolean
    ranges?: { min?: number | string | null; color?: string; label?: string }[]
    colormap?: string
    reversed?: boolean
    min?: number | string
    max?: number | string
    unit?: string
}

/** A usable band. `min` is null only for a first band open below. */
export interface RangeBand {
    min: number | null
    color: string
    label: string
}

export interface CompiledRanges {
    mode: 'ranges'
    property: string
    applyToStroke: boolean
    /** Sorted ascending by `min`, one band per lower bound. */
    bands: RangeBand[]
}

export interface CompiledColormap {
    mode: 'colormap'
    property: string
    applyToStroke: boolean
    /** The ramp's name, `_r`-suffixed when reversed. */
    colormap: string
    min: number
    max: number
    unit: string | null
    colors: string[]
}

export type CompiledColorBy = CompiledRanges | CompiledColormap

/**
 * Digest a layer's `style.colorBy`.
 *
 * @returns Null when there is no usable setting; see the module comment.
 */
export function compileColorBy(config: unknown): CompiledColorBy | null {
    if (config == null || typeof config !== 'object' || Array.isArray(config))
        return null
    const c = config as ColorByConfig
    if (typeof c.property !== 'string' || c.property === '') return null
    const applyToStroke = c.applyToStroke === true
    if (c.mode === 'ranges') return compileRanges(c, c.property, applyToStroke)
    if (c.mode === 'colormap')
        return compileColormap(c, c.property, applyToStroke)
    return null
}

/**
 * One feature's colours from a compiled setting: the fill, and the stroke too
 * with `applyToStroke`. Null when the setting does not place the feature.
 */
export function resolveColorBy(
    compiled: CompiledColorBy | null | undefined,
    properties: Record<string, unknown> | null | undefined
): LegendStyleResult | null {
    if (!compiled || properties == null) return null
    const value = properties[compiled.property]
    // Only a real number is placed. A numeric string is not, matching legend
    // rows, so one value spelt two ways never colours two ways.
    if (typeof value !== 'number' || Number.isNaN(value)) return null
    const color =
        compiled.mode === 'ranges'
            ? rangeColor(compiled.bands, value)
            : colormapColor(compiled, value)
    if (color == null) return null
    return compiled.applyToStroke
        ? { fillColor: color, color }
        : { fillColor: color }
}

/**
 * The colours value-driven styling gives a feature: `colorBy` when the layer
 * has one, otherwise its `styleMatching` legend rows. A layer with `colorBy`
 * ignores its legend rows entirely, because its legend is drawn from the
 * setting and a row colour on the map would have no legend entry.
 */
export function resolveFeatureColors(
    colorBy: CompiledColorBy | null | undefined,
    legend: CompiledLegendStyle | null | undefined,
    properties: Record<string, unknown> | null | undefined
): LegendStyleResult | null {
    if (colorBy) return resolveColorBy(colorBy, properties)
    return resolveLegendStyle(legend, properties)
}

/**
 * A band's lower bound as a number, null for open below, or undefined for a
 * band that cannot be used. A blank string is unusable rather than open, so
 * it cannot silently take the first band's place.
 */
function readLowerBound(min: unknown): number | null | undefined {
    if (min == null) return null
    if (typeof min === 'string' && min.trim() === '') return undefined
    if (typeof min !== 'number' && typeof min !== 'string') return undefined
    const num = Number(min)
    return Number.isNaN(num) ? undefined : num
}

const lowerBoundOf = (band: { min: number | null }): number =>
    band.min ?? -Infinity

function compileRanges(
    config: ColorByConfig,
    property: string,
    applyToStroke: boolean
): CompiledRanges | null {
    if (!Array.isArray(config.ranges)) return null

    const usable: { min: number | null; color: string; label?: string }[] = []
    for (const range of config.ranges) {
        if (range == null || typeof range !== 'object') continue
        // A colour no renderer can read is dropped here, once, so the band is
        // missing alike from both engines and the legend.
        const color =
            typeof range.color === 'string'
                ? normaliseColor(range.color)
                : undefined
        if (!color || colorToRgb(color) == null) continue
        const min = readLowerBound(range.min)
        if (min === undefined) continue
        usable.push({
            min,
            color,
            label:
                typeof range.label === 'string' && range.label !== ''
                    ? range.label
                    : undefined,
        })
    }

    // Of two bands sharing a lower bound, the later-written one wins; the
    // other could never be drawn.
    usable.sort((a, b) => lowerBoundOf(a) - lowerBoundOf(b))
    const distinct = usable.filter(
        (band, i) =>
            i === usable.length - 1 ||
            lowerBoundOf(usable[i + 1]) !== lowerBoundOf(band)
    )
    if (distinct.length === 0) return null

    return {
        mode: 'ranges',
        property,
        applyToStroke,
        bands: distinct.map((band, i) => ({
            min: band.min,
            color: band.color,
            label:
                band.label ??
                defaultRangeLabel(band.min, distinct[i + 1]?.min ?? null),
        })),
    }
}

/** A label read off a band's bounds, for a band authored without one. */
function defaultRangeLabel(min: number | null, next: number | null): string {
    if (min == null) return next == null ? 'All values' : `< ${next}`
    return next == null ? `≥ ${min}` : `${min} – ${next}`
}

/** The colour of the last band whose lower bound is at or below `value`. */
function rangeColor(bands: RangeBand[], value: number): string | null {
    let found: RangeBand | null = null
    for (const band of bands) {
        if (lowerBoundOf(band) > value) break
        found = band
    }
    return found?.color ?? null
}

/**
 * The ramp a `colormap` setting paints with, `_r`-suffixed when `reversed` is
 * true or the configured name already carries the suffix. Null for any other
 * mode or a setting naming no ramp.
 */
export function colorByColormapName(config: unknown): string | null {
    if (config == null || typeof config !== 'object') return null
    const { mode, colormap, reversed } = config as ColorByConfig
    if (mode !== 'colormap' || typeof colormap !== 'string') return null
    const base = getBaseColormapName(colormap)
    if (base === '') return null
    return reversed === true || isReversedColormap(colormap)
        ? `${base}_r`
        : base
}

const toFinite = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const num = Number(value)
    return Number.isFinite(num) ? num : null
}

function compileColormap(
    config: ColorByConfig,
    property: string,
    applyToStroke: boolean
): CompiledColormap | null {
    const colormap = colorByColormapName(config)
    const min = toFinite(config.min)
    const max = toFinite(config.max)
    if (colormap == null || min == null || max == null || !(max > min))
        return null
    const colors = bundledColormapColors(colormap)
    if (!colors) return null
    return {
        mode: 'colormap',
        property,
        applyToStroke,
        colormap,
        min,
        max,
        unit:
            typeof config.unit === 'string' && config.unit !== ''
                ? config.unit
                : null,
        colors,
    }
}

/** The ramp colour at the value's position between `min` and `max`, clamped. */
function colormapColor(
    { colors, min, max }: CompiledColormap,
    value: number
): string {
    const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
    return colors[Math.floor(t * (colors.length - 1))]
}
