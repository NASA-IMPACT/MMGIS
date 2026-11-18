// A layer's colormap setting: which ramp colours it, in which direction, over
// which range, and how values find their colour.
//
// Raster and vector layers store the setting differently, and existing
// mission configs are read as they are:
//
// - A raster that paints through a COG colormap (`cogTransform`) keeps it in
//   its `cog*` fields. `cogColormap`, `cogMin` and `cogMax` are as configured;
//   `currentCogColormap`, `currentCogMin` and `currentCogMax` are what the
//   running dashboard changed them to, and win. A `_r` suffix on the ramp name
//   reverses it. `cogUnits` names the unit; the optional `cogColormapMode` and
//   `cogColormapSource` carry the mode and source.
// - A vector layer keeps it at `style.colorBy` with `mode: 'colormap'`:
//
//       "colorBy": {
//           "mode": "colormap",
//           "property": "sample_measurement",
//           "colormap": "jet",
//           "reversed": false,
//           "min": 1,
//           "max": 18,
//           "unit": "µg/m³",
//           "colormapMode": "continuous",
//           "source": null
//       }
//
// Everything that reads a layer's ramp reads it through readLayerColormap, and
// everything that changes one at runtime goes through `layers:setColormap`,
// so no consumer reads or writes these fields itself.

import type {
    ColormapMode,
    ColormapRequest,
} from '../Colormaps/colormapResolver'
import {
    getBaseColormapName,
    isReversedColormap,
} from '../Colormaps/colormapNaming'
import { toCanonicalLayerType } from '../MapEngines/types/engine'
import { hasCogColormap } from './tileUrlUtils'

/** A layer's colormap setting, however the layer stores it. */
export type LayerColormap = ColormapRequest & {
    /** The forward ramp name, as configured. */
    name: string
    reversed: boolean
    /** The value painted with the ramp's low end, or null when unset. */
    min: number | null
    /** The value painted with the ramp's high end, or null when unset. */
    max: number | null
    mode: ColormapMode
    unit: string | null
    /** A registered source kind, or null for the layer's tiling service. */
    source: string | null
}

/** Which way a layer stores and applies its colormap setting. */
export type ColormapKind = 'raster' | 'vector'

/** The ramp a COG raster paints with when it names none. */
export const DEFAULT_RASTER_COLORMAP = 'viridis'

type LooseConfig = Record<string, any> | null | undefined

const VECTOR_TYPES = new Set(['vector', 'vectortile'])

const toNumber = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const num = Number(value)
    return Number.isFinite(num) ? num : null
}

const toText = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value : null

const toMode = (value: unknown): ColormapMode =>
    value === 'categorical' ? 'categorical' : 'continuous'

const vectorColorBy = (layerObj: LooseConfig): Record<string, any> | null => {
    if (!VECTOR_TYPES.has(toCanonicalLayerType(layerObj?.type) ?? ''))
        return null
    const colorBy = layerObj?.style?.colorBy
    return colorBy && typeof colorBy === 'object' && colorBy.mode === 'colormap'
        ? colorBy
        : null
}

/**
 * Whether a layer colours by a colormap at all, and if so which way it stores
 * the setting. Null for a layer with no colormap.
 */
export function colormapKindOf(layerObj: LooseConfig): ColormapKind | null {
    if (hasCogColormap(layerObj)) return 'raster'
    if (vectorColorBy(layerObj)) return 'vector'
    return null
}

/**
 * Splits a configured ramp name into its forward name and direction. A
 * `_r` suffix and an explicit `reversed` cancel out, as they do everywhere a
 * ramp name is read.
 */
const readRamp = (
    configured: string,
    reversed: unknown
): { name: string; reversed: boolean } => ({
    name: getBaseColormapName(configured),
    reversed: isReversedColormap(configured) !== (reversed === true),
})

/** A layer's colormap setting as it stands right now, or null if it has none. */
export function readLayerColormap(layerObj: LooseConfig): LayerColormap | null {
    switch (colormapKindOf(layerObj)) {
        case 'raster': {
            const l = layerObj as Record<string, any>
            const mode = toMode(l.cogColormapMode)
            const ramp = readRamp(
                toText(l.currentCogColormap) ??
                    toText(l.cogColormap) ??
                    DEFAULT_RASTER_COLORMAP,
                false
            )
            return {
                ...ramp,
                reversed: mode === 'categorical' ? false : ramp.reversed,
                min: toNumber(l.currentCogMin ?? l.cogMin),
                max: toNumber(l.currentCogMax ?? l.cogMax),
                mode,
                unit: toText(l.cogUnits),
                source: toText(l.cogColormapSource),
            }
        }
        case 'vector': {
            const c = vectorColorBy(layerObj) as Record<string, any>
            const mode = toMode(c.colormapMode)
            const ramp = readRamp(
                toText(c.colormap) ?? DEFAULT_RASTER_COLORMAP,
                c.reversed
            )
            return {
                ...ramp,
                reversed: mode === 'categorical' ? false : ramp.reversed,
                min: toNumber(c.min),
                max: toNumber(c.max),
                mode,
                unit: toText(c.unit),
                source: toText(c.source),
            }
        }
        default:
            return null
    }
}

/**
 * The raster config fields that put `setting` into effect: the runtime
 * `currentCog*` overrides every raster renderer and the tile URL read. A
 * reversed ramp is written as its `_r` name, which is how the tiling service
 * is asked for it.
 */
export function rasterColormapFields(
    setting: Pick<LayerColormap, 'name' | 'reversed' | 'min' | 'max'>
): Record<string, unknown> {
    const fields: Record<string, unknown> = {
        currentCogColormap: setting.reversed
            ? `${setting.name}_r`
            : setting.name,
    }
    if (setting.min != null) fields.currentCogMin = setting.min
    if (setting.max != null) fields.currentCogMax = setting.max
    return fields
}
