/**
 * Chart plugin — pure helpers.
 *
 * No React, no DOM, no MMGIS. Turns the AOI plugin's `analysisReady`
 * payload into render-ready cards and formats stat values.
 */

export interface AssetStats {
    min: number | null
    max: number | null
    mean: number | null
    count: number
    sum: number
    std: number | null
    median: number | null
    majority: number | null
    minority: number | null
    unique: number
    histogram: [number[], number[]]
    valid_percent: number
    masked_pixels: number
    valid_pixels: number
    percentile_2: number | null
    percentile_98: number | null
}

export interface StatsResponse {
    type: 'Feature'
    geometry: unknown
    properties: { statistics: Record<string, AssetStats> }
}

export type AnalysisData = Record<string, StatsResponse | null>

export interface ResultCard {
    layerName: string
    assetName: string
    stats: AssetStats
}

export interface HistBin {
    label: string
    count: number
    lo: number
    hi: number
}

/** Flatten the keyed-by-layer payload into one card per (layer, asset). */
export function cardsFromAnalysisData(
    data: AnalysisData | null | undefined
): ResultCard[] {
    if (!data) return []
    const out: ResultCard[] = []
    for (const [layerName, resp] of Object.entries(data)) {
        if (!resp) continue
        const stats = resp.properties?.statistics ?? {}
        for (const [assetName, assetStats] of Object.entries(stats)) {
            out.push({ layerName, assetName, stats: assetStats })
        }
    }
    return out
}

/** Layer names that came back as null (errored or non-2xx). */
export function emptyLayers(
    data: AnalysisData | null | undefined
): string[] {
    if (!data) return []
    return Object.keys(data).filter((k) => data[k] === null)
}

/**
 * histogram is [counts, edges] with `edges.length === counts.length + 1`.
 * Returns one bin per count, labeled at the bin midpoint.
 */
export function buildHistogramBins(
    histogram: [number[], number[]]
): HistBin[] {
    const [counts, edges] = histogram
    return counts.map((count, i) => {
        const lo = edges[i]
        const hi = edges[i + 1]
        return { count, lo, hi, label: formatShort((lo + hi) / 2) }
    })
}

/** Format a stat value. Returns '—' for null/undefined/NaN. */
export function formatStat(
    value: number | null | undefined,
    opts?: { unit?: string; digits?: number }
): string {
    if (value == null || !Number.isFinite(value)) return '—'
    const digits =
        opts?.digits ??
        (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4)
    const s = value.toFixed(digits)
    return opts?.unit ? `${s} ${opts.unit}` : s
}

export function formatCount(n: number): string {
    return Number.isFinite(n) ? n.toLocaleString() : '—'
}

export function formatPercent(p: number): string {
    if (!Number.isFinite(p)) return '—'
    return p < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(0)}%`
}

function formatShort(n: number): string {
    if (!Number.isFinite(n)) return '—'
    if (Math.abs(n) >= 1000) return n.toFixed(0)
    if (Math.abs(n) >= 1) return n.toFixed(1)
    return n.toFixed(2)
}
