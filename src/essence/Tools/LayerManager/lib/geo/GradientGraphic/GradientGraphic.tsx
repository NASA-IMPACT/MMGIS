import React from 'react'
import { useState, useCallback, useRef, type MouseEvent } from 'react'
import { scaleLinear } from 'd3'
import { buildGradientCss } from '../../utils/colormaps'

export type GradientGraphicProps = {
    /** The ramp's colors in order, already resolved. */
    stops?: string[] | null
    /** Null where the layer declares no bound; the label is then left blank. */
    min: number | string | null
    max: number | string | null
    unit?: { label: string } | null
}

/** A bound nobody declared prints as nothing, never as 0. */
const formatLegendValue = (val: number | string | null): string => {
    if (val == null || (typeof val === 'string' && val.trim() === '')) return ''
    const num = Number(val)
    if (isNaN(num)) return String(val)
    if (num === 0) return '0'
    if (Math.abs(num) < 9999 && Math.abs(num) > 0.0009) {
        return String(parseFloat(num.toFixed(3)))
    }
    return num.toExponential(2)
}

const formatTooltipValue = (rawVal: number, unit?: { label: string } | null): string => {
    const value = formatLegendValue(rawVal)
    return unit?.label ? `${value} ${unit.label}` : value
}

export function GradientGraphic({ stops, min, max, unit }: GradientGraphicProps) {
    const [hoverVal, setHoverVal] = useState<number | null>(null)
    const [tooltipPos, setTooltipPos] = useState({ x: 0 })
    const barRef = useRef<HTMLDivElement | null>(null)

    const handleMouseMove = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (!barRef.current) return
            const rect = barRef.current.getBoundingClientRect()
            const offsetX = e.clientX - rect.left
            const width = rect.width
            const scale = scaleLinear()
                .domain([0, width])
                .range([Number(min), Number(max)])
            const value = Math.max(
                Number(min),
                Math.min(Number(max), scale(offsetX)),
            )
            setHoverVal(value)
            setTooltipPos({ x: offsetX })
        },
        [min, max],
    )

    const handleMouseLeave = useCallback(() => setHoverVal(null), [])

    // Read off the bar's width, so a bar with no scale behind it has no value
    // to report. `Number(null)` is 0, which would otherwise read as a bound.
    const hasNumericLegend =
        min != null && max != null && !isNaN(Number(min) + Number(max))
    const gradientStyle = { background: buildGradientCss(stops) }

    return (
        <div className="blocks-gradient-graphic">
            <div className="blocks-gradient-graphic__bar-row">
                <div
                    className="blocks-gradient-graphic__bar-container"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                >
                    <div ref={barRef} className="blocks-gradient-graphic__bar" style={gradientStyle} />
                    {hoverVal !== null && hasNumericLegend && (
                        <div
                            className="blocks-gradient-graphic__tooltip blocks-gradient-graphic__tooltip--visible"
                            style={{ left: tooltipPos.x }}
                        >
                            {formatTooltipValue(hoverVal, unit)}
                        </div>
                    )}
                </div>
            </div>
            <div className="blocks-gradient-graphic__labels">
                <span className="blocks-gradient-graphic__label blocks-gradient-graphic__label--min">
                    {formatLegendValue(min)}
                </span>
                <span className="blocks-gradient-graphic__label blocks-gradient-graphic__label--max">
                    {formatLegendValue(max)}
                </span>
            </div>
        </div>
    )
}
