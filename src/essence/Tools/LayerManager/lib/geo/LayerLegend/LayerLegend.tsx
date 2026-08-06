import React from 'react'
import {
    useState,
    useRef,
    useEffect,
    useCallback,
    type ReactNode,
    type ChangeEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { GradientGraphic } from '../GradientGraphic/GradientGraphic'
import { CategoricalGraphic } from '../CategoricalGraphic/CategoricalGraphic'
import { ColorRampPicker } from '../ColorRampPicker/ColorRampPicker'
import { useAnchoredPosition } from '../../hooks/useAnchoredPosition'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { Layer } from '../../types'

// The picker renders in a portal, so its box has no layout parent to size it.
// These must stay in step with the width/max-height in color-ramp-picker.scss,
// which is what the anchoring math assumes it is placing.
const RAMP_PICKER_WIDTH = 244
const RAMP_PICKER_MAX_HEIGHT = 380

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
    const opacityPopoverRef = useRef<HTMLDivElement | null>(null)
    const rampBtnRef = useRef<HTMLButtonElement | null>(null)
    const rampPopoverRef = useRef<HTMLDivElement | null>(null)

    // Only raster layers carry rescale/ramp settings to expose.
    const hasColorRamp = cog?.isCog === true

    useEffect(() => {
        setIsVisible(visible)
    }, [visible])

    useEffect(() => {
        setLocalOpacity(opacity ?? 1)
    }, [opacity])

    // Tab order follows the document, and the popover is portaled to its end,
    // so opening moves focus into the surface for it to be reachable at all.
    useEffect(() => {
        if (isRampPickerOpen) rampPopoverRef.current?.focus()
    }, [isRampPickerOpen])

    useClickOutside(
        [opacityPopoverRef, opacityBtnRef],
        useCallback(() => setIsOpacityExpanded(false), []),
        isOpacityExpanded,
    )

    // Dismissing returns focus to the trigger: the popover is portaled to the
    // end of the document, so focus left inside it would otherwise resume
    // tabbing from there rather than from the row it belongs to.
    const closeRampPicker = useCallback(() => {
        setIsRampPickerOpen((wasOpen) => {
            if (wasOpen && rampPopoverRef.current?.contains(document.activeElement)) {
                rampBtnRef.current?.focus()
            }
            return false
        })
    }, [])
    useClickOutside([rampPopoverRef, rampBtnRef], closeRampPicker, isRampPickerOpen)
    useEscapeKey(closeRampPicker, isRampPickerOpen)

    const rampPickerPosition = useAnchoredPosition(rampBtnRef, isRampPickerOpen, {
        width: RAMP_PICKER_WIDTH,
        maxHeight: RAMP_PICKER_MAX_HEIGHT,
        onAnchorLost: closeRampPicker,
    })

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
            className={`blocks-layer-legend ${isRampPickerOpen ? 'blocks-layer-legend--menu-open' : ''}`}
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
                    <div className="blocks-layer-legend__opacity-wrapper">
                        <button
                            ref={opacityBtnRef}
                            className={`blocks-layer-legend__action-btn ${isOpacityExpanded ? 'blocks-layer-legend__action-btn--active' : ''}`}
                            onClick={handleOpacityToggle}
                            title={isOpacityExpanded ? 'Hide opacity' : 'Adjust opacity'}
                        >
                            <span className="blocks-layer-legend__icon blocks-layer-legend__icon--opacity" />
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
            {/* Portaled out of the layer list, which clips its overflow and
                would otherwise cut the dropdown off at the panel edge. */}
            {isRampPickerOpen &&
                hasColorRamp &&
                cog &&
                rampPickerPosition &&
                createPortal(
                    <div
                        ref={rampPopoverRef}
                        role="dialog"
                        aria-label={`Color ramp settings for ${title}`}
                        tabIndex={-1}
                        className="blocks-layer-legend__ramp-popover"
                        style={{
                            top: rampPickerPosition.top,
                            bottom: rampPickerPosition.bottom,
                            left: rampPickerPosition.left,
                        }}
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
                    </div>,
                    document.body,
                )}
        </div>
    )
}
