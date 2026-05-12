import React, { useEffect, useRef } from 'react'
import ChartJS from 'chart.js/auto'
import './ChartComponent.css'

export type ChartType = 'bar' | 'line'
export type ChartStatus = 'idle' | 'loading' | 'empty' | 'error' | 'ready'

export interface ChartSpec {
    title: string
    unit?: string
    type?: ChartType
    data: { time: string | number; value: number }[]
}

export interface LayerOption {
    name: string
    title?: string
}

export interface ChartComponentProps {
    status: ChartStatus
    summary?: string
    charts?: ChartSpec[]
    layers?: LayerOption[]
    selectedLayer?: string | null
    errorMessage?: string
    onSelectLayer?: (name: string) => void
    onExit?: () => void
    onClose?: () => void
}

export function ChartComponent(props: ChartComponentProps) {
    const charts = props.charts ?? []
    const layers = props.layers ?? []
    const showDropdown = layers.length > 1

    return (
        <div className="chart-tool" role="region" aria-label="Analyze areas">
            <header className="chart-tool__header">
                <h2 className="chart-tool__title">Analyze areas</h2>
                {props.onClose && (
                    <button
                        type="button"
                        className="chart-tool__icon-btn"
                        onClick={props.onClose}
                        aria-label="Close panel"
                    >
                        ×
                    </button>
                )}
            </header>

            <div className="chart-tool__body">
                {props.status === 'ready' && (
                    <>
                        <button
                            type="button"
                            className="chart-tool__exit"
                            onClick={props.onExit}
                        >
                            Exit analysis
                        </button>

                        {showDropdown && (
                            <select
                                className="chart-tool__select"
                                value={props.selectedLayer ?? ''}
                                onChange={(e) => props.onSelectLayer?.(e.target.value)}
                                aria-label="Select layer"
                            >
                                {layers.map((l) => (
                                    <option key={l.name} value={l.name}>
                                        {l.title || l.name}
                                    </option>
                                ))}
                            </select>
                        )}

                        {props.summary && (
                            <section className="chart-tool__summary">
                                <h3 className="chart-tool__summary-label">Analysis summary</h3>
                                <p className="chart-tool__summary-text">{props.summary}</p>
                            </section>
                        )}

                        {charts.map((c, i) => (
                            <Chart key={`${c.title}-${i}`} {...c} />
                        ))}
                    </>
                )}

                {props.status === 'loading' && (
                    <div className="chart-tool__loading">
                        <div className="chart-tool__spinner" aria-hidden="true" />
                        <p className="chart-tool__loading-text">Looking for insights…</p>
                    </div>
                )}

                {props.status === 'idle' && (
                    <div className="chart-tool__placeholder">
                        Draw an Area of Interest to start analysis.
                    </div>
                )}

                {props.status === 'empty' && (
                    <div className="chart-tool__placeholder">
                        No active layer with timeseries analysis support.
                    </div>
                )}

                {props.status === 'error' && (
                    <div className="chart-tool__placeholder chart-tool__placeholder--error">
                        {props.errorMessage || 'Failed to load timeseries data.'}
                    </div>
                )}
            </div>
        </div>
    )
}

function Chart({ title, unit, type = 'bar', data }: ChartSpec) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const chartRef = useRef<ChartJS | null>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const styles = getComputedStyle(canvas)
        const themeVar = (name: string, fallback: string) =>
            styles.getPropertyValue(name).trim() || fallback
        const accent = themeVar('--theme-accent', '#0e7482')
        const grid = themeVar('--theme-border', '#dfe1e2')
        const muted = themeVar('--theme-muted', '#565c65')

        chartRef.current = new ChartJS(canvas, {
            type,
            data: {
                labels: data.map((p) => formatShortDate(p.time)),
                datasets: [
                    {
                        label: title,
                        data: data.map((p) => p.value),
                        backgroundColor: accent,
                        borderColor: accent,
                        borderWidth: type === 'line' ? 2 : 0,
                        borderRadius: type === 'bar' ? 2 : 0,
                        pointRadius: 0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { intersect: false } },
                scales: {
                    x: {
                        ticks: { color: muted, maxTicksLimit: 6, autoSkip: true },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: muted },
                        grid: { color: grid },
                    },
                },
            },
        })

        return () => {
            chartRef.current?.destroy()
            chartRef.current = null
        }
    }, [title, type, unit, data])

    const meta = describeData(data, unit)

    return (
        <article className="chart-tool__card">
            <h3 className="chart-tool__card-title">{title}</h3>
            {meta && <p className="chart-tool__card-meta">{meta}</p>}
            <div className="chart-tool__card-canvas">
                <canvas ref={canvasRef} />
            </div>
        </article>
    )
}

function describeData(
    data: ChartSpec['data'],
    unit?: string
): string {
    if (!data.length) return ''
    const first = formatTime(data[0].time)
    const last = formatTime(data[data.length - 1].time)
    const sum = data.reduce((s, p) => s + p.value, 0)
    const mean = sum / data.length
    const rounded = Math.abs(mean) >= 10 ? Math.round(mean) : Math.round(mean * 100) / 100
    const meanStr = unit ? `${rounded} ${unit}` : String(rounded)
    return `${first} – ${last}    Mean: ${meanStr}`
}

function formatTime(t: string | number): string {
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) return String(t)
    return d.toLocaleString(undefined, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    })
}

function formatShortDate(t: string | number): string {
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) return String(t)
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    })
}

export default ChartComponent
