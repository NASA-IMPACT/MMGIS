// Pure payload → ECharts option translation. No DOM, no echarts import —
// the output is a plain option object the rendering component hands to
// `chart.setOption(...)`, which keeps everything here unit-testable.
//
// The x axis is echarts' own 'time' axis, so ticks land on calendar
// boundaries (whole hours, days, months) rather than on round millisecond
// counts; `useUTC` keeps those boundaries UTC, and our formatters own the
// label text so every viewer reads the same timestamps.

import type { ChartPoint, ChartSeries } from '../../_shared/types/chartSeries'
import type { ChartTheme } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export interface XyPoint {
    x: number
    y: number | null
}

/** Timezone-less ISO datetimes (common in OGC feature APIs) are read as UTC —
 *  Date.parse would use the viewer's local zone, shifting points per user.
 *  Covers both the T-separated form and the space-separated one common from
 *  Postgres/pandas exports. */
const TZ_LESS_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/**
 * Converts a series' points for a time axis: ISO datetime → epoch ms,
 * dropping unparseable x values (a bad timestamp shouldn't sink the series).
 * `y: null` gaps pass through — `connectNulls: false` breaks the line there.
 */
export function toTimePoints(points: ChartPoint[]): XyPoint[] {
    const out: XyPoint[] = []
    for (const p of points) {
        const ms =
            typeof p.x === 'number'
                ? p.x
                : Date.parse(
                      TZ_LESS_ISO.test(p.x)
                          ? `${p.x.replace(' ', 'T')}Z`
                          : p.x,
                  )
        if (Number.isNaN(ms)) continue
        out.push({ x: ms, y: p.y })
    }
    return out.sort((a, b) => a.x - b.x)
}

const utcDayOf = (ms: number) => Math.floor(ms / DAY_MS)

/**
 * Tick formatter for an epoch-ms axis, granularity picked from the span:
 * hours+minutes inside one UTC day, day+hours across a midnight within ~2
 * days (a bare clock would hide the day change), month+day up to ~1.5
 * years, month+year beyond. Always UTC, matching the project's datetime
 * conventions.
 */
export function makeTimeTickFormat(
    minMs: number,
    maxMs: number,
): (ms: number) => string {
    const span = maxMs - minMs
    const opts: Intl.DateTimeFormatOptions =
        utcDayOf(minMs) === utcDayOf(maxMs)
            ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
            : span <= 2 * DAY_MS
              ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
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

/** Axis tick labels, sized for a card a few hundred pixels wide. */
function axisLabel(theme: ChartTheme) {
    return { color: theme.textColor, fontSize: 10 }
}

/** A series' own color wins; otherwise its variable index walks the palette. */
export function seriesColor(
    s: ChartSeries,
    index: number,
    palette: readonly string[],
): string {
    return s.color || palette[index % palette.length]
}

function seriesBase(s: ChartSeries, i: number, theme: ChartTheme) {
    const color = seriesColor(s, i, theme.palette)
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

/** Space the plot keeps on each side of the canvas. Left and right match so
 *  the plot sits centred; `containLabel` fits the tick labels inside it. */
const SIDE_MARGIN = 12
/** The strip's height and its gap to the canvas bottom. */
const SLIDER_HEIGHT = 24
const SLIDER_BOTTOM = 6
/** Height of the row above the strip that holds the window's start and
 *  end dates (drawn by the panel over the canvas, see WINDOW_LABEL_LAYOUT). */
const WINDOW_LABEL_ROW = 16

/** Where the panel places the window dates: in the row above the strip,
 *  flush with the strip's ends. */
export const WINDOW_LABEL_LAYOUT = {
    side: SIDE_MARGIN,
    bottom: SLIDER_BOTTOM + SLIDER_HEIGHT + 2,
}

/** The preview zoom strip under the chart: the series ghosted inside the
 *  slider in its own color, light default filler over it, dark end handles.
 *  It spans the canvas between the side margins, so the window labels above
 *  it can sit at its ends; they replace the slider's own hover-only labels. */
function previewSlider(theme: ChartTheme, color: string) {
    return {
        type: 'slider' as const,
        height: SLIDER_HEIGHT,
        bottom: SLIDER_BOTTOM,
        left: SIDE_MARGIN,
        right: SIDE_MARGIN,
        showDetail: false,
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
    }
}

const WINDOW_DATE_FMT = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
})

/** The format for the zoom window's ends: the date, plus the clock when the
 *  whole series spans two days or less, where the date alone would repeat. */
export function makeWindowLabelFormat(
    minMs: number,
    maxMs: number,
): (ms: number) => string {
    if (maxMs - minMs <= 2 * DAY_MS) return formatTooltipTime
    return (ms) => WINDOW_DATE_FMT.format(new Date(ms))
}

/** The zoom window, in epoch ms, for the slider's start/end percentages of
 *  the series' time extent (the x axis runs dataMin to dataMax). */
export function windowAt(
    extent: [number, number],
    startPct: number,
    endPct: number,
): [number, number] {
    const [min, max] = extent
    const at = (pct: number) => min + ((max - min) * pct) / 100
    return [at(startPct), at(endPct)]
}

