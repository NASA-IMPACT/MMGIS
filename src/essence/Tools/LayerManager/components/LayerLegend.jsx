import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import GradientGraphic from './GradientGraphic'
import CategoricalGraphic from './CategoricalGraphic'
import { useClickOutside } from '../hooks'

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
 * @param {boolean} [props.visible=true] - Whether the layer is visible
 * @param {function} [props.onVisibilityChange] - Callback when visibility checkbox is toggled
 * @param {function} [props.onOpacityChange] - Callback when opacity is changed
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
    visible = true,
    onVisibilityChange,
    onOpacityChange,
    onInfoToggle,
    defaultInfoExpanded = false,
    cog,
    onColormapChange,
    onRescaleChange,
    onCogReset,
}) => {
    const [isVisible, setIsVisible] = useState(visible)
    const [isInfoExpanded, setIsInfoExpanded] = useState(defaultInfoExpanded)
    const [isOpacityExpanded, setIsOpacityExpanded] = useState(false)
    const [localOpacity, setLocalOpacity] = useState(opacity)
    const [opacityPopoverPosition, setOpacityPopoverPosition] = useState({ top: 0, left: 0, arrowRight: 10 })
    const opacityBtnRef = useRef(null)
    const opacityPopoverRef = useRef(null)

    // Sync local state with props when they change
    useEffect(() => {
        setIsVisible(visible)
    }, [visible])

    useEffect(() => {
        setLocalOpacity(opacity)
    }, [opacity])

    // Close popover when clicking outside using shared hook
    useClickOutside(
        [opacityPopoverRef, opacityBtnRef],
        useCallback(() => setIsOpacityExpanded(false), []),
        isOpacityExpanded
    )

    // Update opacity popover position when expanded
    useEffect(() => {
        if (isOpacityExpanded && opacityBtnRef.current) {
            const updatePosition = () => {
                const btnRect = opacityBtnRef.current.getBoundingClientRect()
                console.log('Button rect:', btnRect)
                const popoverWidth = 165 // approximate popover width
                const popoverLeft = btnRect.right - popoverWidth
                console.log('Calculated popover left:', popoverLeft)

                // Calculate arrow position: distance from popover's right edge to button's center
                const btnCenterX = btnRect.left + btnRect.width / 2
                const arrowRight = popoverWidth - (btnCenterX - popoverLeft)
                console.log('Calculated arrow right:', arrowRight)

                setOpacityPopoverPosition({
                    top: btnRect.bottom + 10,
                    left: popoverLeft,
                    arrowRight: arrowRight,
                })
            }
            updatePosition()

            // Update on scroll/resize
            window.addEventListener('scroll', updatePosition, true)
            window.addEventListener('resize', updatePosition)
            return () => {
                window.removeEventListener('scroll', updatePosition, true)
                window.removeEventListener('resize', updatePosition)
            }
        }
    }, [isOpacityExpanded])

    const handleVisibilityToggle = () => {
        const newState = !isVisible
        setIsVisible(newState)
        if (onVisibilityChange) {
            onVisibilityChange(id, newState)
        }
    }

    const handleInfoToggle = () => {
        if (!description) return // Don't toggle if no description
        const newState = !isInfoExpanded
        setIsInfoExpanded(newState)
        if (onInfoToggle) {
            onInfoToggle(newState)
        }
    }

    const handleOpacityToggle = () => {
        setIsOpacityExpanded(!isOpacityExpanded)
    }

    const handleOpacityChange = (e) => {
        const newOpacity = parseFloat(e.target.value)
        setLocalOpacity(newOpacity)
        if (onOpacityChange) {
            onOpacityChange(id, newOpacity)
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
                        cog={cog}
                        layerId={id}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                        onCogReset={onCogReset}
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

            case 'none':
            default:
                // No legend configured - just show layer type badge
                return null
        }
    }

    const hasLegendContent = type && type !== 'none'

    return (
        <div className="layer-legend" data-legend-id={id}>
            {/* Header with checkbox, title and action buttons */}
            <div className="layer-legend-header">
                <div className="layer-legend-checkbox-wrapper">
                    <input
                        type="checkbox"
                        className="layer-legend-checkbox"
                        checked={isVisible}
                        onChange={handleVisibilityToggle}
                    />
                </div>
                <div className="layer-legend-title-group">
                    <span className="layer-legend-title" title={title}>
                        {title}
                    </span>
                </div>
                <div className="layer-legend-actions">
                    <div className="layer-legend-opacity-wrapper">
                        <button
                            ref={opacityBtnRef}
                            className={`layer-legend-action-btn ${isOpacityExpanded ? 'active' : ''}`}
                            onClick={handleOpacityToggle}
                            title={isOpacityExpanded ? 'Hide opacity' : 'Adjust opacity'}
                        >
                            <i className="mdi mdi-circle-half-full mdi-18px" />
                        </button>
                        {/* Opacity popover - rendered as portal to avoid clipping */}
                        {isOpacityExpanded && ReactDOM.createPortal(
                            <div
                                ref={opacityPopoverRef}
                                className="layer-legend-opacity-popover"
                                style={{
                                    position: 'fixed',
                                    top: `${opacityPopoverPosition.top}px`,
                                    left: `${opacityPopoverPosition.left}px`,
                                    '--arrow-right': `${opacityPopoverPosition.arrowRight}px`,
                                }}
                            >
                                <input
                                    type="range"
                                    className="layer-legend-opacity-slider"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={localOpacity}
                                    onChange={handleOpacityChange}
                                />
                                <span className="layer-legend-opacity-value">
                                    {Math.round(localOpacity * 100)}%
                                </span>
                            </div>,
                            document.body
                        )}
                    </div>
                    <button
                        className={`layer-legend-action-btn ${isInfoExpanded ? 'active' : ''}`}
                        onClick={handleInfoToggle}
                        title={description ? (isInfoExpanded ? 'Hide info' : 'Show info') : 'No description available'}
                        disabled={!description}
                    >
                        <i className="mdi mdi-information-outline mdi-18px" />
                    </button>
                    <button
                        className="layer-legend-action-btn"
                        title="More options"
                    >
                        <i className="mdi mdi-dots-vertical mdi-18px" />
                    </button>
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

            {/* Unit label - shown when there's a unit */}
            {unit?.label && (
                <div className="layer-legend-unit-label">{unit.label}</div>
            )}

            {/* Legend content only shown when layer is visible/enabled */}
            {isVisible && hasLegendContent && (
                <div className="layer-legend-content">{renderLegendGraphic()}</div>
            )}
        </div>
    )
}

export default LayerLegend
