import React, { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type {
    ChartSeries,
    ChartSeriesPayload,
} from '../../../_shared/types/chartSeries'
import type { ChartCard, ChartLayout, ChartTheme } from '../types'
import {
    buildChartOption,
    buildVariableCardOption,
    seriesToCsv,
} from '../chartData'

export interface SeriesChartPanelProps {
    cards: ChartCard[]
    layout?: ChartLayout
}

/** Presentational panel: one card per chartId; placeholder when idle. */
export function SeriesChartPanel({
    cards,
    layout = 'single',
}: SeriesChartPanelProps) {
    return (
        <div className="series-chart" role="region" aria-label="Charts">
            {cards.length === 0 && (
                <p className="series-chart__placeholder">
                    Select something on the map to chart it here.
                </p>
            )}
            {cards.map(({ chartId, state }) => (
                <article key={chartId} className="series-chart__card">
                    {state.status === 'loading' && (
                        <>
                            <CardHeader title={state.title ?? 'Loading…'} />
                            <div className="series-chart__status" aria-live="polite">
                                <span className="series-chart__spinner" aria-hidden="true" />
                                Fetching data…
                            </div>
                        </>
                    )}
                    {state.status === 'error' && (
                        <>
                            <CardHeader title={state.title ?? 'Chart'} />
                            <p className="series-chart__error" role="alert">
                                {state.message}
                            </p>
                        </>
                    )}
                    {state.status === 'ready' && (
                        <ReadyCard payload={state.payload} layout={layout} />
                    )}
                </article>
            ))}
        </div>
    )
}

function CardHeader({
    title,
    onResetZoom,
}: {
    title: string
    onResetZoom?: () => void
}) {
    return (
        <header className="series-chart__card-header">
            <div className="series-chart__card-heading">
                <h3 className="series-chart__title">{title}</h3>
                {onResetZoom && (
                    <button
                        type="button"
                        className="series-chart__reset-btn"
                        onClick={onResetZoom}
                        title="Reset zoom"
                        aria-label="Reset zoom"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                            focusable="false"
                        >
                            <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                        </svg>
                    </button>
                )}
            </div>
        </header>
    )
}

function ReadyCard({
    payload,
    layout,
}: {
    payload: ChartSeriesPayload
    layout: ChartLayout
}) {
    const chartRef = useRef<echarts.ECharts | null>(null)
    if (layout === 'stacked') {
        // One sub-card per variable, each with its own preview-strip zoom —
        // no shared reset button; dragging a card's strip is its reset.
        return (
            <>
                <CardHeader title={payload.title} />
                {payload.series.map((s, i) => (
                    <VariableCard
                        key={s.id}
                        series={s}
                        payload={payload}
                        index={i}
                    />
                ))}
            </>
        )
    }
    return (
        <>
            <CardHeader
                title={payload.title}
                onResetZoom={() =>
                    chartRef.current?.dispatchAction({
                        type: 'dataZoom',
                        start: 0,
                        end: 100,
                    })
                }
            />
            <SeriesCanvas payload={payload} chartRef={chartRef} />
        </>
    )
}

/** Theme colors come from the page's --theme-* custom properties so the chart
 *  follows the active USWDS theme bundle; fallbacks are the USWDS defaults. */
function themeFromCss(el: HTMLElement): ChartTheme {
    const styles = getComputedStyle(el)
    const v = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback
    return {
        palette: [
            v('--theme-color-primary', '#005ea2'),
            v('--theme-color-accent-cool', '#00bde3'),
            v('--theme-color-accent-warm', '#fa9441'),
            v('--theme-color-secondary', '#d83933'),
        ],
        gridColor: v('--theme-color-base-lighter', '#dfe1e2'),
        textColor: v('--theme-color-base-dark', '#565c65'),
        surface: v('--theme-color-white', '#ffffff'),
    }
}

function SeriesCanvas({
    payload,
    chartRef,
}: {
    payload: ChartSeriesPayload
    chartRef?: React.MutableRefObject<echarts.ECharts | null>
}) {
    const hostRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const chart = echarts.init(host)
        if (chartRef) chartRef.current = chart
        const theme = themeFromCss(host)
        let visible = payload.series[0]?.label
        chart.setOption(buildChartOption(payload, theme, visible) as never)

        // Single-select legend is the variable picker; rebuild so the y-axis
        // renames to the picked variable's unit, keeping the zoom range.
        // Re-clicking the active chip would empty the chart — keep it on.
        chart.on('legendselectchanged', (e) => {
            const event = e as {
                name: string
                selected: Record<string, boolean>
            }
            visible = event.selected[event.name] ? event.name : visible
            const zoom = (
                chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number }> }
            ).dataZoom?.[0]
            const option = buildChartOption(payload, theme, visible)
            if (zoom && Array.isArray(option.dataZoom)) {
                option.dataZoom = option.dataZoom.map((z: Record<string, unknown>) => ({
                    ...z,
                    start: zoom.start,
                    end: zoom.end,
                }))
            }
            chart.setOption(option as never, { notMerge: true })
        })

        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(host)
        return () => {
            observer.disconnect()
            if (chartRef?.current === chart) chartRef.current = null
            chart.dispose()
        }
    }, [payload, chartRef])

    return <div className="series-chart__canvas-wrap" ref={hostRef} />
}

/** CSS vars in the order themeFromCss builds its palette, so a variable's
 *  footer dot and its chart line resolve to the same theme color. */
const PALETTE_VARS = [
    '--theme-color-primary',
    '--theme-color-accent-cool',
    '--theme-color-accent-warm',
    '--theme-color-secondary',
]

function downloadCsv(s: ChartSeries) {
    const blob = new Blob([seriesToCsv(s)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.label.replace(/[^\w.-]+/g, '_') || 'series'}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

function VariableCard({
    series,
    payload,
    index,
}: {
    series: ChartSeries
    payload: ChartSeriesPayload
    index: number
}) {
    const hostRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const chart = echarts.init(host)
        const theme = themeFromCss(host)
        chart.setOption(
            buildVariableCardOption(series, payload, theme, index) as never,
        )
        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(host)
        return () => {
            observer.disconnect()
            chart.dispose()
        }
    }, [series, payload, index])

    return (
        <section className="series-chart__variable-card">
            <div className="series-chart__variable-canvas" ref={hostRef} />
            <footer className="series-chart__variable-footer">
                <div>
                    <span className="series-chart__variable-chip">
                        <span
                            className="series-chart__variable-dot"
                            style={{
                                background:
                                    series.color ||
                                    `var(${PALETTE_VARS[index % PALETTE_VARS.length]})`,
                            }}
                            aria-hidden="true"
                        />
                        {series.label}
                        {series.unit && (
                            <span className="series-chart__variable-unit">
                                {series.unit}
                            </span>
                        )}
                    </span>
                    <p className="series-chart__variable-hint">
                        Hover to inspect · drag the strip to zoom
                    </p>
                </div>
                <button
                    type="button"
                    className="series-chart__csv-link"
                    onClick={() => downloadCsv(series)}
                >
                    Download CSV
                </button>
            </footer>
        </section>
    )
}

export default SeriesChartPanel
