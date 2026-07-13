import React from 'react'
import { useState } from 'react'
import type { ComparisonMode, LayerOption } from '../../types'

export type ComparisonPanelProps = {
    /** Active comparison mode. */
    mode: ComparisonMode
    /** Called when the user switches tabs. */
    onModeChange?: (mode: ComparisonMode) => void
    /**
     * Disable the "Compare dates" tab. Compare-dates depends on per-side date
     * pinning in the core swipe capability, which is not implemented yet, so
     * the host disables the tab until the core supports it.
     */
    datesDisabled?: boolean

    /** Currently-visible layers offered in both side dropdowns. */
    layers: LayerOption[]
    /** Selected layer id for the left (first) side, or null if unset. */
    leftLayerId: string | null
    /** Selected layer id for the right (second) side, or null if unset. */
    rightLayerId: string | null
    onLeftLayerChange?: (layerId: string) => void
    onRightLayerChange?: (layerId: string) => void

    /** Swap the two sides (left ↔ right). */
    onSwap?: () => void
    /** End the comparison (EXIT). */
    onClose?: () => void
}

const PLACEHOLDER = 'Select a layer to compare'

/**
 * Presentational Comparison panel (Disasters Portal design). Renders the header
 * (brand + EXIT + collapse), the mode tab toggle, two visible-layer dropdowns,
 * and the compare-mode action row. Holds only local collapse UI state and
 * performs no MMGIS interaction — the host wires the callbacks.
 */
export function ComparisonPanel({
    mode,
    onModeChange,
    datesDisabled = false,
    layers,
    leftLayerId,
    rightLayerId,
    onLeftLayerChange,
    onRightLayerChange,
    onSwap,
    onClose,
}: ComparisonPanelProps) {
    const [collapsed, setCollapsed] = useState(false)
    const canSwap = !!leftLayerId && !!rightLayerId

    return (
        <div className="blocks-comparison">
            <header className="blocks-comparison__header">
                <div className="blocks-comparison__brand">
                    <svg
                        className="blocks-comparison__brand-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                    >
                        <path
                            d="M19 3H14V5H19V18L14 12V21H19C19.5304 21 20.0391 20.7893 20.4142 20.4142C20.7893 20.0391 21 19.5304 21 19V5C21 3.89 20.1 3 19 3ZM10 18H5L10 12M10 3H5C3.89 3 3 3.89 3 5V19C3 19.5304 3.21071 20.0391 3.58579 20.4142C3.96086 20.7893 4.46957 21 5 21H10V23H12V1H10V3Z"
                            fill="currentColor"
                        />
                    </svg>
                    <span className="blocks-comparison__brand-title">Compare</span>
                </div>
                <div className="blocks-comparison__header-actions">
                    <button
                        type="button"
                        className="blocks-comparison__exit"
                        onClick={() => onClose?.()}
                    >
                        EXIT
                    </button>
                    <button
                        type="button"
                        className="blocks-comparison__collapse"
                        onClick={() => setCollapsed((c) => !c)}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? 'Expand' : 'Collapse'}
                        title={collapsed ? 'Expand' : 'Collapse'}
                    >
                        <i
                            className={`mdi mdi-18px ${
                                collapsed ? 'mdi-chevron-up' : 'mdi-chevron-down'
                            }`}
                        />
                    </button>
                </div>
            </header>

            {!collapsed && (
                <div className="blocks-comparison__body">
                    <div className="blocks-comparison__tabs" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'layers'}
                            className={`blocks-comparison__tab${
                                mode === 'layers' ? ' blocks-comparison__tab--active' : ''
                            }`}
                            onClick={() => onModeChange?.('layers')}
                        >
                            <i className="mdi mdi-layers-triple-outline mdi-18px" />
                            <span>Compare layers</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={mode === 'dates'}
                            disabled={datesDisabled}
                            title={datesDisabled ? 'Compare dates is coming soon' : undefined}
                            className={`blocks-comparison__tab${
                                mode === 'dates' ? ' blocks-comparison__tab--active' : ''
                            }${datesDisabled ? ' blocks-comparison__tab--disabled' : ''}`}
                            onClick={() => !datesDisabled && onModeChange?.('dates')}
                        >
                            <i className="mdi mdi-calendar mdi-18px" />
                            <span>Compare dates</span>
                        </button>
                    </div>

                    <SideSelect
                        label="Layer 1"
                        value={leftLayerId}
                        layers={layers}
                        placeholder={PLACEHOLDER}
                        onChange={onLeftLayerChange}
                    />
                    <SideSelect
                        label="Layer 2"
                        value={rightLayerId}
                        layers={layers}
                        placeholder={PLACEHOLDER}
                        onChange={onRightLayerChange}
                    />

                    <div className="blocks-comparison__actions">
                        <button
                            type="button"
                            className="blocks-comparison__action-btn blocks-comparison__action-btn--swap"
                            onClick={() => onSwap?.()}
                            disabled={!canSwap}
                            title="Swap views"
                            aria-label="Swap views"
                        >
                            <i className="mdi mdi-swap-horizontal mdi-18px" />
                        </button>
                        <div className="blocks-comparison__actions-group">
                            <button
                                type="button"
                                className="blocks-comparison__action-btn blocks-comparison__action-btn--mode blocks-comparison__action-btn--active"
                                title="Swipe comparison"
                                aria-label="Swipe comparison"
                                aria-pressed
                            >
                                <i className="mdi mdi-arrow-split-vertical mdi-18px" />
                            </button>
                            <button
                                type="button"
                                className="blocks-comparison__action-btn blocks-comparison__action-btn--mode"
                                disabled
                                title="Side-by-side (coming soon)"
                                aria-label="Side-by-side comparison"
                            >
                                <i className="mdi mdi-view-grid-outline mdi-18px" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

type SideSelectProps = {
    label: string
    value: string | null
    layers: LayerOption[]
    placeholder: string
    onChange?: (layerId: string) => void
}

function SideSelect({ label, value, layers, placeholder, onChange }: SideSelectProps) {
    return (
        <label className="blocks-comparison__field">
            <span className="blocks-comparison__field-label">{label}</span>
            <div className="blocks-comparison__select-wrapper">
                <select
                    className="blocks-comparison__select"
                    value={value ?? ''}
                    onChange={(e) => onChange?.(e.target.value)}
                >
                    <option value="" disabled>
                        {placeholder}
                    </option>
                    {layers.map((layer) => (
                        <option key={layer.id} value={layer.id}>
                            {layer.title}
                        </option>
                    ))}
                </select>
                <i className="mdi mdi-chevron-down mdi-18px blocks-comparison__select-caret" />
            </div>
        </label>
    )
}
