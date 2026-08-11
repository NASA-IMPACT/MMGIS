// Pure payload → ECharts option translation. No DOM, no echarts import —
// the output is a plain option object the rendering component hands to
// `chart.setOption(...)`, which keeps everything here unit-testable.
//
// Time axes deliberately use a VALUE axis over epoch milliseconds with our
// own tick/tooltip formatting: echarts' native 'time' axis renders labels in
// the viewer's local zone, and epoch-value with UTC formatters keeps every
// viewer seeing the same timestamps.

import type {
    ChartPoint,
    ChartSeries,
    ChartSeriesPayload,
} from '../../_shared/types/chartSeries'
import type { ChartTheme } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export interface XyPoint {
    x: number
    y: number | null
}

/** Timezone-less ISO datetimes (common in OGC feature APIs) are read as UTC —
 *  Date.parse would use the viewer's local zone, shifting points per user. */
const TZ_LESS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/**
 * Converts a series' points for a time axis: ISO datetime → epoch ms,
 * dropping unparseable x values (a bad timestamp shouldn't sink the series).
 * `y: null` gaps pass through — Chart.js breaks the line there.
 */
export function toTimePoints(points: ChartPoint[]): XyPoint[] {
    const out: XyPoint[] = []
    for (const p of points) {
        const ms =
            typeof p.x === 'number'
                ? p.x
                : Date.parse(TZ_LESS_ISO.test(p.x) ? `${p.x}Z` : p.x)
        if (Number.isNaN(ms)) continue
        out.push({ x: ms, y: p.y })
    }
    return out.sort((a, b) => a.x - b.x)
}

export function toLinearPoints(points: ChartPoint[]): XyPoint[] {
    const out: XyPoint[] = []
    for (const p of points) {
        const x = typeof p.x === 'number' ? p.x : Number(p.x)
        if (Number.isNaN(x)) continue
        out.push({ x, y: p.y })
    }
    return out.sort((a, b) => a.x - b.x)
}

/**
 * Category alignment: labels are the union of every series' x values in
 * first-appearance order; each dataset's data aligns to those labels with
 * null where a series has no value for a label.
 */
export function toCategoryData(series: ChartSeries[]): {
    labels: string[]
    rows: Array<Array<number | null>>
} {
    const labels: string[] = []
    const indexOf = new Map<string, number>()
    for (const s of series) {
        for (const p of s.points) {
            const key = String(p.x)
            if (!indexOf.has(key)) {
                indexOf.set(key, labels.length)
                labels.push(key)
            }
        }
    }
    const rows = series.map((s) => {
        const row: Array<number | null> = labels.map(() => null)
        for (const p of s.points) {
            row[indexOf.get(String(p.x)) as number] = p.y
        }
        return row
    })
    return { labels, rows }
}

/**
 * Tick formatter for an epoch-ms axis, granularity picked from the span:
 * hours within ~2 days, month+day up to ~1.5 years, month+year beyond.
 * Always UTC, matching the project's datetime conventions.
 */
export function makeTimeTickFormat(
    minMs: number,
    maxMs: number,
): (ms: number) => string {
    const span = maxMs - minMs
    const opts: Intl.DateTimeFormatOptions =
        span <= 2 * DAY_MS
            ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
            : span <= 550 * DAY_MS
              ? { month: 'short', day: 'numeric' }
              : { month: 'short', year: 'numeric' }
    const fmt = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' })
    return (ms) => fmt.format(new Date(ms))
}

const TOOLTIP_FMT = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
})

export function formatTooltipTime(ms: number): string {
    return TOOLTIP_FMT.format(new Date(ms))
}

function seriesBase(s: ChartSeries, i: number, theme: ChartTheme) {
    const color = s.color || theme.palette[i % theme.palette.length]
    return {
        name: s.label,
        type: s.style === 'bar' ? ('bar' as const) : ('line' as const),
        ...(s.style === 'area' ? { areaStyle: {} } : {}),
        itemStyle: { color },
        lineStyle: { width: 2 },
        symbolSize: 5,
        showSymbol: false,
        connectNulls: false,
    }
}

