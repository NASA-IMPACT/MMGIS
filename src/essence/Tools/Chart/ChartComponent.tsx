import React, { useEffect, useRef } from 'react'
import ChartJS from 'chart.js/auto'
import './ChartComponent.css'
import {
    AnalysisData,
    AssetStats,
    ResultCard,
    cardsFromAnalysisData,
    emptyLayers,
    buildHistogramBins,
    formatStat,
    formatCount,
    formatPercent,
} from './chartHelpers'

export interface ChartComponentProps {
    analysisData?: AnalysisData | null
    onClose?: () => void
}

export function ChartComponent({ analysisData, onClose }: ChartComponentProps) {
    const cards = cardsFromAnalysisData(analysisData)
    const empties = emptyLayers(analysisData)
    const isIdle = !analysisData

    return (
        <div className="chart-tool" role="region" aria-label="Analysis results">
            <header className="chart-tool__header">
                <h2 className="chart-tool__title">
                    <i className="mdi mdi-chart-bar chart-tool__title-icon" aria-hidden="true" />
                    <span>Analysis results</span>
                </h2>
                {onClose && (
                    <button
                        type="button"
                        className="chart-tool__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <i className="mdi mdi-close" aria-hidden="true" />
                    </button>
                )}
            </header>

            <div className="chart-tool__body" aria-live="polite">
                {isIdle && (
                    <p className="chart-tool__placeholder">
                        Draw an area on the map and click <strong>Analyze area</strong> to see statistics here.
                    </p>
                )}

                {!isIdle && (
                    <>
                        {cards.length === 0 && empties.length === 0 && (
                            <p className="chart-tool__placeholder">
                                No analysis-supported layers are visible.
                            </p>
                        )}

                        {cards.map((card) => (
                            <ResultCardView
                                key={`${card.layerName}__${card.assetName}`}
                                card={card}
                            />
                        ))}

                        {empties.map((layerName) => (
                            <EmptyCard key={`empty__${layerName}`} layerName={layerName} />
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}

function ResultCardView({ card }: { card: ResultCard }) {
    const { layerName, assetName, stats } = card
    const noPixels = stats.valid_pixels === 0

    return (
        <article className="chart-tool__card">
            <header className="chart-tool__card-header">
                <h3 className="chart-tool__card-title">{layerName}</h3>
                <span className="chart-tool__card-subtitle">{assetName}</span>
            </header>

            {noPixels ? (
                <p className="chart-tool__card-empty">No usable pixels in this area.</p>
            ) : (
                <>
                    <div className="chart-tool__headline">
                        <div className="chart-tool__headline-label">Mean</div>
                        <div className="chart-tool__headline-value">{formatStat(stats.mean)}</div>
                        <div className="chart-tool__headline-meta">
                            {formatPercent(stats.valid_percent)} valid · {formatCount(stats.valid_pixels)} pixels
                        </div>
                    </div>

                    <Histogram stats={stats} />

                    <dl className="chart-tool__stats">
                        <Stat label="Min" value={formatStat(stats.min)} />
                        <Stat label="Max" value={formatStat(stats.max)} />
                        <Stat label="Median" value={formatStat(stats.median)} />
                        <Stat label="Std dev" value={formatStat(stats.std)} />
                        <Stat label="2nd %ile" value={formatStat(stats.percentile_2)} />
                        <Stat label="98th %ile" value={formatStat(stats.percentile_98)} />
                    </dl>
                </>
            )}
        </article>
    )
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="chart-tool__stat">
            <dt className="chart-tool__stat-label">{label}</dt>
            <dd className="chart-tool__stat-value">{value}</dd>
        </div>
    )
}

function EmptyCard({ layerName }: { layerName: string }) {
    return (
        <article className="chart-tool__card chart-tool__card--empty">
            <header className="chart-tool__card-header">
                <h3 className="chart-tool__card-title">{layerName}</h3>
            </header>
            <p className="chart-tool__card-empty">Could not fetch statistics for this.</p>
        </article>
    )
}

function Histogram({ stats }: { stats: AssetStats }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const chartRef = useRef<ChartJS | null>(null)
    const bins = buildHistogramBins(stats.histogram)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || bins.length === 0) return

        // The canvas is painted by script rather than by the stylesheet, so the
        // design tokens are read off the element instead of referenced. Each
        // fallback is the horizon value, matching ChartComponent.css.
        const styles = getComputedStyle(canvas)
        const themeVar = (name: string, fallback: string) =>
            styles.getPropertyValue(name).trim() || fallback
        const accent = themeVar('--theme-color-primary', '#1c67e3')
        const grid = themeVar('--theme-color-base-lighter', '#e3e3e3')
        const muted = themeVar('--theme-color-base-dark', '#58585b')

        chartRef.current = new ChartJS(canvas, {
            type: 'bar',
            data: {
                labels: bins.map((b) => b.label),
                datasets: [
                    {
                        label: 'count',
                        data: bins.map((b) => b.count),
                        backgroundColor: accent,
                        borderRadius: 2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (ctx) => {
                                const bin = bins[ctx[0].dataIndex]
                                return `${formatStat(bin.lo)} – ${formatStat(bin.hi)}`
                            },
                            label: (ctx) => `${formatCount(ctx.parsed.y)} pixels`,
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: { color: muted, maxTicksLimit: 6, autoSkip: true },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: muted, callback: (v) => formatCount(Number(v)) },
                        grid: { color: grid },
                    },
                },
            },
        })

        return () => {
            chartRef.current?.destroy()
            chartRef.current = null
        }
    }, [stats, bins])

    if (bins.length === 0) return null

    return (
        <div className="chart-tool__histogram">
            <canvas ref={canvasRef} />
        </div>
    )
}

export default ChartComponent
