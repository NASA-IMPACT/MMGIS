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
import styles from './LayerLegend.module.scss'

export type LayerLegendProps = {
    layer: Layer
    defaultInfoExpanded?: boolean
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
    onCogReset?: (layerId: string) => void
    onInfoToggle?: (expanded: boolean) => void
}

export function LayerLegend({
    layer,
    defaultInfoExpanded = false,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onCogReset,
    onInfoToggle,
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
        onInfoToggle?.(newState)
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
                        onCogReset={onCogReset}
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
                    <div className={styles.textLegend}>
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
        <div className={styles.layerLegend} data-legend-id={id}>
            <div className={styles.layerLegendHeader}>
                <div className={styles.layerLegendCheckboxWrapper}>
                    <input
                        type="checkbox"
                        className={styles.layerLegendCheckbox}
                        checked={isVisible}
                        onChange={handleVisibilityToggle}
                    />
                </div>
                <div className={styles.layerLegendTitleGroup}>
                    <span className={styles.layerLegendTitle} title={title}>
                        {title}
                    </span>
                </div>
                <div className={styles.layerLegendActions}>
                    <div className={styles.layerLegendOpacityWrapper}>
                        <button
                            ref={opacityBtnRef}
                            className={`${styles.layerLegendActionBtn} ${isOpacityExpanded ? styles.active : ''}`}
                            onClick={handleOpacityToggle}
                            title={isOpacityExpanded ? 'Hide opacity' : 'Adjust opacity'}
                        >
                            <i className="mdi mdi-circle-half-full mdi-18px" />
                        </button>
                        {isOpacityExpanded && (
                            <div
                                ref={opacityPopoverRef}
                                className={styles.layerLegendOpacityPopover}
                            >
                                <input
                                    type="range"
                                    className={styles.layerLegendOpacitySlider}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={localOpacity}
                                    onChange={handleOpacityChange}
                                />
                                <span className={styles.layerLegendOpacityValue}>
                                    {Math.round(localOpacity * 100)}%
                                </span>
                            </div>
                        )}
                    </div>
                    <button
                        className={`${styles.layerLegendActionBtn} ${isInfoExpanded ? styles.active : ''}`}
                        onClick={handleInfoToggle}
                        title={isInfoExpanded ? 'Hide info' : 'Show info'}
                    >
                        <i className="mdi mdi-information-outline mdi-18px" />
                    </button>
                    <button
                        className={styles.layerLegendActionBtn}
                        title="More options"
                    >
                        <i className="mdi mdi-dots-vertical mdi-18px" />
                    </button>
                </div>
            </div>
            {isInfoExpanded && description && (
                <div className={styles.layerLegendBody}>
                    <p>{description}</p>
                </div>
            )}
            {unit?.label && (
                <div className={styles.layerLegendUnitLabel}>{unit.label}</div>
            )}
            {isVisible && hasLegendContent && (
                <div className={styles.layerLegendContent}>
                    {renderLegendGraphic()}
                </div>
            )}
        </div>
    )
}
