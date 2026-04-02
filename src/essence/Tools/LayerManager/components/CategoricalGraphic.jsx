import React, { useState } from 'react'

/**
 * CategoricalGraphic - Renders a categorical legend with color swatches
 *
 * @param {object} props
 * @param {Array<{color: string, label: string}>} props.stops - Array of categorical stops
 * @param {number} [props.opacity=1] - Opacity of the swatches
 * @param {boolean} [props.defaultExpanded=false] - Whether to start expanded
 */
const CategoricalGraphic = ({ stops, opacity = 1, defaultExpanded = false }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    if (!stops || stops.length === 0) {
        return null
    }

    // Show collapsed swatch line when not expanded
    if (!isExpanded) {
        return (
            <div className="categorical-graphic">
                <div className="categorical-swatch-line">
                    {stops.map((stop, index) => (
                        <div
                            key={`${stop.color}-${index}`}
                            className="categorical-swatch-segment"
                            style={{
                                backgroundColor: stop.color,
                                opacity: opacity,
                            }}
                            title={stop.label}
                        />
                    ))}
                </div>
                {stops.length > 1 && (
                    <div
                        className="categorical-toggle"
                        onClick={() => setIsExpanded(true)}
                    >
                        <i className="mdi mdi-chevron-down mdi-14px" />
                        <span>Show {stops.length} categories</span>
                    </div>
                )}
            </div>
        )
    }

    // Expanded view with full list
    return (
        <div className="categorical-graphic">
            <div className="categorical-list">
                {stops.map((stop, index) => (
                    <div key={`${stop.color}-${index}`} className="categorical-item">
                        <div
                            className="categorical-swatch"
                            style={{
                                backgroundColor: stop.color,
                                opacity: opacity,
                            }}
                        />
                        <span className="categorical-label">{stop.label}</span>
                    </div>
                ))}
            </div>
            <div
                className="categorical-toggle"
                onClick={() => setIsExpanded(false)}
            >
                <i className="mdi mdi-chevron-up mdi-14px" />
                <span>Collapse</span>
            </div>
        </div>
    )
}

export default CategoricalGraphic
