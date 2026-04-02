import React from 'react'
import LayerLegend from './LayerLegend'

/**
 * LayerLegendContainer - Container component for displaying multiple layer legends
 *
 * This component manages a list of LayerLegend components with accordion-like behavior.
 * It's designed to work standalone or within the MMGIS LayerManager tool.
 *
 * @param {object} props
 * @param {Array} props.layers - Array of layer legend data objects
 * @param {React.ReactNode} [props.children] - Optional child elements (alternative to layers prop)
 * @param {string} [props.emptyMessage] - Message to show when no layers are present
 */
const LayerLegendContainer = ({
    layers = [],
    children,
    emptyMessage = 'No layers with legends are currently visible.',
}) => {
    // If children are provided, render them directly
    if (children) {
        return <div className="layer-legend-container">{children}</div>
    }

    // If no layers, show empty state
    if (!layers || layers.length === 0) {
        return (
            <div className="layer-legend-container">
                <div className="layer-legend-empty">{emptyMessage}</div>
            </div>
        )
    }

    // Render layer legends from data
    return (
        <div className="layer-legend-container">
            {layers.map((layer) => (
                <LayerLegend
                    key={layer.id}
                    id={layer.id}
                    title={layer.title}
                    description={layer.description}
                    type={layer.type}
                    stops={layer.stops}
                    min={layer.min}
                    max={layer.max}
                    unit={layer.unit}
                    opacity={layer.opacity}
                />
            ))}
        </div>
    )
}

export default LayerLegendContainer
