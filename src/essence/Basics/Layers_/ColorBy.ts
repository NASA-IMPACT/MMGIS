/**
 * Colour-by-value styling for vector layers, configured at `style.colorBy`.
 *
 * A layer names one feature property and a mode that turns that property's
 * value into a colour:
 *
 *     "colorBy": {
 *         "mode": "ranges",
 *         "property": "frp",
 *         "applyToStroke": false,
 *         "ranges": [
 *             { "min": 0,   "color": "#FEF0D9", "label": "<10 MW" },
 *             { "min": 10,  "color": "#FDCC8A", "label": "10-49 MW" },
 *             { "min": 350, "color": "#B30000", "label": "≥350 MW" }
 *         ]
 *     }
 *
 * `ranges` places a numeric value in explicit bands: the band with the
 * greatest `min` at or below the value, so a value exactly on a boundary takes
 * the upper band. The last band is open above; the first is open below when
 * its `min` is null. Only the fill is coloured unless `applyToStroke` is true.
 *
 * `colormap` scales a numeric value linearly across a named ramp, the same
 * catalogue raster layers draw from:
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
 * Values below `min` take the ramp's first colour and values above `max` its
 * last. A `colormap` named with an `_r` suffix is reversed as well. The ramp's
 * colours are resolved asynchronously (see {@link loadColormapRamp}); until
 * they arrive the setting places no feature, so the layer paints its fixed
 * colour and is restyled once they land.
 *
 * Like legend-row styling (see LegendStyle) the work is split so a renderer
 * pays the parsing and sorting once per layer: `compileColorBy` digests the
 * configuration, and `resolveColorBy` runs per feature. A feature the mode
 * cannot place — the property missing, or not a number, or below a closed
 * first band — resolves to null and keeps the layer's fixed style colour.
 *
 * Every mode compiles to plain data, so a compiled setting can be serialised
 * as is (deck.gl's update triggers rely on that). A mode this build does not
 * implement compiles to null, which leaves the layer exactly as it is with no
 * `colorBy` at all.
 */

import {
    colorToRgb,
    normaliseColor,
    resolveLegendStyle,
    type CompiledLegendStyle,
    type LegendStyleResult,
} from './LegendStyle'
import { toCanonicalLayerType } from '../MapEngines/types/engine'
import {
    lookupColormapColors,
    resolveColormapColors,
} from '../Colormaps/resolveColormapColors'
import {
    getBaseColormapName,
    isReversedColormap,
} from '../Colormaps/colormapNaming'

/**
 * Canonical layer types whose features are styled by value: from legend rows
 * flagged `styleMatching` and from `colorBy`. A `query` layer counts because
 * it is drawn through the same vector construction once its data loads.
 * Others carry a legend purely for display. Membership is tested through
 * toCanonicalLayerType, which folds each deck.gl class name onto its MMGIS
 * type.
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
 * One band as authored. `min` null (or absent) opens the band below; a band
 * whose `min` is not a number, or whose colour is not one, is dropped.
 */
export interface ColorByRangeConfig {
    min?: number | string | null
    color?: string
    label?: string
}

/** `style.colorBy` as authored. */
export interface ColorByConfig {
    mode?: string
    property?: string
    applyToStroke?: boolean
    ranges?: ColorByRangeConfig[]
    colormap?: string
    reversed?: boolean
    min?: number | string
    max?: number | string
    unit?: string
}

/** A usable band, its colour normalised and its label settled. */
export interface RangeBand {
    /** Null for a band open below; only ever the first band. */
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
    /** The ramp's colours, or null while they are still being resolved. */
    colors: string[] | null
}

/**
 * A digested `colorBy` setting, discriminated on `mode`. Each mode adds a
 * member here, a compiler to {@link COMPILERS}, a case to {@link colorForValue}
 * and a legend in buildLayerLegend.
 */
export type CompiledColorBy = CompiledRanges | CompiledColormap

type Compiler = (
    config: ColorByConfig,
    property: string,
    applyToStroke: boolean
) => CompiledColorBy | null

const COMPILERS: Record<string, Compiler> = {
    ranges: compileRanges,
    colormap: compileColormap,
}

/**
 * Digest a layer's `style.colorBy` into the form {@link resolveColorBy}
 * consumes.
 *
 * @returns Null when the setting is absent, names no property, uses a mode
 *   this build does not implement, or carries nothing usable — in each case
 *   the layer styles as though no `colorBy` were configured.
 */
export function compileColorBy(config: unknown): CompiledColorBy | null {
    if (config == null || typeof config !== 'object' || Array.isArray(config))
        return null
    const { mode, property, applyToStroke } = config as ColorByConfig
    if (typeof property !== 'string' || property === '') return null
    const compile =
        typeof mode === 'string' && Object.prototype.hasOwnProperty.call(COMPILERS, mode)
            ? COMPILERS[mode]
            : null
    if (!compile) return null
    return compile(config as ColorByConfig, property, applyToStroke === true)
}

