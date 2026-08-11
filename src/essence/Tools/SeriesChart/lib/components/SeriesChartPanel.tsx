import React, { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { ChartSeriesPayload } from '../../../_shared/types/chartSeries'
import type { ChartCard, ChartLayout, ChartTheme } from '../types'
import {
    buildChartOption,
    buildStackedChartOption,
    stackedChartHeight,
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
            <SeriesCanvas payload={payload} layout={layout} chartRef={chartRef} />
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
    layout,
    chartRef,
}: {
    payload: ChartSeriesPayload
    layout: ChartLayout
    chartRef?: React.MutableRefObject<echarts.ECharts | null>
}) {
    const hostRef = useRef<HTMLDivElement>(null)
    const stacked = layout === 'stacked'

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const chart = echarts.init(host)
        if (chartRef) chartRef.current = chart
        const theme = themeFromCss(host)

        if (stacked) {
            chart.setOption(buildStackedChartOption(payload, theme) as never)
        } else {
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
        }

        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(host)
        return () => {
            observer.disconnect()
            if (chartRef?.current === chart) chartRef.current = null
            chart.dispose()
        }
    }, [payload, stacked, chartRef])

    return (
        <div
            className="series-chart__canvas-wrap"
            ref={hostRef}
            // Stacked grids are pixel-positioned per row, so the canvas must
            // grow with the variable count; the default height suits one grid.
            style={
                stacked
                    ? { height: stackedChartHeight(payload.series.length) }
                    : undefined
            }
        />
    )
}

export default SeriesChartPanel
