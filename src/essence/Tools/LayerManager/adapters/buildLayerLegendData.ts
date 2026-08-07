import type { Layer, LegendType, CategoricalStop, CogData } from '../lib/types'

type MMGISLegendEntry = {
    shape?: string
    color?: string
    value?: string | number
    label?: string
    hideFromLegend?: boolean
}

type MMGISLayerConfig = {
    display_name?: string
    description?: string
    _legend?: MMGISLegendEntry[]
    currentCogColormap?: string
    cogColormap?: string
    currentCogMin?: number
    cogMin?: number
    currentCogMax?: number
    cogMax?: number
    cogUnits?: string | null
    titilerUrl?: string | null
}

const detectLegendType = (legend: MMGISLegendEntry[] | undefined): LegendType => {
    if (!Array.isArray(legend) || legend.length === 0) return 'text'
    const first = legend[0]
    if (first.shape === 'continuous' || first.shape === 'discreet') return 'gradient'
    if (first.color && first.value !== undefined) return 'categorical'
    return 'text'
}

const buildGradientFields = (legend: MMGISLegendEntry[]) => {
    const stops = legend.map((entry) => entry.color || '')
    const values = legend.map((entry) => {
        const parsed = parseFloat(String(entry.value))
        return isNaN(parsed) ? entry.value : parsed
    })
    const numericValues = values.filter((v): v is number => typeof v === 'number')
    const min = numericValues.length > 0
        ? Math.min(...numericValues)
        : (values[values.length - 1] as number)
    const max = numericValues.length > 0
        ? Math.max(...numericValues)
        : (values[0] as number)
    let unit: { label: string } | null = null
    const firstVal = legend[0]?.value
    if (firstVal !== undefined) {
        const match = String(firstVal).match(/[\d.]+\s*(.+)/)
        if (match && match[1]) unit = { label: match[1].trim() }
    }
    return { stops, min, max, unit }
}

const buildCategoricalFields = (legend: MMGISLegendEntry[]): CategoricalStop[] =>
    legend
        .filter((entry) => !entry.hideFromLegend)
        .map((entry) => ({
            color: entry.color || '',
            label: String(entry.value || entry.label || ''),
        }))

/**
 * Shapes one layer's config into the legend model the UI renders.
 *
 * `colormapCapable` comes from core over the request bus; the COG block, and
 * so the colormap controls, are built only for a capable layer.
 */
export const buildLayerLegendData = (
    layerName: string,
    layerConfig: MMGISLayerConfig,
    opacities: Record<string, number> | null | undefined,
    visible: boolean,
    colormapCapable: boolean,
): Layer => {
    const opacity = opacities?.[layerName] ?? 1

    const cog: CogData | null = colormapCapable
        ? {
              isCog: true,
              colormap: layerConfig.currentCogColormap || layerConfig.cogColormap || 'viridis',
              min: layerConfig.currentCogMin ?? layerConfig.cogMin ?? 0,
              max: layerConfig.currentCogMax ?? layerConfig.cogMax ?? 255,
              defaultMin: layerConfig.cogMin ?? 0,
              defaultMax: layerConfig.cogMax ?? 255,
              defaultColormap: layerConfig.cogColormap || 'viridis',
              units: layerConfig.cogUnits ?? null,
              titilerUrl: layerConfig.titilerUrl ?? null,
          }
        : null

    const base: Layer = {
        id: layerName,
        title: layerConfig.display_name || layerName,
        description: layerConfig.description || null,
        opacity,
        visible,
        type: 'none',
        cog,
    }

    const legend = layerConfig._legend
    if (!legend || (Array.isArray(legend) && legend.length === 0)) {
        if (cog) {
            return {
                ...base,
                type: 'gradient',
                min: cog.min,
                max: cog.max,
                stops: null,
                unit: cog.units ? { label: cog.units } : null,
            }
        }
        return base
    }

    const legendType = detectLegendType(legend)
    if (legendType === 'gradient') {
        const { stops, min, max, unit } = buildGradientFields(legend)
        return { ...base, type: 'gradient', stops, min, max, unit }
    }
    if (legendType === 'categorical') {
        return {
            ...base,
            type: 'categorical',
            categoricalStops: buildCategoricalFields(legend),
        }
    }
    return { ...base, type: 'text' }
}