/**
 * Resolve one feature's colours from a compiled `colorBy` setting.
 *
 * @returns The fill colour (and the stroke colour too when `applyToStroke` is
 *   set), or null when the setting does not place this feature, so the caller
 *   keeps the layer's fixed style.
 */
export function resolveColorBy(
    compiled: CompiledColorBy | null | undefined,
    properties: Record<string, unknown> | null | undefined
): LegendStyleResult | null {
    if (!compiled || properties == null) return null
    const color = colorForValue(compiled, properties[compiled.property])
    if (color == null) return null
    return compiled.applyToStroke
        ? { fillColor: color, color }
        : { fillColor: color }
}

/**
 * The colours value-driven styling gives a feature: `colorBy` when the layer
 * has one, otherwise its `styleMatching` legend rows.
 *
 * A layer with a `colorBy` setting does not consult its legend rows at all,
 * even for a feature the setting leaves alone. Such a layer's legend is drawn
 * from the setting, so a colour the rows supplied would appear on the map with
 * no legend entry to explain it.
 *
 * @returns Null when neither colours this feature, so the caller keeps the
 *   layer's `*Prop` or fixed style.
 */
export function resolveFeatureColors(
    colorBy: CompiledColorBy | null | undefined,
    legend: CompiledLegendStyle | null | undefined,
    properties: Record<string, unknown> | null | undefined
): LegendStyleResult | null {
    if (colorBy) return resolveColorBy(colorBy, properties)
    return resolveLegendStyle(legend, properties)
}

function colorForValue(
    compiled: CompiledColorBy,
    value: unknown
): string | null {
    switch (compiled.mode) {
        case 'ranges':
            return rangeColor(compiled.bands, value)
        case 'colormap':
            return colormapColor(compiled, value)
        default:
            return null
    }
}

/**
 * A band's lower bound as authored, read as a number. Only null or absent
 * opens the band below. Anything else that is not a number makes the band
 * unusable — a blank string included, which would otherwise read as open
 * below and silently take the first band's place.
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

    const usable: { min: number | null; color: string; label?: string }[] =
        []
    for (const range of config.ranges) {
        if (range == null || typeof range !== 'object') continue
        // A colour no renderer can read is dropped here, once, so the band
        // is missing alike from both engines and from the legend rather than
        // drawing each renderer's own fallback.
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

    // Stable, so of two bands sharing a lower bound the later-written one is
    // last, and it is the one kept: a band a later one shadows could never be
    // drawn and has no place in the legend.
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

/**
 * The colour of the band holding `value`: the last band whose lower bound is
 * at or below it, found by binary search over bands sorted by lower bound.
 *
 * Only a real number is placed. A numeric string is not, matching how legend
 * rows treat one, so one value spelt two ways never colours two ways.
 */
function rangeColor(bands: RangeBand[], value: unknown): string | null {
    if (typeof value !== 'number' || Number.isNaN(value)) return null

    let lo = 0
    let hi = bands.length - 1
    let found = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (lowerBoundOf(bands[mid]) <= value) {
            found = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return found === -1 ? null : bands[found].color
}

/**
 * Resolved ramps, keyed by lowercased name with any `_r` suffix. Each is
 * resolved once and shared by every layer naming it, so two services defining
 * a custom ramp of the same name share whichever definition arrived first.
 */
const ramps = new Map<string, string[]>()
const rampKey = (name: string): string => name.toLowerCase()

/**
 * The ramp a `colormap` setting paints with, `_r`-suffixed when either
 * `reversed` is true or the configured name already carries the suffix.
 *
 * @returns Null for any other mode or a setting naming no ramp.
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

/**
 * A ramp's colours, resolved through the colormap catalogue raster legends use
 * (bundled ramps first, then the layer's TiTiler) and kept for every later
 * compile. Only a definition is kept: a custom ramp the service could not
 * supply resolves to the fallback ramp uncached, so it is asked for again once
 * the service's failure window has passed. Never rejects.
 */
export async function loadColormapRamp(
    name: string,
    titilerUrl: string | null
): Promise<string[] | null> {
    const cached = ramps.get(rampKey(name))
    if (cached) return cached
    const defined = await lookupColormapColors(name, titilerUrl)
    if (defined && defined.length > 0) {
        ramps.set(rampKey(name), defined)
        return defined
    }
    return resolveColormapColors(name, titilerUrl)
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
        colors: ramps.get(rampKey(colormap)) ?? null,
    }
}

/**
 * The ramp colour at a value's position between `min` and `max`, clamped to
 * the ends. Only a real number is placed, as with ranges.
 */
function colormapColor(
    { colors, min, max }: CompiledColormap,
    value: unknown
): string | null {
    if (!colors || typeof value !== 'number' || Number.isNaN(value))
        return null
    const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
    return colors[Math.floor(t * (colors.length - 1))]
}
