import React, { useState, useCallback, useRef } from 'react'
import { scaleLinear } from 'd3'
import ColormapControl from './ColormapControl'
import { useColormapGradient, useClickOutside } from '../hooks'

/**
 * Creates a CSS linear gradient string from an array of color stops
 * @param {string[]} stops - Array of color hex/rgb values
 * @returns {string} CSS linear-gradient value
 */
const makeGradient = (stops) => {
    if (!stops || stops.length === 0) return 'transparent'
    if (stops.length === 1) return stops[0]

    const d = 100 / (stops.length - 1)
    const steps = stops.map((s, i) => `${s} ${i * d}%`)
    return `linear-gradient(to right, ${steps.join(', ')})`
}

/**
 * Formats a legend value for display
 * @param {string|number} val - Value to format
 * @returns {string|number} Formatted value
 */
const formatLegendValue = (val) => {
    const number = Number(val)
    if (isNaN(number)) return val
    if (number === 0) return 0

    if (Math.abs(number) < 9999 && Math.abs(number) > 0.0009) {
        // Format with up to 3 decimal places, removing trailing zeros
        return parseFloat(number.toFixed(3))
    } else {
        // Scientific notation for very large or small numbers
        return number.toExponential(2)
    }
}

/**
 * Formats a tooltip value with optional unit
 * @param {number} rawVal - Raw numeric value
 * @param {object} unit - Unit object with label property
 * @returns {string} Formatted value with unit
 */
const formatTooltipValue = (rawVal, unit) => {
    if (rawVal === 0) return unit?.label ? `0 ${unit.label}` : '0'

    let value
    if (Math.abs(rawVal) < 9999 && Math.abs(rawVal) > 0.0009) {
        value = parseFloat(rawVal.toFixed(3))
    } else {
        value = rawVal.toExponential(2)
    }

    return unit?.label ? `${value} ${unit.label}` : String(value)
}

/**
 * GradientGraphic - Renders a gradient legend with interactive hover tooltip
 *
 * @param {object} props
 * @param {string[]} props.stops - Array of color values for the gradient
 * @param {number|string} props.min - Minimum value
 * @param {number|string} props.max - Maximum value
 * @param {object} [props.unit] - Unit object with label property
 * @param {number} [props.opacity=1] - Opacity of the gradient
 * @param {object} [props.cog] - COG settings object
 * @param {string} props.layerId - Layer ID for COG controls
 * @param {function} [props.onColormapChange] - Callback for colormap changes
 * @param {function} [props.onRescaleChange] - Callback for rescale changes
 * @param {function} [props.onCogReset] - Callback to reset COG settings
 */
const GradientGraphic = ({
    stops,
    min,
    max,
    unit,
    opacity = 1,
    cog,
    layerId,
    onColormapChange,
    onRescaleChange,
    onCogReset,
}) => {
    const [hoverVal, setHoverVal] = useState(null)
    const [tooltipPos, setTooltipPos] = useState({ x: 0 })
    const [isCogExpanded, setIsCogExpanded] = useState(false)
    const barRef = useRef(null)
    const cogBtnRef = useRef(null)
    const cogPopoverRef = useRef(null)

    const hasCogSettings = cog?.isCog === true

    // Use shared hook to fetch colormap colors
    // Pass cog object as layerConfig to support external TiTiler URLs
    const { colors: colormapColors } = useColormapGradient(
        cog?.colormap,
        hasCogSettings,
        cog
    )

    // Use shared hook for click-outside detection
    useClickOutside(
        [cogPopoverRef, cogBtnRef],
        () => setIsCogExpanded(false),
        isCogExpanded
    )

    const handleMouseMove = useCallback(
        (e) => {
            if (!barRef.current) return

            const rect = barRef.current.getBoundingClientRect()
            const offsetX = e.clientX - rect.left
            const width = rect.width

            // Calculate value based on position
            const scale = scaleLinear()
                .domain([0, width])
                .range([Number(min), Number(max)])

            const value = Math.max(
                Number(min),
                Math.min(Number(max), scale(offsetX))
            )

            setHoverVal(value)
            setTooltipPos({ x: offsetX })
        },
        [min, max]
    )

    const handleMouseLeave = useCallback(() => {
        setHoverVal(null)
    }, [])

    const hasNumericLegend = !isNaN(Number(min) + Number(max))

    // For COG layers with fetched colors, use those; otherwise use provided stops
    const gradientStops = (hasCogSettings && colormapColors) ? colormapColors : stops
    const gradientStyle = {
        background: makeGradient(gradientStops),
        opacity: opacity,
    }

    return (
        <div className="gradient-graphic">
            <div className="gradient-bar-row">
                <div
                    className="gradient-bar-container"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                >
                    <div
                        ref={barRef}
                        className="gradient-bar"
                        style={gradientStyle}
                    />
                    {hoverVal !== null && hasNumericLegend && (
                        <div
                            className="gradient-tooltip visible"
                            style={{ left: tooltipPos.x }}
                        >
                            {formatTooltipValue(hoverVal, unit)}
                        </div>
                    )}
                </div>
                {/* Always reserve space for COG button to keep colorbar width consistent */}
                <div className="gradient-cog-wrapper">
                    {hasCogSettings && (
                        <>
                            <button
                                ref={cogBtnRef}
                                className={`gradient-expand-btn ${isCogExpanded ? 'active' : ''}`}
                                onClick={() => setIsCogExpanded(!isCogExpanded)}
                                title={isCogExpanded ? 'Hide COG settings' : 'Show COG settings'}
                            >
                                <i className={`mdi mdi-chevron-${isCogExpanded ? 'up' : 'down'} mdi-18px`} />
                            </button>
                            {isCogExpanded && (
                                <div ref={cogPopoverRef} className="gradient-cog-popover">
                                    <ColormapControl
                                        layerName={layerId}
                                        colormap={cog.colormap}
                                        min={cog.min}
                                        max={cog.max}
                                        units={cog.units}
                                        titilerUrl={cog.titilerUrl}
                                        onColormapChange={onColormapChange}
                                        onRescaleChange={onRescaleChange}
                                        onReset={onCogReset}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            <div className="gradient-labels">
                <span className="gradient-label min">
                    {formatLegendValue(hasCogSettings ? cog.min : min)}
                </span>
                <span className="gradient-label max">
                    {formatLegendValue(hasCogSettings ? cog.max : max)}
                </span>
            </div>
        </div>
    )
}

export default GradientGraphic