/** The preview zoom strip both layouts share: the series ghosted inside the
 *  slider in its own color, light default filler over it, dark end handles. */
function previewSlider(
    theme: ChartTheme,
    color: string,
    tickFormat: ((ms: number) => string) | null,
) {
    return {
        type: 'slider' as const,
        height: 30,
        bottom: 10,
        showDataShadow: true,
        brushSelect: false,
        borderColor: theme.gridColor,
        handleSize: '80%',
        handleStyle: { color: theme.textColor },
        moveHandleSize: 0,
        dataBackground: {
            lineStyle: { color, opacity: 0.6, width: 1 },
            areaStyle: { color, opacity: 0.08 },
        },
        ...(tickFormat
            ? { labelFormatter: (v: number) => tickFormat(v) }
            : {}),
    }
}

type TooltipParam = {
    marker: string
    seriesName: string
    value: [number, number | null]
}

/** Axis tooltip whose title is the hovered UTC datetime, not raw epoch ms. */
function timeTooltipFormatter(params: TooltipParam[] | TooltipParam): string {
    const list = Array.isArray(params) ? params : [params]
    if (list.length === 0) return ''
    const rows = list.map(
        (p) => `${p.marker}${p.seriesName}: ${p.value[1] ?? '—'}`,
    )
    return [formatTooltipTime(list[0].value[0]), ...rows].join('<br/>')
}

/**
 * The complete ECharts option for a payload. Typed loosely on purpose:
 * echarts' own option generics add nothing here and the object is validated
 * by rendering it.
 *
 * One variable is visible at a time (`visibleLabel`, default: the first
 * series) and the single-select legend is the picker. Same visual grammar
 * as the stacked variable card — clean line, sparse unnamed y-axis, preview
 * zoom strip in the visible variable's color; the card footer, not the
 * chart, names the variable and unit.
 */
export function buildChartOption(
    payload: ChartSeriesPayload,
    theme: ChartTheme,
    visibleLabel?: string,
): Record<string, any> {
    const visible = visibleLabel ?? payload.series[0]?.label
    const selected: Record<string, boolean> = {}
    for (const s of payload.series) selected[s.label] = s.label === visible

    const activeIndex = Math.max(
        payload.series.findIndex((s) => s.label === visible),
        0,
    )
    const activeSeries = payload.series[activeIndex]
    const activeColor =
        activeSeries?.color ||
        theme.palette[activeIndex % theme.palette.length]

    const yAxis = [
        {
            type: 'value' as const,
            scale: true,
            splitNumber: 2,
            axisLabel: { color: theme.textColor },
            splitLine: { show: false },
        },
    ]

    const common = {
        legend: {
            show: true,
            type: 'scroll' as const,
            selectedMode: 'single' as const,
            top: 0,
            left: 8,
            right: 8,
            textStyle: { color: theme.textColor },
            selected,
        },
        // Bottom band holds the x labels and the preview strip.
        grid: { left: 48, right: 12, top: 32, bottom: 84 },
        dataZoom: [
            { type: 'inside' as const, xAxisIndex: 0 },
            previewSlider(theme, activeColor, null),
        ],
        yAxis,
    }

    if (payload.xType === 'category') {
        const { labels, rows } = toCategoryData(payload.series)
        return {
            ...common,
            tooltip: { trigger: 'axis' as const },
            xAxis: {
                type: 'category' as const,
                data: labels,
                axisLabel: { color: theme.textColor },
            },
            series: payload.series.map((s, i) => ({
                ...seriesBase(s, i, theme),
                data: rows[i],
            })),
        }
    }

    const isTime = payload.xType === 'time'
    const series = payload.series.map((s, i) => {
        const points = isTime ? toTimePoints(s.points) : toLinearPoints(s.points)
        return {
            ...seriesBase(s, i, theme),
            data: points.map((p) => [p.x, p.y]),
        }
    })
    const xs = series.flatMap((s) => s.data.map((d) => d[0] as number))
    const tickFormat =
        isTime && xs.length > 0
            ? makeTimeTickFormat(Math.min(...xs), Math.max(...xs))
            : null

    return {
        ...common,
        // Drag labels on the slider show real dates, not epoch ms.
        dataZoom: common.dataZoom.map((z) =>
            z.type === 'slider' && tickFormat
                ? { ...z, labelFormatter: (v: number) => tickFormat(v) }
                : z,
        ),
        tooltip: {
            trigger: 'axis' as const,
            axisPointer: { type: 'cross' as const, label: { show: false } },
            ...(isTime ? { formatter: timeTooltipFormatter } : {}),
        },
        xAxis: {
            type: 'value' as const,
            min: 'dataMin' as const,
            max: 'dataMax' as const,
            axisLabel: {
                color: theme.textColor,
                hideOverlap: true,
                ...(tickFormat
                    ? { formatter: (v: number) => tickFormat(v) }
                    : {}),
            },
            splitLine: { show: false },
        },
        series,
    }
}

