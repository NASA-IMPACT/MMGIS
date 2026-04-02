import React, { useState } from 'react'
import GradientGraphic from './GradientGraphic'
import CategoricalGraphic from './CategoricalGraphic'

/**
 * LayerLegend - A standalone, portable React component for displaying map layer legends
 *
 * This component is designed to be independent and can be used in any React application.
 * It supports three legend types: gradient, categorical, and text.
 *
 * @param {object} props
 * @param {string} props.id - Unique identifier for the legend
 * @param {string} props.title - Display title of the legend
 * @param {string} [props.description] - Optional description shown in expandable body
 * @param {'gradient'|'categorical'|'text'} props.type - Type of legend to render
 *
 * For gradient type:
 * @param {string[]} [props.stops] - Array of color hex/rgb values for the gradient
 * @param {number|string} [props.min] - Minimum value
 * @param {number|string} [props.max] - Maximum value
 * @param {object} [props.unit] - Unit object with label property
 *
 * For categorical type:
 * @param {Array<{color: string, label: string}>} [props.stops] - Array of categorical stops
 *
 * Common props:
 * @param {number} [props.opacity=1] - Opacity of the legend graphics
 * @param {function} [props.onInfoToggle] - Callback when info is toggled
 * @param {boolean} [props.defaultInfoExpanded=false] - Whether info section starts expanded
 */
const LayerLegend = ({
    id,
    title,
    description,
    type,
    stops,
    min,
    max,
    unit,
    opacity = 1,
    onInfoToggle,
    defaultInfoExpanded = false,
}) => {
    const [isInfoExpanded, setIsInfoExpanded] = useState(defaultInfoExpanded)

    const handleInfoToggle = () => {
        const newState = !isInfoExpanded
        setIsInfoExpanded(newState)
        if (onInfoToggle) {
            onInfoToggle(newState)
        }
    }

    const renderLegendGraphic = () => {
        switch (type) {
            case 'gradient':
                return (
                    <GradientGraphic
                        stops={stops}
                        min={min}
                        max={max}
                        unit={unit}
                        opacity={opacity}
                    />
                )

            case 'categorical':
                return (
                    <CategoricalGraphic
                        stops={stops}
                        opacity={opacity}
                        defaultExpanded={false}
                    />
                )

            case 'text':
                return (
                    <div className="text-legend">
                        {description || 'No legend information available'}
                    </div>
                )

            default:
                return null
        }
    }

    return (
        <div className="layer-legend" data-legend-id={id}>
            {/* Header with title and info toggle */}
            <div className="layer-legend-header">
                <div className="layer-legend-title-group">
                    <span className="layer-legend-title" title={title}>
                        {title}
                    </span>
                </div>
                <div className="layer-legend-actions">
                    {description && (
                        <button
                            className={`layer-legend-action-btn ${isInfoExpanded ? 'active' : ''}`}
                            onClick={handleInfoToggle}
                            title={isInfoExpanded ? 'Hide info' : 'Show info'}
                        >
                            <i className="mdi mdi-information-outline mdi-18px" />
                        </button>
                    )}
                </div>
            </div>

            {/* Expandable description body */}
            {isInfoExpanded && description && (
                <div className="layer-legend-body">
                    {typeof description === 'string' ? (
                        <p>{description}</p>
                    ) : (
                        description
                    )}
                </div>
            )}

            {/* Legend graphic content */}
            <div className="layer-legend-content">{renderLegendGraphic()}</div>
        </div>
    )
}

export default LayerLegend
