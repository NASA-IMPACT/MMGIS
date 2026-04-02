import React, { useState, useCallback, useRef } from 'react'
import { scaleLinear } from 'd3'

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
 */
const GradientGraphic = ({ stops, min, max, unit, opacity = 1 }) => {
    const [hoverVal, setHoverVal] = useState(null)
    const [tooltipPos, setTooltipPos] = useState({ x: 0 })
    const barRef = useRef(null)

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
    const gradientStyle = {
        background: makeGradient(stops),
        opacity: opacity,
    }

    return (
        <div className="gradient-graphic">
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
            <div className="gradient-labels">
                <span className="gradient-label min">
                    {formatLegendValue(min)}
                </span>
                <span className="gradient-label max">
                    {formatLegendValue(max)}
                </span>
            </div>
            {unit?.label && <div className="gradient-unit">{unit.label}</div>}
        </div>
    )
}

export default GradientGraphic