/**
 * One variable's card in the stacked layout: a single-series chart over a
 * preview zoom strip (the series redrawn inside the slider), per the design
 * reference. Sparse unlabeled axes — the card's footer chip, not the chart,
 * names the variable and unit. `index` fixes the palette slot so a variable
 * keeps its color no matter which subset of variables renders.
 */
export function buildVariableCardOption(
    s: ChartSeries,
    payload: ChartSeriesPayload,
    theme: ChartTheme,
    index: number,
): Record<string, any> {
    const isTime = payload.xType === 'time'
    const isCategory = payload.xType === 'category'
    const color = s.color || theme.palette[index % theme.palette.length]

    const category = isCategory ? toCategoryData([s]) : null
    const data: Array<[number, number | null]> | Array<number | null> = category
        ? category.rows[0]
        : (isTime ? toTimePoints(s.points) : toLinearPoints(s.points)).map(
              (p) => [p.x, p.y] as [number, number | null],
          )
    const xs = category
        ? []
        : (data as Array<[number, number | null]>).map((d) => d[0])
    const tickFormat =
        isTime && xs.length > 0
            ? makeTimeTickFormat(Math.min(...xs), Math.max(...xs))
            : null

    return {
        tooltip: {
            trigger: 'axis' as const,
            axisPointer: { type: 'cross' as const, label: { show: false } },
            ...(isTime ? { formatter: timeTooltipFormatter } : {}),
        },
        // Bottom band holds the x labels and the preview strip.
        grid: { left: 48, right: 12, top: 12, bottom: 84 },
        xAxis: {
            ...(category
                ? { type: 'category' as const, data: category.labels }
                : {
                      type: 'value' as const,
                      min: 'dataMin' as const,
                      max: 'dataMax' as const,
                      splitLine: { show: false },
                  }),
            axisLabel: {
                color: theme.textColor,
                hideOverlap: true,
                ...(tickFormat
                    ? { formatter: (v: number) => tickFormat(v) }
                    : {}),
            },
        },
        yAxis: {
            type: 'value' as const,
            scale: true,
            // A handful of unnamed ticks — identity and unit live in the
            // card footer, so the plot stays clean like the reference.
            splitNumber: 2,
            axisLabel: { color: theme.textColor },
            splitLine: { show: false },
        },
        series: [
            {
                ...seriesBase(s, index, theme),
                data,
            },
        ],
        dataZoom: [
            { type: 'inside' as const },
            previewSlider(theme, color, tickFormat),
        ],
    }
}

/**
 * A variable's points as a two-column CSV, `x` then the series label.
 * `y: null` gaps become empty cells; fields with commas/quotes are quoted.
 */
export function seriesToCsv(s: ChartSeries): string {
    const esc = (v: string) =>
        /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const rows = s.points.map((p) => `${esc(String(p.x))},${p.y ?? ''}`)
    return [`x,${esc(s.label)}`, ...rows].join('\n')
}
