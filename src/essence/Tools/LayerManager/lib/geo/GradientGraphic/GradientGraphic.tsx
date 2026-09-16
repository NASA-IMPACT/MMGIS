import React from 'react'
import { useState, useCallback, useRef, type MouseEvent } from 'react'
import { scaleLinear } from 'd3'
import { useColormapColors } from '../../hooks/useColormapColors'
import { buildGradientCss, isReversedColormap } from '../../utils/colormaps'
import type { CogData } from '../../types'

export type GradientGraphicProps = {
    stops?: string[] | null
    min: number | string
    max: number | string
    unit?: { label: string } | null
    cog?: CogData | null
}

const formatLegendValue = (val: number | string): string | number => {
    const num = Number(val)
    if (isNaN(num)) return val
    if (num === 0) return 0
    if (Math.abs(num) < 9999 && Math.abs(num) > 0.0009) {
        return parseFloat(num.toFixed(3))
    }
    return num.toExponential(2)
}

const formatTooltipValue = (rawVal: number, unit?: { label: string } | null): string => {
    if (rawVal === 0) return unit?.label ? `0 ${unit.label}` : '0'
    let value: number | string
    if (Math.abs(rawVal) < 9999 && Math.abs(rawVal) > 0.0009) {
        value = parseFloat(rawVal.toFixed(3))
    } else {
        value = rawVal.toExponential(2)
    }
    return unit?.label ? `${value} ${unit.label}` : String(value)
}

export function GradientGraphic({ stops, min, max, unit, cog }: GradientGraphicProps) {
    const [hoverVal, setHoverVal] = useState<number | null>(null)
    const [tooltipPos, setTooltipPos] = useState({ x: 0 })
    const barRef = useRef<HTMLDivElement | null>(null)

    const hasCogSettings = cog?.isCog === true
    // A raster layer's bar paints the ramp the tiling service is applying;
    // everything else falls back to the stops the layer's legend declares.
    const { colors: colormapColors } = useColormapColors(
        cog?.colormap,
        isReversedColormap(cog?.colormap),
        cog?.titilerUrl,
        hasCogSettings,
    )

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

    const hasNumericLegend = !isNaN(Number(min) + Number(max))
    const gradientStops = hasCogSettings && colormapColors ? colormapColors : stops
    const gradientStyle = { background: buildGradientCss(gradientStops) }

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
                    {formatLegendValue(hasCogSettings && cog ? cog.min : min)}
                </span>
                <span className="blocks-gradient-graphic__label blocks-gradient-graphic__label--max">
                    {formatLegendValue(hasCogSettings && cog ? cog.max : max)}
                </span>
            </div>
        </div>
    )
}
