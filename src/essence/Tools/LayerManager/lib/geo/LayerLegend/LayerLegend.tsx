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
import { PopoverMenu, type PopoverMenuItem } from '../PopoverMenu'
import type { Layer } from '../../types'

/**
 * Renders an authored description. Markdown is a host concern — the parser,
 * the sanitizer policy and the stylesheet all belong to whoever embeds this
 * panel — so a host that has one passes it in and everyone else gets the text
 * as written.
 */
export type RenderDescription = (
    source: string,
    className?: string,
) => ReactNode

const renderAsPlainText: RenderDescription = (source, className) => (
    <div className={className}>{source}</div>
)

/** A description of only whitespace counts as absent. */
const hasText = (value: string | null | undefined): boolean =>
    Boolean(value?.trim())

export type LayerLegendProps = {
    layer: Layer
    defaultInfoExpanded?: boolean
    renderDescription?: RenderDescription
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
    onZoomToLayer?: (layerId: string) => void
    canZoomToLayer?: (layerId: string) => Promise<boolean>
}

export function LayerLegend({
    layer,
    defaultInfoExpanded = false,
    renderDescription = renderAsPlainText,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onZoomToLayer,
    canZoomToLayer,
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
    const [isInfoOpen, setIsInfoOpen] = useState(defaultInfoExpanded)
    const [isOpacityExpanded, setIsOpacityExpanded] = useState(false)
    const [isRampPickerOpen, setIsRampPickerOpen] = useState(false)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    // Null while the answer is outstanding, which keeps the action inert until
    // it is known to lead somewhere.
    const [canZoom, setCanZoom] = useState<boolean | null>(null)
    const [localOpacity, setLocalOpacity] = useState(opacity ?? 1)
    const opacityBtnRef = useRef<HTMLButtonElement | null>(null)
    const rampBtnRef = useRef<HTMLButtonElement | null>(null)
    const infoBtnRef = useRef<HTMLButtonElement | null>(null)
    const menuBtnRef = useRef<HTMLButtonElement | null>(null)
    const opacityPopoverId = useId()
    const opacityHeadingId = useId()
    const rampPopoverId = useId()
    const infoPopoverId = useId()
    const menuPopoverId = useId()

    // Only raster layers carry rescale/ramp settings to expose, and only those
    // whose colormap can actually be changed. A layer painting from a COG
    // colormap baked in at construction shows the ramp but offers no controls.
    const hasColorRamp = cog?.editable === true

    const hasDescription = hasText(description)

    useEffect(() => {
        setIsVisible(visible)
    }, [visible])

    useEffect(() => {
        setLocalOpacity(opacity ?? 1)
    }, [opacity])

    const closeOpacity = useCallback(() => setIsOpacityExpanded(false), [])

    // The picker rides along with its row as the layer list scrolls, and stays
    // open once the row leaves the viewport. Dismissing it there would hand
    // focus back to an off-screen trigger, scrolling the list back to it.
    const closeRampPicker = useCallback(() => setIsRampPickerOpen(false), [])

    const closeInfo = useCallback(() => setIsInfoOpen(false), [])

    const closeMenu = useCallback(() => setIsMenuOpen(false), [])

    // Read through a ref so that opening the menu and changing layer are the
    // only things that ask again. Callers commonly pass a fresh closure on
    // every render, and depending on its identity would restart the check —
    // blanking the item back to inert — on unrelated panel updates.
    const canZoomToLayerRef = useRef(canZoomToLayer)
    useEffect(() => {
        canZoomToLayerRef.current = canZoomToLayer
    })

    // Asked on open, and again on every reopen: a vector layer that had no
    // measurable geometry a moment ago may have finished loading since.
    useEffect(() => {
        if (!isMenuOpen) return
        const canZoomTo = canZoomToLayerRef.current
        if (!canZoomTo) {
            setCanZoom(true)
            return
        }
        let cancelled = false
        setCanZoom(null)
        canZoomTo(id).then(
            (can) => {
                if (!cancelled) setCanZoom(can)
            },
            () => {
                if (!cancelled) setCanZoom(false)
            },
        )
        return () => {
            cancelled = true
        }
    }, [isMenuOpen, id])

    const menuItems: PopoverMenuItem[] = [
        {
            id: 'zoom-to-layer',
            label: 'Zoom to layer',
            icon: 'zoom-to-layer',
            disabled: canZoom !== true,
            title:
                canZoom === false
                    ? 'This layer has no extent to zoom to'
                    : undefined,
            onSelect: () => onZoomToLayer?.(id),
        },
    ]

    const handleVisibilityToggle = () => {
        const newState = !isVisible
        setIsVisible(newState)
        onVisibilityChange?.(id, newState)
    }

    const handleInfoToggle = () => {
        if (!hasDescription) return
        setIsInfoOpen((open) => !open)
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
                // Rendered through the same component as the info popover, so a
                // description reads consistently wherever it appears.
                return (
                    <div className="blocks-layer-legend__text">
                        {hasDescription
                            ? renderDescription(
                                  description as string,
                                  'blocks-layer-legend__markdown',
                              )
                            : 'No legend information available'}
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
            className={`blocks-layer-legend ${isOpacityExpanded || isRampPickerOpen || isInfoOpen || isMenuOpen ? 'blocks-layer-legend--menu-open' : ''}`}
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
                        aria-controls={
                            isOpacityExpanded ? opacityPopoverId : undefined
                        }
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
                    {/* Marked disabled through aria rather than the disabled
                        attribute: a disabled button takes no pointer events, so
                        the browser never shows the title explaining why it is
                        inert. The click handler is what actually holds it shut. */}
                    <button
                        ref={infoBtnRef}
                        type="button"
                        className={[
                            'blocks-layer-legend__action-btn',
                            !hasDescription
                                ? 'blocks-layer-legend__action-btn--disabled'
                                : '',
                            isInfoOpen
                                ? 'blocks-layer-legend__action-btn--active'
                                : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        onClick={handleInfoToggle}
                        aria-disabled={!hasDescription}
                        aria-haspopup={hasDescription ? 'dialog' : undefined}
                        aria-expanded={hasDescription ? isInfoOpen : undefined}
                        aria-controls={isInfoOpen ? infoPopoverId : undefined}
                        title={
                            hasDescription
                                ? isInfoOpen
                                    ? 'Hide info'
                                    : 'Show info'
                                : 'No description available'
                        }
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--info" />
                    </button>
                    <button
                        ref={menuBtnRef}
                        type="button"
                        className={`blocks-layer-legend__action-btn ${isMenuOpen ? 'blocks-layer-legend__action-btn--active' : ''}`}
                        onClick={() =>
                            isMenuOpen ? closeMenu() : setIsMenuOpen(true)
                        }
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        aria-controls={isMenuOpen ? menuPopoverId : undefined}
                        title="More options"
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--more-options" />
                    </button>
                </div>
            </div>
            {unit?.label && (
                <div className="blocks-layer-legend__unit-label">{unit.label}</div>
            )}
            {isVisible && hasLegendContent && (
                <div className="blocks-layer-legend__content">
                    {renderLegendGraphic()}
                </div>
            )}
            {/* Portaled alongside the other row popovers so the slider clears
                the layer list's clipped overflow. Focus moves onto the slider,
                which then takes arrow keys directly. */}
            <FloatingPopover
                id={opacityPopoverId}
                anchorRef={opacityBtnRef}
                isOpen={isOpacityExpanded}
                onClose={closeOpacity}
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
                <div className="blocks-layer-legend__opacity-row">
                    <input
                        type="range"
                        className="blocks-layer-legend__opacity-slider"
                        min={0}
                        max={1}
                        step={0.01}
                        value={localOpacity}
                        onChange={handleOpacityChange}
                        aria-labelledby={opacityHeadingId}
                        aria-valuetext={`${Math.round(localOpacity * 100)}%`}
                    />
                    <span className="blocks-layer-legend__opacity-value">
                        {Math.round(localOpacity * 100)}%
                    </span>
                </div>
            </FloatingPopover>
            {/* Rendered in a portal, out of the layer list, which clips its
                overflow and would otherwise cut the dropdown off at the panel
                edge. Focus moves into the surface on open, since tab order
                follows the document and the portal sits at its end. */}
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
                        localColormaps={cog.localColormaps}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                    />
                </FloatingPopover>
            )}
            {/* Layer information reads as an overlay rather than an expanding
                row, so opening it doesn't push the rest of the list down. Focus
                stays on the trigger — the content is informational, and there
                is nothing inside to operate. */}
            {hasDescription && (
                <FloatingPopover
                    id={infoPopoverId}
                    anchorRef={infoBtnRef}
                    isOpen={isInfoOpen}
                    onClose={closeInfo}
                    placement="bottom"
                    offset={6}
                    className="blocks-layer-legend__info-popover"
                    label={`Information for ${title}`}
                >
                    <div className="blocks-layer-legend__info-title">{title}</div>
                    {renderDescription(
                        description as string,
                        'blocks-layer-legend__markdown',
                    )}
                </FloatingPopover>
            )}
            {/* Portaled like the other row popovers. Focus moves into the list
                on open, so the menu takes arrow keys straight away. */}
            <FloatingPopover
                id={menuPopoverId}
                anchorRef={menuBtnRef}
                isOpen={isMenuOpen}
                onClose={closeMenu}
                placement="bottom"
                offset={6}
                label={`More options for ${title}`}
                autoFocus
            >
                <PopoverMenu items={menuItems} onSelect={closeMenu} />
            </FloatingPopover>
        </div>
    )
}
