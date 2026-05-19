import React from 'react'
import {
    useState,
    useRef,
    useEffect,
    useCallback,
    type ReactNode,
    type ChangeEvent,
} from 'react'
import { GradientGraphic } from '../GradientGraphic/GradientGraphic'
import { CategoricalGraphic } from '../CategoricalGraphic/CategoricalGraphic'
import { useClickOutside } from '../hooks/useClickOutside'
import type { Layer } from '../types'

export type LayerLegendProps = {
    layer: Layer
    defaultInfoExpanded?: boolean
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
}

export function LayerLegend({
    layer,
    defaultInfoExpanded = false,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
}: LayerLegendProps) {
    const {
        id,
        title,
        description,
        type,
        stops,
        min,
        max,
        unit,
        opacity,
        visible,
        cog,
        categoricalStops,
    } = layer

    const [isVisible, setIsVisible] = useState(visible)
    const [isInfoExpanded, setIsInfoExpanded] = useState(defaultInfoExpanded)
    const [isOpacityExpanded, setIsOpacityExpanded] = useState(false)
    const [localOpacity, setLocalOpacity] = useState(opacity ?? 1)
    const opacityBtnRef = useRef<HTMLButtonElement | null>(null)
    const opacityPopoverRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        setIsVisible(visible)
    }, [visible])

    useEffect(() => {
        setLocalOpacity(opacity ?? 1)
    }, [opacity])

    useClickOutside(
        [opacityPopoverRef, opacityBtnRef],
        useCallback(() => setIsOpacityExpanded(false), []),
        isOpacityExpanded,
    )

    const handleVisibilityToggle = () => {
        const newState = !isVisible
        setIsVisible(newState)
        onVisibilityChange?.(id, newState)
    }

    const handleInfoToggle = () => {
        const newState = !isInfoExpanded
        setIsInfoExpanded(newState)
    }

    const handleOpacityToggle = () => setIsOpacityExpanded(!isOpacityExpanded)

    const handleOpacityChange = (e: ChangeEvent<HTMLInputElement>) => {
        const newOpacity = parseFloat(e.target.value)
        setLocalOpacity(newOpacity)
        onOpacityChange?.(id, newOpacity)
    }

    const renderLegendGraphic = (): ReactNode => {
        switch (type) {
            case 'gradient':
                return (
                    <GradientGraphic
                        stops={stops}
                        min={min ?? 0}
                        max={max ?? 0}
                        unit={unit}
                        cog={cog}
                        layerId={id}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                    />
                )
            case 'categorical':
                return categoricalStops ? (
                    <CategoricalGraphic
                        stops={categoricalStops}
                        defaultExpanded={false}
                    />
                ) : null
            case 'text':
                return (
                    <div className="blocks-layer-legend__text">
                        {description || 'No legend information available'}
                    </div>
                )
            case 'none':
            default:
                return null
        }
    }

    const hasLegendContent = type && type !== 'none'

    return (
        <div className="blocks-layer-legend" data-legend-id={id}>
            <div className="blocks-layer-legend__header">
                <div className="blocks-layer-legend__checkbox-wrapper">
                    <input
                        type="checkbox"
                        className="blocks-layer-legend__checkbox"
                        checked={isVisible}
                        onChange={handleVisibilityToggle}
                    />
                </div>
                <div className="blocks-layer-legend__title-group">
                    <span className="blocks-layer-legend__title" title={title}>
                        {title}
                    </span>
                </div>
                <div className="blocks-layer-legend__actions">
                    <div className="blocks-layer-legend__opacity-wrapper">
                        <button
                            ref={opacityBtnRef}
                            className={`blocks-layer-legend__action-btn ${isOpacityExpanded ? 'blocks-layer-legend__action-btn--active' : ''}`}
                            onClick={handleOpacityToggle}
                            title={isOpacityExpanded ? 'Hide opacity' : 'Adjust opacity'}
                        >
                            <i className="mdi mdi-circle-half-full mdi-18px" />
                        </button>
                        {isOpacityExpanded && (
                            <div
                                ref={opacityPopoverRef}
                                className="blocks-layer-legend__opacity-popover"
                            >
                                <input
                                    type="range"
                                    className="blocks-layer-legend__opacity-slider"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={localOpacity}
                                    onChange={handleOpacityChange}
                                />
                                <span className="blocks-layer-legend__opacity-value">
                                    {Math.round(localOpacity * 100)}%
                                </span>
                            </div>
                        )}
                    </div>
                    <button
                        className={`blocks-layer-legend__action-btn ${isInfoExpanded ? 'blocks-layer-legend__action-btn--active' : ''}`}
                        onClick={handleInfoToggle}
                        title={isInfoExpanded ? 'Hide info' : 'Show info'}
                    >
                        <i className="mdi mdi-information-outline mdi-18px" />
                    </button>
                    <button
                        className="blocks-layer-legend__action-btn"
                        title="More options"
                    >
                        <i className="mdi mdi-dots-vertical mdi-18px" />
                    </button>
                </div>
            </div>
            {isInfoExpanded && description && (
                <div className="blocks-layer-legend__body">
                    <p>{description}</p>
                </div>
            )}
            {unit?.label && (
                <div className="blocks-layer-legend__unit-label">{unit.label}</div>
            )}
            {isVisible && hasLegendContent && (
                <div className="blocks-layer-legend__content">
                    {renderLegendGraphic()}
                </div>
            )}
        </div>
    )
}
