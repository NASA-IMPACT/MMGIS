// Builds one layer's legend from the layer as it stands right now.
//
// Two sources can describe a layer's legend, and they are not equal. A raster
// that paints through a COG colormap is described by that colormap and its
// rescale bounds, which the user changes while the dashboard runs; everything
// else is described by the `_legend` its mission config or legend CSV declared.
// Live colormap state therefore wins wherever the layer has one, which also
// settles the legends LayersTool derives and writes back into `_legend`: for a
// raster they are a stale snapshot of the state read here, and for a velocity
// layer — which paints no COG colormap — they are the only legend there is.
//
// What live state replaces is the ramp, never a set of classes. A classified
// raster paints through a colormap and still declares what its classes mean;
// no colormap can stand in for those, so its swatches survive. A raster whose
// declared entries are all scale-shaped is describing a ramp, whether or not
// its labels read as numbers, so the live colormap draws it.

import {
    DEFAULT_RASTER_COLORMAP,
    colormapKindOf,
    readLayerColormap,
    type LayerColormap,
} from '../layerColormap'
import {
    resolveColormapTable,
    type ColormapContext,
} from '../../Colormaps/colormapResolver'
import { colormapTableToCss } from '../../Colormaps/colormapTable'
import { NO_LEGEND, type LayerLegend, type LegendSwatch } from './types'

type LegendEntry = {
    shape?: string
    color?: string
    value?: string | number
    label?: string
    hideFromLegend?: boolean
}

type LayerConfig = {
    type?: string
    cogTransform?: boolean
    _legend?: LegendEntry[]
    cogColormap?: string
    currentCogColormap?: string
    cogMin?: number | string
    currentCogMin?: number | string
    cogMax?: number | string
    currentCogMax?: number | string
    cogUnits?: string | null
    [key: string]: unknown
}

/** The shapes that make an entry part of a continuous scale rather than a swatch. */
const SCALE_SHAPES = ['continuous', 'discreet']

/**
 * The most category codes a categorical ramp's legend lists one by one. A
 * wider range is drawn as the ramp itself: a few hundred swatches read as
 * nothing.
 */
const MAX_CATEGORY_SWATCHES = 64

const NUMERIC_PREFIX = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/

type NumericValue = { number: number; unit: string }

/**
 * Reads a legend value as a number plus an optional trailing unit
 * (`'0.5 ppm'` -> 0.5 + 'ppm'). Null for anything that is not a plain number:
 * a word (`'example'`), or a binned label (`'0.5-1.0 m'`) whose remainder
 * reads as another number rather than as a unit.
 */
const parseNumericValue = (
    value: string | number | undefined
): NumericValue | null => {
    const str = String(value ?? '').trim()
    const match = str.match(NUMERIC_PREFIX)
    if (!match) return null
    const unit = str.slice(match[0].length).trim()
    if (/^[+\-.\d]/.test(unit)) return null
    return { number: parseFloat(match[0]), unit }
}

/**
 * The numbers and shared unit behind a run of scale entries, or null when the
 * run is not one honest numeric scale: some value is not a number, or the
 * entries disagree on their unit (which is what a set of binned labels looks
 * like once each bin's remainder is read as a unit).
 */
const readScaleValues = (
    entries: LegendEntry[]
): { numbers: number[]; unit: string | null } | null => {
    const parsed = entries.map((entry) => parseNumericValue(entry.value))
    if (parsed.some((value) => value === null)) return null
    const values = parsed as NumericValue[]
    const units = new Set(values.map((value) => value.unit))
    if (units.size > 1) return null
    const [unit] = [...units]
    return { numbers: values.map((value) => value.number), unit: unit || null }
}

/**
 * Whether every entry is part of a scale — a ramp, whatever its labels say.
 * An empty run is not one: `every` answers true for it, and a gradient read
 * off it would span Infinity.
 */
const isScale = (entries: LegendEntry[]): boolean =>
    entries.length > 0 &&
    entries.every((entry) => SCALE_SHAPES.includes(entry.shape ?? ''))

/**
 * A gradient bar can only stand in for a legend that is one uninterrupted
 * numeric scale. A legend that mixes scale runs with individually shaped
 * entries — the form the Legend tool renders as a mix of bars and swatches —
 * or one whose scale values are words or bins, draws as labelled swatches
 * instead of a ramp whose bounds would be read off non-numeric text.
 */
const readGradient = (entries: LegendEntry[]) => {
    if (!isScale(entries)) return null
    const values = readScaleValues(entries)
    if (!values) return null
    const stops = entries.map((entry) => entry.color || '')
    // A scale may be written either way round — LayersTool builds its derived
    // legend ascending and then reverses it, and authors write both — while
    // every consumer paints the stops left to right against a minimum printed
    // on the left. A descending run is turned round here so the ramp and its
    // labels can never run opposite ways.
    if (values.numbers[0] > values.numbers[values.numbers.length - 1])
        stops.reverse()
    return {
        stops,
        min: Math.min(...values.numbers),
        max: Math.max(...values.numbers),
        unit: values.unit ? { label: values.unit } : null,
    }
}

