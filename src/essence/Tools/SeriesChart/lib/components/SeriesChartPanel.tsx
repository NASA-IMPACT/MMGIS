import React, { useEffect, useId, useRef, useState } from 'react'
import * as echarts from 'echarts'
import type {
    ChartSeries,
    ChartSeriesPayload,
} from '../../../_shared/types/chartSeries'
import type { ChartCard, ChartLayout, ChartTheme } from '../types'
import { buildChart, seriesToCsv, WINDOW_LABEL_LAYOUT } from '../chartData'
import { grabCursorOnSlider } from '../sliderCursors'
import { FloatingPopover } from '../../../Timeline/lib'

export interface SeriesChartPanelProps {
    cards: ChartCard[]
    layout?: ChartLayout
}

/** Presentational panel: one card per chartId; placeholder when idle. */
export function SeriesChartPanel({
    cards,
    layout = 'dropdown',
}: SeriesChartPanelProps) {
    return (
        <div className="series-chart" role="region" aria-label="Charts">
            {cards.length === 0 && (
                <p className="series-chart__placeholder">
                    Select something on the map to chart it here.
                </p>
            )}
            {cards.map(({ chartId, payload }) => (
                <article key={chartId} className="series-chart__card">
                    <CardErrorBoundary resetOn={payload}>
                        <ReadyCard payload={payload} layout={layout} />
                    </CardErrorBoundary>
                </article>
            ))}
        </div>
    )
}

/** One bad payload must cost its own card, not the panel — a render throw
 *  here would otherwise unmount the whole adapter root. A fresh payload for
 *  this chartId retries the render. */
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

/** How to read and zoom the chart, shown only when asked for — the same
 *  info button and popover the Timeline uses for its controls. */
function ChartInfo() {
    const [open, setOpen] = useState(false)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const popupId = useId()
    return (
        <>
            <button
                type="button"
                ref={buttonRef}
                className="series-chart__info-btn"
                onClick={() => setOpen((o) => !o)}
                title="Info"
                aria-label="Chart controls help"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? popupId : undefined}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                    <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                </svg>
            </button>
            <FloatingPopover
                id={popupId}
                anchorRef={buttonRef}
                isOpen={open}
                onClose={() => setOpen(false)}
                placement="bottom"
                offset={8}
                className="series-chart-info-portal"
                label="Chart controls"
            >
                <div className="series-chart-info-portal__content">
                    <strong>Chart Controls</strong>
                    <p>
                        Hover to read values • Scroll or drag on the chart to
                        zoom and pan • In the strip below, drag an end handle
                        to resize the window, or drag its middle to move it
                    </p>
                </div>
            </FloatingPopover>
        </>
    )
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <header className="series-chart__card-header">
            <div className="series-chart__title-row">
                <h3 className="series-chart__title" title={title}>
                    {title}
                </h3>
                <ChartInfo />
            </div>
            {subtitle && <p className="series-chart__section">{subtitle}</p>}
        </header>
    )
}

/** One variable at a time: when the payload carries several, the picker
 *  (a dropdown, or a row of buttons in the list layout) chooses it, and the
 *  chart, footer chip and CSV follow the pick. */
function ReadyCard({
    payload,
    layout,
}: {
    payload: ChartSeriesPayload
    layout: ChartLayout
}) {
    const [pickedId, setPickedId] = useState(payload.series[0].id)
    useEffect(() => {
        setPickedId((prev) =>
            payload.series.some((s) => s.id === prev)
                ? prev
                : payload.series[0].id,
        )
    }, [payload])

    // The payload guard rejects an empty series, so index 0 always exists.
    const index = Math.max(
        payload.series.findIndex((s) => s.id === pickedId),
        0,
    )
    const picked = payload.series[index]

    return (
        <>
            <CardHeader title={payload.title} subtitle={payload.subtitle} />
            {payload.series.length > 1 && layout === 'list' && (
                <div
                    className="series-chart__variable-tabs"
                    role="group"
                    aria-label="Variable"
                >
                    {payload.series.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            className={
                                'series-chart__variable-tab' +
                                (s.id === picked.id
                                    ? ' series-chart__variable-tab--selected'
                                    : '')
                            }
                            aria-pressed={s.id === picked.id}
                            onClick={() => setPickedId(s.id)}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            )}
            {payload.series.length > 1 && layout === 'dropdown' && (
                <label className="series-chart__picker">
                    <span className="series-chart__picker-label">Variable</span>
                    <select
                        className="series-chart__picker-select"
                        value={picked.id}
                        onChange={(e) => setPickedId(e.target.value)}
                    >
                        {payload.series.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.label}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <section className="series-chart__plot">
                <SeriesCanvas series={picked} index={index} />
                <CardFooter series={picked} index={index} />
            </section>
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

function SeriesCanvas({ series, index }: { series: ChartSeries; index: number }) {
    const hostRef = useRef<HTMLDivElement>(null)
    const [windowDates, setWindowDates] = useState<[string, string] | null>(null)

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const chart = echarts.init(host)
        const { option, windowText } = buildChart(series, themeFromCss(host), index)
        chart.setOption(option as never)
        setWindowDates(windowText(0, 100))
        // The window dates follow every zoom, whether from the strip or from
        // scrolling on the plot (the two share one window). They are page
        // text, not chart shapes: a setOption mid-drag would rebuild the
        // strip under the pointer and drop the drag.
        const onZoom = () => {
            const zoom = (chart.getOption() as {
                dataZoom?: Array<{ start?: number; end?: number }>
            }).dataZoom?.[0]
            setWindowDates(windowText(zoom?.start ?? 0, zoom?.end ?? 100))
        }
        chart.on('datazoom', onZoom)
        const releaseCursor = grabCursorOnSlider(chart)
        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(host)
        return () => {
            releaseCursor()
            chart.off('datazoom', onZoom)
            observer.disconnect()
            chart.dispose()
        }
    }, [series, index])

    const { side, bottom } = WINDOW_LABEL_LAYOUT
    return (
        <div className="series-chart__canvas-wrap">
            <div className="series-chart__canvas" ref={hostRef} />
            {windowDates && (
                <div
                    className="series-chart__window"
                    style={{ left: side, right: side, bottom }}
                    aria-label="Zoom window"
                >
                    <span>{windowDates[0]}</span>
                    <span>{windowDates[1]}</span>
                </div>
            )}
        </div>
    )
}

function downloadCsv(s: ChartSeries) {
    const blob = new Blob([seriesToCsv(s)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.label.replace(/[^\w.-]+/g, '_') || 'series'}.csv`
    // Safari and some Firefox builds start the download asynchronously and
    // need the anchor in the document; revoking on the next tick lets it read.
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Colored dot naming the variable (with unit), then that variable's CSV
 *  download. */
function CardFooter({ series, index }: { series: ChartSeries; index: number }) {
    return (
        <footer className="series-chart__variable-footer">
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
                {/* The name over its unit, both clear of the dot. */}
                <span className="series-chart__variable-text">
                    {series.label}
                    {series.unit && (
                        <span className="series-chart__variable-unit">
                            {series.unit}
                        </span>
                    )}
                </span>
            </span>
            <div className="series-chart__variable-actions">
                <button
                    type="button"
                    className="series-chart__csv-link"
                    onClick={() => downloadCsv(series)}
                >
                    Download CSV
                </button>
            </div>
        </footer>
    )
}
