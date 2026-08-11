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

/** Vertical space one stacked row occupies (title band + plot). */
const STACKED_ROW = 150
/** Below the last row: its x-axis labels plus the shared zoom slider. */
const STACKED_EXTRA = 48

/** Canvas height for a stacked option of `n` variables. */
export function stackedChartHeight(n: number): number {
    return Math.max(n, 1) * STACKED_ROW + STACKED_EXTRA
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
        connectNulls: false,
    }
}

function sliderZoom(theme: ChartTheme, xAxisIndex: number | number[]) {
    return {
        type: 'slider' as const,
        xAxisIndex,
        // Slim range-input look: grey track, solid primary fill,
        // round handles, no border, no data preview, no move grip.
        height: 8,
        bottom: 10,
        showDataShadow: false,
        brushSelect: false,
        borderColor: 'transparent',
        backgroundColor: theme.gridColor,
        fillerColor: theme.palette[0],
        handleIcon: 'circle',
        handleSize: 14,
        handleStyle: {
            color: theme.palette[0],
            borderColor: theme.surface,
            borderWidth: 1,
        },
        moveHandleSize: 0,
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
 * series); the single-select legend is the picker and the y-axis is named
 * for the visible variable's unit.
 */
export function buildChartOption(
    payload: ChartSeriesPayload,
    theme: ChartTheme,
    visibleLabel?: string,
): Record<string, any> {
    const visible = visibleLabel ?? payload.series[0]?.label
    const selected: Record<string, boolean> = {}
    for (const s of payload.series) selected[s.label] = s.label === visible

    const activeSeries = payload.series.find((s) => s.label === visible)
    const yTitle = payload.yLabel ?? activeSeries?.unit ?? null

    const yAxis = [
        {
            type: 'value' as const,
            scale: true,
            name: yTitle ?? undefined,
            nameLocation: 'middle' as const,
            nameGap: 42,
            nameTextStyle: { color: theme.textColor },
            axisLabel: { color: theme.textColor },
            splitLine: { lineStyle: { color: theme.gridColor } },
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
        grid: { left: 56, right: 16, top: 32, bottom: 44 },
        dataZoom: [
            { type: 'inside' as const, xAxisIndex: 0 },
            sliderZoom(theme, 0),
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
 * Stacked small-multiples option: one grid row per variable with its own
 * unit-named y-axis. The x-axes are linked (`axisPointer.link`) and one
 * zoom pair drives them all, so hovering or zooming any row moves every
 * row together. No legend — each variable is always visible in its row,
 * titled by the series label. The canvas must be `stackedChartHeight(n)`
 * tall for the pixel-positioned grids to land inside it.
 */
export function buildStackedChartOption(
    payload: ChartSeriesPayload,
    theme: ChartTheme,
): Record<string, any> {
    const n = payload.series.length
    const allX = payload.series.map((_, i) => i)
    const isTime = payload.xType === 'time'
    const isCategory = payload.xType === 'category'

    const category = isCategory ? toCategoryData(payload.series) : null
    const data: Array<Array<[number, number | null]> | Array<number | null>> =
        category
            ? category.rows
            : payload.series.map((s) =>
                  (isTime ? toTimePoints(s.points) : toLinearPoints(s.points)).map(
                      (p) => [p.x, p.y] as [number, number | null],
                  ),
              )
    const xs = category
        ? []
        : (data as Array<Array<[number, number | null]>>).flatMap((d) =>
              d.map((p) => p[0]),
          )
    const tickFormat =
        isTime && xs.length > 0
            ? makeTimeTickFormat(Math.min(...xs), Math.max(...xs))
            : null

    const title: Array<Record<string, any>> = []
    const grid: Array<Record<string, any>> = []
    const xAxis: Array<Record<string, any>> = []
    const yAxis: Array<Record<string, any>> = []
    const series: Array<Record<string, any>> = []

    payload.series.forEach((s, i) => {
        const rowTop = i * STACKED_ROW
        // Only the bottom row prints x labels — the rows above share its axis
        // via the link, and repeating the labels n times just eats plot height.
        const isBottom = i === n - 1
        title.push({
            text: s.label,
            top: rowTop + 2,
            left: 8,
            textStyle: {
                fontSize: 12,
                fontWeight: 600,
                color: theme.textColor,
            },
        })
        grid.push({
            left: 56,
            right: 16,
            top: rowTop + 28,
            height: STACKED_ROW - 40,
        })
        xAxis.push({
            gridIndex: i,
            ...(category
                ? { type: 'category' as const, data: category.labels }
                : {
                      type: 'value' as const,
                      min: 'dataMin' as const,
                      max: 'dataMax' as const,
                      splitLine: { show: false },
                  }),
            axisLabel: {
                show: isBottom,
                color: theme.textColor,
                hideOverlap: true,
                ...(tickFormat
                    ? { formatter: (v: number) => tickFormat(v) }
                    : {}),
            },
        })
        yAxis.push({
            gridIndex: i,
            type: 'value' as const,
            scale: true,
            name: s.unit ?? payload.yLabel ?? undefined,
            nameLocation: 'middle' as const,
            nameGap: 42,
            nameTextStyle: { color: theme.textColor },
            axisLabel: { color: theme.textColor },
            splitLine: { lineStyle: { color: theme.gridColor } },
        })
        series.push({
            ...seriesBase(s, i, theme),
            xAxisIndex: i,
            yAxisIndex: i,
            data: data[i],
        })
    })

    const slider = sliderZoom(theme, allX)
    return {
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        tooltip: {
            trigger: 'axis' as const,
            axisPointer: { type: 'cross' as const, label: { show: false } },
            ...(isTime ? { formatter: timeTooltipFormatter } : {}),
        },
        title,
        grid,
        xAxis,
        yAxis,
        series,
        dataZoom: [
            { type: 'inside' as const, xAxisIndex: allX },
            tickFormat
                ? { ...slider, labelFormatter: (v: number) => tickFormat(v) }
                : slider,
        ],
    }
}
