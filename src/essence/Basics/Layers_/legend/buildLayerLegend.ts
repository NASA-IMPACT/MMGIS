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

import { hasCogColormap } from '../tileUrlUtils'
import { resolveColormapColors } from '../../Colormaps/resolveColormapColors'
import { NO_LEGEND, type LayerLegend, type LegendSwatch } from './types'
import { activeUnit, toDisplay } from '../units/units'
import { isScale, readEntries, readScaleValues, type LegendEntry } from './entries'

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

const DEFAULT_COLORMAP = 'viridis'

/** A bound as a number, or null for anything that does not read as one. */
const toBound = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const num = Number(value)
    return Number.isFinite(num) ? num : null
}

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
    }
}

/**
 * The unit the layer is shown in, with the map from its data's unit, and the
 * given bounds converted into it. Colors are never converted: tiles and point
 * styles stay in the data's unit, so only the numbers a viewer reads change.
 */
const shownIn = (
    layerConfig: LayerConfig,
    min: number | null,
    max: number | null
): Pick<LayerLegend, 'min' | 'max' | 'unit'> => {
    const unit = activeUnit(layerConfig)
    if (!unit) return { min, max, unit: null }
    return {
        min: toDisplay(min, unit),
        max: toDisplay(max, unit),
        unit: { label: unit.label, scale: unit.scale, offset: unit.offset },
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
 * What the given layer's legend is, right now.
 *
 * `titilerUrl` is where a colormap the bundled ramps do not hold is looked up;
 * null leaves such a ramp falling back rather than resolved. Resolving colors
 * is why this is async — see `layers:getLegend`, which awaits it.
 */
export const buildLayerLegend = async (
    layerConfig: LayerConfig | null | undefined,
    titilerUrl: string | null = null
): Promise<LayerLegend> => {
    if (layerConfig == null) return NO_LEGEND

    const entries = readEntries(layerConfig._legend)
    const declaredGradient = readGradient(entries)

    if (hasCogColormap(layerConfig)) {
        const colormap =
            layerConfig.currentCogColormap ||
            layerConfig.cogColormap ||
            DEFAULT_COLORMAP
        const bounds = shownIn(
            layerConfig,
            toBound(layerConfig.currentCogMin ?? layerConfig.cogMin),
            toBound(layerConfig.currentCogMax ?? layerConfig.cogMax)
        )
        // Classes the colormap cannot stand in for. The ramp and its bounds
        // still come along, so the controls over them survive. Entries that
        // are all scale-shaped describe a ramp rather than classes, even when
        // their values are words ('Low'/'High') or the blank and 'NaN' labels
        // LayersTool derives before a rescale is set, so the live colormap
        // draws them.
        const swatches = isScale(entries) ? null : readSwatches(entries)
        if (swatches)
            return {
                type: 'categorical',
                stops: null,
                ...bounds,
                swatches,
                colormap,
            }
        return {
            type: 'gradient',
            stops: await resolveColormapColors(colormap, titilerUrl),
            ...bounds,
            swatches: null,
            colormap,
        }
    }

    if (entries.length === 0) return NO_LEGEND

    if (declaredGradient)
        return {
            type: 'gradient',
            stops: declaredGradient.stops,
            ...shownIn(layerConfig, declaredGradient.min, declaredGradient.max),
            swatches: null,
            colormap: null,
        }

    const swatches = readSwatches(entries)
    if (swatches) return { ...NO_LEGEND, type: 'categorical', swatches }

    return { ...NO_LEGEND, type: 'text' }
}
