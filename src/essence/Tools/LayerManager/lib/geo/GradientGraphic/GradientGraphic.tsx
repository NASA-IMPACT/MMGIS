import React from 'react'
import { useState, useCallback, useRef, type MouseEvent } from 'react'
import { scaleLinear } from 'd3'
import { ColormapControl } from '../ColormapControl/ColormapControl'
import { useColormapGradient } from '../../hooks/useColormapGradient'
import { useClickOutside } from '../../hooks/useClickOutside'
import type { CogData } from '../../types'

export type GradientGraphicProps = {
    stops?: string[] | null
    min: number | string
    max: number | string
    unit?: { label: string } | null
    cog?: CogData | null
    layerId: string
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
}

const makeGradient = (stops: string[] | null | undefined): string => {
    if (!stops || stops.length === 0) return 'transparent'
    if (stops.length === 1) return stops[0]
    const d = 100 / (stops.length - 1)
    const steps = stops.map((s, i) => `${s} ${i * d}%`)
    return `linear-gradient(to right, ${steps.join(', ')})`
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

export function GradientGraphic({
    stops,
    min,
    max,
    unit,
    cog,
    layerId,
    onColormapChange,
    onRescaleChange,
}: GradientGraphicProps) {
    const [hoverVal, setHoverVal] = useState<number | null>(null)
    const [tooltipPos, setTooltipPos] = useState({ x: 0 })
    const [isCogExpanded, setIsCogExpanded] = useState(false)
    const barRef = useRef<HTMLDivElement | null>(null)
    const cogBtnRef = useRef<HTMLButtonElement | null>(null)
    const cogPopoverRef = useRef<HTMLDivElement | null>(null)

    const hasCogSettings = cog?.isCog === true
    // A layer can paint from a COG colormap without that colormap being
    // changeable, in which case the ramp and its bounds are shown but the
    // settings popover is left out.
    const canEditCog = cog?.editable === true
    const { colors: colormapColors } = useColormapGradient(
        cog?.colormap,
        hasCogSettings,
        cog,
    )

    useClickOutside(
        [cogPopoverRef, cogBtnRef],
        useCallback(() => setIsCogExpanded(false), []),
        isCogExpanded,
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
    const gradientStyle = { background: makeGradient(gradientStops) }

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
                <div className="blocks-gradient-graphic__cog-wrapper">
                    {canEditCog && cog && (
                        <>
                            <button
                                ref={cogBtnRef}
                                className={`blocks-gradient-graphic__expand-btn ${isCogExpanded ? 'blocks-gradient-graphic__expand-btn--active' : ''}`}
                                onClick={() => setIsCogExpanded(!isCogExpanded)}
                                title={isCogExpanded ? 'Hide COG settings' : 'Show COG settings'}
                            >
                                <i className={`mdi mdi-chevron-${isCogExpanded ? 'up' : 'down'} mdi-18px`} />
                            </button>
                            {isCogExpanded && (
                                <div ref={cogPopoverRef} className="blocks-gradient-graphic__cog-popover">
                                    <ColormapControl
                                        layerName={layerId}
                                        colormap={cog.colormap}
                                        min={cog.min}
                                        max={cog.max}
                                        units={cog.units}
                                        titilerUrl={cog.titilerUrl}
                                        onColormapChange={onColormapChange}
                                        onRescaleChange={onRescaleChange}
                                    />
                                </div>
                            )}
                        </>
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
