import React from 'react'
import {
    useState,
    useRef,
    useEffect,
    useCallback,
    useId,
    type ReactNode,
    type ChangeEvent,
} from 'react'
import { GradientGraphic } from '../GradientGraphic/GradientGraphic'
import { CategoricalGraphic } from '../CategoricalGraphic/CategoricalGraphic'
import { ColorRampPicker } from '../ColorRampPicker/ColorRampPicker'
import { FloatingPopover } from '../../FloatingPopover'
import type { Layer } from '../../types'

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
    const [isRampPickerOpen, setIsRampPickerOpen] = useState(false)
    const [localOpacity, setLocalOpacity] = useState(opacity ?? 1)
    const opacityBtnRef = useRef<HTMLButtonElement | null>(null)
    const rampBtnRef = useRef<HTMLButtonElement | null>(null)
    const opacityPopoverId = useId()
    const opacityHeadingId = useId()
    const rampPopoverId = useId()

    // Only raster layers carry rescale/ramp settings to expose, and only those
    // whose colormap can actually be changed. A layer painting from a COG
    // colormap baked in at construction shows the ramp but offers no controls.
    const hasColorRamp = cog?.editable === true

    useEffect(() => {
        setIsVisible(visible)
    }, [visible])

    useEffect(() => {
        setLocalOpacity(opacity ?? 1)
    }, [opacity])

    // The popovers ride along with their row as the layer list scrolls, and
    // stay open once the row leaves the viewport. Dismissing them there would
    // hand focus back to an off-screen trigger, scrolling the list back to it.
    const closeRampPicker = useCallback(() => setIsRampPickerOpen(false), [])
    const closeOpacityPopover = useCallback(() => setIsOpacityExpanded(false), [])

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
        <div
            className={`blocks-layer-legend ${isRampPickerOpen || isOpacityExpanded ? 'blocks-layer-legend--menu-open' : ''}`}
            data-legend-id={id}
        >
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
                    <button
                        ref={opacityBtnRef}
                        type="button"
                        className={`blocks-layer-legend__action-btn ${isOpacityExpanded ? 'blocks-layer-legend__action-btn--active' : ''}`}
                        onClick={handleOpacityToggle}
                        aria-haspopup="dialog"
                        aria-expanded={isOpacityExpanded}
                        aria-controls={isOpacityExpanded ? opacityPopoverId : undefined}
                        title={isOpacityExpanded ? 'Hide opacity' : 'Adjust opacity'}
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--opacity" />
                    </button>
                    {hasColorRamp && (
                        <button
                            ref={rampBtnRef}
                            type="button"
                            className={`blocks-layer-legend__action-btn ${isRampPickerOpen ? 'blocks-layer-legend__action-btn--active' : ''}`}
                            onClick={() =>
                                isRampPickerOpen
                                    ? closeRampPicker()
                                    : setIsRampPickerOpen(true)
                            }
                            aria-haspopup="dialog"
                            aria-expanded={isRampPickerOpen}
                            aria-controls={isRampPickerOpen ? rampPopoverId : undefined}
                            title={isRampPickerOpen ? 'Hide color ramp' : 'Change color ramp'}
                        >
                            <span className="blocks-layer-legend__icon blocks-layer-legend__icon--color-ramp" />
                        </button>
                    )}
                    <button
                        className={`blocks-layer-legend__action-btn ${isInfoExpanded ? 'blocks-layer-legend__action-btn--active' : ''}`}
                        onClick={handleInfoToggle}
                        title={isInfoExpanded ? 'Hide info' : 'Show info'}
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--info" />
                    </button>
                    <button
                        className="blocks-layer-legend__action-btn"
                        title="More options"
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--more-options" />
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
            {/* Rendered in a portal, out of the layer list, which clips its
                overflow and would otherwise cut the dropdown off at the panel
                edge. Focus moves into the surface on open, since tab order
                follows the document and the portal sits at its end. */}
            <FloatingPopover
                id={opacityPopoverId}
                anchorRef={opacityBtnRef}
                isOpen={isOpacityExpanded}
                onClose={closeOpacityPopover}
                placement="bottom"
                offset={6}
                className="blocks-layer-legend__opacity-popover"
                label={`Opacity for ${title}`}
                autoFocus
            >
                <div
                    className="blocks-layer-legend__opacity-heading"
                    id={opacityHeadingId}
                >
                    Opacity
                </div>
                <div className="blocks-layer-legend__opacity-control">
                    <input
                        type="range"
                        className="blocks-layer-legend__opacity-slider"
                        min={0}
                        max={1}
                        step={0.01}
                        value={localOpacity}
                        onChange={handleOpacityChange}
                        aria-labelledby={opacityHeadingId}
                    />
                    <span className="blocks-layer-legend__opacity-value">
                        {Math.round(localOpacity * 100)}%
                    </span>
                </div>
            </FloatingPopover>
            {hasColorRamp && cog && (
                <FloatingPopover
                    id={rampPopoverId}
                    anchorRef={rampBtnRef}
                    isOpen={isRampPickerOpen}
                    onClose={closeRampPicker}
                    placement="bottom"
                    offset={6}
                    className="blocks-layer-legend__ramp-popover"
                    label={`Color ramp settings for ${title}`}
                    autoFocus
                >
                    <ColorRampPicker
                        layerId={id}
                        colormap={cog.colormap}
                        min={cog.min}
                        max={cog.max}
                        units={cog.units}
                        titilerUrl={cog.titilerUrl}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                    />
                </FloatingPopover>
            )}
        </div>
    )
}
