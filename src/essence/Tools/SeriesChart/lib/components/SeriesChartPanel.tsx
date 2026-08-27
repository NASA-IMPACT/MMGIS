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
                    <CardErrorBoundary resetOn={state}>
                        {state.status === 'loading' && (
                            <>
                                <CardHeader title={state.title ?? 'Loading…'} />
                                <div
                                    className="series-chart__status"
                                    aria-live="polite"
                                >
                                    <span
                                        className="series-chart__spinner"
                                        aria-hidden="true"
                                    />
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
                    </CardErrorBoundary>
                </article>
            ))}
        </div>
    )
}

/** One bad payload must cost its own card, not the panel — a render throw
 *  here would otherwise unmount the whole adapter root. A fresh CardState
 *  (any new bus event for this chartId) retries the render. */
export class CardErrorBoundary extends React.Component<
    { resetOn: unknown; children: React.ReactNode },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null }

    static getDerivedStateFromError(error: Error) {
        return { error }
    }

    componentDidUpdate(prevProps: { resetOn: unknown }) {
        if (prevProps.resetOn !== this.props.resetOn && this.state.error)
            this.setState({ error: null })
    }

    render() {
        if (this.state.error)
            return (
                <p className="series-chart__error" role="alert">
                    Could not render this chart.
                </p>
            )
        return this.props.children
    }
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
    const [activeLabel, setActiveLabel] = React.useState(
        payload.series[0]?.label,
    )
    useEffect(() => {
        setActiveLabel(payload.series[0]?.label)
    }, [payload])

    if (layout === 'stacked') {
        // One sub-card per variable, each with its own preview-strip zoom —
        // no shared reset button; dragging a card's strip is its reset. The
        // list is capped so a many-variable payload scrolls inside its card
        // instead of swallowing the panel.
        return (
            <>
                <CardHeader title={payload.title} />
                <div className="series-chart__variable-list">
                    {payload.series.map((s, i) => (
                        <VariableCard
                            key={s.id}
                            series={s}
                            payload={payload}
                            index={i}
                        />
                    ))}
                </div>
            </>
        )
    }

    const activeIndex = Math.max(
        payload.series.findIndex((s) => s.label === activeLabel),
        0,
    )
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
            <SeriesCanvas
                payload={payload}
                chartRef={chartRef}
                onVisibleChange={setActiveLabel}
            />
            {payload.series[activeIndex] && (
                <CardFooter
                    series={payload.series[activeIndex]}
                    index={activeIndex}
                />
            )}
        </>
    )
}

/** The palette's [token, fallback] pairs, the single source both color paths
 *  derive from: themeFromCss resolves them for the chart canvas, PALETTE_VARS
 *  turns the same list into var() strings for DOM styles — so a variable's
 *  footer dot and its chart line always land on the same theme color. */
const PALETTE_TOKENS: Array<[string, string]> = [
    ['--theme-color-primary', '#005ea2'],
    ['--theme-color-accent-cool', '#00bde3'],
    ['--theme-color-accent-warm', '#fa9441'],
    ['--theme-color-secondary', '#d83933'],
]

const PALETTE_VARS = PALETTE_TOKENS.map(
    ([token, fallback]) => `var(${token}, ${fallback})`,
)

/** Theme colors come from the page's --theme-* custom properties so the chart
 *  follows the active USWDS theme bundle; fallbacks are the USWDS defaults. */
function themeFromCss(el: HTMLElement): ChartTheme {
    const styles = getComputedStyle(el)
    const v = (name: string, fallback: string) =>
        styles.getPropertyValue(name).trim() || fallback
    return {
        palette: PALETTE_TOKENS.map(([token, fallback]) => v(token, fallback)),
        gridColor: v('--theme-color-base-lighter', '#dfe1e2'),
        textColor: v('--theme-color-base-dark', '#565c65'),
    }
}

function SeriesCanvas({
    payload,
    chartRef,
    onVisibleChange,
}: {
    payload: ChartSeriesPayload
    chartRef?: React.MutableRefObject<echarts.ECharts | null>
    /** Fires with the picked variable's label so the card footer follows.
     *  Must be identity-stable (e.g. a setState) — it's an effect dep. */
    onVisibleChange?: (label: string) => void
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

        // Single-select legend is the variable picker; rebuild so the preview
        // strip recolors to the picked variable, keeping the zoom range.
        // Re-clicking the active chip would empty the chart — keep it on.
        // The zoom carries over as slider percentages, not an absolute time
        // window — identical for same-grid variables, relative otherwise.
        chart.on('legendselectchanged', (e) => {
            const event = e as {
                name: string
                selected: Record<string, boolean>
            }
            visible = event.selected[event.name] ? event.name : visible
            if (visible) onVisibleChange?.(visible)
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
    }, [payload, chartRef, onVisibleChange])

    return <div className="series-chart__canvas-wrap" ref={hostRef} />
}

function downloadCsv(s: ChartSeries) {
    const blob = new Blob([seriesToCsv(s)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.label.replace(/[^\w.-]+/g, '_') || 'series'}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

/** The footer both layouts share: colored dot naming the variable (with
 *  unit), the interaction hint, and that variable's CSV download. */
function CardFooter({ series, index }: { series: ChartSeries; index: number }) {
    return (
        <footer className="series-chart__variable-footer">
            <div>
                <span className="series-chart__variable-chip">
                    <span
                        className="series-chart__variable-dot"
                        style={{
                            background:
                                series.color ||
                                PALETTE_VARS[index % PALETTE_VARS.length],
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
    )
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
            <CardFooter series={series} index={index} />
        </section>
    )
}