/** Min/max via a loop — `Math.min(...xs)` overflows the engine's argument
 *  limit past ~100k points, which real hourly multi-year feeds reach. */
function extentOf(values: ArrayLike<number>): [number, number] | null {
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < values.length; i++) {
        const v = values[i]
        if (v < min) min = v
        if (v > max) max = v
    }
    return min <= max ? [min, max] : null
}

type TooltipParam = {
    marker: string
    seriesName: string
    value: [number, number | null]
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}
const escapeHtml = (text: string) =>
    text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])

/** Axis tooltip whose title is the hovered UTC datetime, not raw epoch ms,
 *  with the value carrying the series' unit. echarts writes this string
 *  with innerHTML, and the series name and unit come off the wire (a
 *  groupBy value from the remote API), so both are escaped. */
function makeTooltipFormatter(unit?: string) {
    const suffix = unit ? ` ${escapeHtml(unit)}` : ''
    return (params: TooltipParam[] | TooltipParam): string => {
        const list = Array.isArray(params) ? params : [params]
        if (list.length === 0) return ''
        const rows = list.map((p) =>
            p.value[1] == null
                ? `${p.marker}${escapeHtml(p.seriesName)}: —`
                : `${p.marker}${escapeHtml(p.seriesName)}: ${p.value[1]}${suffix}`,
        )
        return [formatTooltipTime(list[0].value[0]), ...rows].join('<br/>')
    }
}

/**
 * The ECharts option for one variable: a single-series chart over a preview
 * zoom strip (the series redrawn inside the slider). The card's footer chip,
 * not the plot, names the variable and its unit; the tooltip repeats the
 * unit beside each value.
 * `index` is the variable's position in the payload, so it keeps its palette
 * slot whichever variable is picked. Typed loosely on purpose: echarts' own
 * option generics add nothing here and the object is validated by rendering.
 */
export function buildChartOption(
    s: ChartSeries,
    theme: ChartTheme,
    index: number,
): Record<string, any> {
    return buildChart(s, theme, index).option
}

export interface ChartModel {
    option: Record<string, any>
    /** The zoom window's start and end dates for the slider's start/end
     *  percentages; null for a series with no readable times. */
    windowText: (startPct: number, endPct: number) => [string, string] | null
}

/** The chart option together with the zoom window's dates, both from one
 *  pass over the points. */
export function buildChart(
    s: ChartSeries,
    theme: ChartTheme,
    index: number,
): ChartModel {
    const color = seriesColor(s, index, theme.palette)

    const data = toTimePoints(s.points).map(
        (p) => [p.x, p.y] as [number, number | null],
    )
    const xExtent = extentOf(data.map((d) => d[0]))
    const tickFormat = xExtent
        ? makeTimeTickFormat(xExtent[0], xExtent[1])
        : null
    const windowFormat = xExtent
        ? makeWindowLabelFormat(xExtent[0], xExtent[1])
        : null
    const windowText = (startPct: number, endPct: number): [string, string] | null => {
        if (!xExtent || !windowFormat) return null
        const [start, end] = windowAt(xExtent, startPct, endPct)
        return [windowFormat(start), windowFormat(end)]
    }

    const option = {
        useUTC: true,
        tooltip: {
            trigger: 'axis' as const,
            axisPointer: { type: 'cross' as const, label: { show: false } },
            formatter: makeTooltipFormatter(s.unit),
            // The panel clips its overflow; on the body the tooltip floats
            // over every panel instead of being cut off at the card's edge.
            appendTo: 'body',
            extraCssText: 'z-index: 999999;',
        },
        // The bottom band holds the preview strip and the window dates above
        // it; the x labels sit inside the grid via containLabel.
        grid: {
            left: SIDE_MARGIN,
            right: SIDE_MARGIN,
            top: 8,
            bottom: SLIDER_BOTTOM + SLIDER_HEIGHT + WINDOW_LABEL_ROW + 8,
            containLabel: true,
        },
        xAxis: {
            type: 'time' as const,
            min: 'dataMin' as const,
            max: 'dataMax' as const,
            splitLine: { show: false },
            axisLabel: {
                ...axisLabel(theme),
                hideOverlap: true,
                ...(tickFormat
                    ? { formatter: (v: number) => tickFormat(v) }
                    : {}),
            },
        },
        yAxis: {
            type: 'value' as const,
            scale: true,
            // A handful of unnamed ticks keeps the plot clean; the footer
            // chip says what they count.
            splitNumber: 2,
            // The crosshair's horizontal line is only a guide. Left to
            // trigger the tooltip, it adds a second row for the point
            // nearest the cursor's height, repeating the series.
            axisPointer: { triggerTooltip: false },
            axisLabel: axisLabel(theme),
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
            previewSlider(theme, color),
        ],
    }
    return { option, windowText }
}

/**
 * A variable's points as a two-column CSV, `timestamp` then the series
 * label. `y: null` gaps become empty cells; fields with commas/quotes are
 * quoted.
 */
export function seriesToCsv(s: ChartSeries): string {
    const esc = (v: string) =>
        /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const rows = s.points.map((p) => `${esc(String(p.x))},${p.y ?? ''}`)
    return [`timestamp,${esc(s.label)}`, ...rows].join('\n')
}