const hasSwatch = (entry: LegendEntry): boolean =>
    Boolean(entry.color) &&
    (entry.value !== undefined || entry.label !== undefined)

/**
 * The labelled swatches behind a legend that is not one numeric scale, or null
 * when its entries carry nothing to draw as a swatch.
 */
const readSwatches = (entries: LegendEntry[]): LegendSwatch[] | null => {
    if (!entries.some(hasSwatch)) return null
    return entries.map((entry) => ({
        color: entry.color || '',
        label: String(entry.value ?? entry.label ?? ''),
    }))
}

/**
 * The entries worth drawing: whatever the layer declared, minus the ones the
 * author hid and minus any hole a hand-written config left behind. A hidden
 * nodata class is not a swatch and its value is not a bound, so both are
 * dropped before anything is read off them.
 */
const readEntries = (declared: unknown): LegendEntry[] =>
    Array.isArray(declared)
        ? declared.filter(
              (entry): entry is LegendEntry =>
                  entry != null &&
                  typeof entry === 'object' &&
                  (entry as LegendEntry).hideFromLegend !== true
          )
        : []

/**
 * The swatches of a categorical ramp: one per whole code from min to max, in
 * the colour the ramp gives that code, leaving out codes the ramp paints
 * fully transparent (unused codes in a category ramp). Null when the range is
 * unset, outside the ramp's 0-255 codes, or too wide to list.
 */
const readCategorySwatches = (
    table: Uint8ClampedArray,
    setting: LayerColormap
): LegendSwatch[] | null => {
    if (setting.min == null || setting.max == null) return null
    const first = Math.max(0, Math.ceil(Math.min(setting.min, setting.max)))
    const last = Math.min(255, Math.floor(Math.max(setting.min, setting.max)))
    if (last < first || last - first + 1 > MAX_CATEGORY_SWATCHES) return null
    const css = colormapTableToCss(table)
    const swatches: LegendSwatch[] = []
    for (let code = first; code <= last; code++) {
        if (table[code * 4 + 3] === 0) continue
        swatches.push({ color: css[code], label: String(code) })
    }
    return swatches.length > 0 ? swatches : null
}

/**
 * What the given layer's legend is, right now.
 *
 * `ctx` is what the layer's colormap sources read — its tiling service — so
 * the legend paints from the same source as the map beside it (see
 * colormapResolver). Resolving colours is why this is async — see
 * `layers:getLegend`, which awaits it.
 */
export const buildLayerLegend = async (
    layerConfig: LayerConfig | null | undefined,
    ctx: ColormapContext = {}
): Promise<LayerLegend> => {
    if (layerConfig == null) return NO_LEGEND

    const entries = readEntries(layerConfig._legend)
    const declaredGradient = readGradient(entries)

    const setting =
        colormapKindOf(layerConfig) === 'raster'
            ? readLayerColormap(layerConfig)
            : null
    if (setting) {
        const colormap =
            layerConfig.currentCogColormap ||
            layerConfig.cogColormap ||
            DEFAULT_RASTER_COLORMAP
        const bounds = {
            min: setting.min,
            max: setting.max,
            // `cogUnits` is where a raster names its unit, but plenty of
            // missions only ever wrote it into the legend text ('0 m'), and
            // dropping it there would leave the bar labelled with bare
            // numbers.
            unit: setting.unit
                ? { label: setting.unit }
                : declaredGradient?.unit ?? null,
        }
        // Classes the colormap cannot stand in for. The ramp and its bounds
        // still come along, so the controls over them survive. Entries that
        // are all scale-shaped describe a ramp rather than classes, even when
        // their values are words ('Low'/'High') or the blank and 'NaN' labels
        // LayersTool derives before a rescale is set, so the live colormap
        // draws them.
        const declared = isScale(entries) ? null : readSwatches(entries)
        if (declared)
            return {
                type: 'categorical',
                stops: null,
                ...bounds,
                swatches: declared,
                colormap,
            }
        const { table } = await resolveColormapTable(setting, ctx)
        const categories =
            setting.mode === 'categorical'
                ? readCategorySwatches(table, setting)
                : null
        if (categories)
            return {
                type: 'categorical',
                stops: null,
                ...bounds,
                swatches: categories,
                colormap,
            }
        return {
            type: 'gradient',
            stops: colormapTableToCss(table),
            ...bounds,
            swatches: null,
            colormap,
        }
    }

    if (entries.length === 0) return NO_LEGEND

    if (declaredGradient)
        return {
            type: 'gradient',
            ...declaredGradient,
            swatches: null,
            colormap: null,
        }

    const swatches = readSwatches(entries)
    if (swatches) return { ...NO_LEGEND, type: 'categorical', swatches }

    return { ...NO_LEGEND, type: 'text' }
}
