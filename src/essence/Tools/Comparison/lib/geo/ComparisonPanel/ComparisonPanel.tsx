import React from 'react'
import { useId, useState, type ReactNode } from 'react'
import type {
    ComparisonLayout,
    ComparisonMode,
    LayerOption,
    TimeStatus,
} from '../../types'
import { DateSelector, type TimeMode } from '../../../../Timeline/lib'
import { LayerSelect } from './LayerSelect'

export type ComparisonPanelProps = {
    /** Active comparison mode. */
    mode: ComparisonMode
    /** Called when the user switches tabs. */
    onModeChange?: (mode: ComparisonMode) => void
    /**
     * Whether the host has a timeline at all. Without one there is no date to
     * compare against, so the dates tab stays unavailable.
     */
    timeEnabled?: boolean
    /**
     * Readiness of the host's answer about its timeline. A host that reports
     * `'loading'` is still reading; the dates tab waits on it and says so,
     * rather than claiming the map has no timeline.
     */
    timeStatus?: TimeStatus

    /** Bounds both date pickers clamp to. Null before the host has read them. */
    timeWindowStart?: Date | null
    timeWindowEnd?: Date | null
    /** The host timeline's instant — the date the first side reads at. */
    primaryDate?: Date | null
    /** The instant the second side reads at, null until the user picks one. */
    compareDate?: Date | null
    /** Moves the host's timeline, which moves the first side with it. */
    onPrimaryDateChange?: (date: Date) => void
    /** Sets the second side's date. */
    onCompareDateChange?: (date: Date) => void
    /**
     * Wording for the first row while the host has supplied no date to show.
     * Defaults to a phrasing that matches `timeStatus`.
     */
    primaryDatePlaceholder?: string
    /** Wording inviting the second date. */
    compareDatePlaceholder?: string
    /** Granularity both date pickers select at. */
    timeMode?: TimeMode

    /** How the two sides currently share the map. */
    layout: ComparisonLayout
    /** Called when the user picks the other layout. */
    onLayoutChange?: (layout: ComparisonLayout) => void

    /** Currently-visible layers offered in both side dropdowns. */
    layers: LayerOption[]
    /** Selected layer id for the left (first) side, or null if unset. */
    leftLayerId: string | null
    /** Selected layer id for the right (second) side, or null if unset. */
    rightLayerId: string | null
    onLeftLayerChange?: (layerId: string) => void
    onRightLayerChange?: (layerId: string) => void

    /**
     * Whether the two choices are drawn on the opposite sides of the divider
     * from the ones they are listed beside. The panel shows this on the swap
     * button; the host owns the state.
     */
    swapped?: boolean
    /** Toggle which side of the divider each choice draws on. */
    onSwap?: () => void
    /** End the comparison (EXIT). */
    onClose?: () => void
}

const PLACEHOLDER = 'Select a layer to compare'
const COMPARE_DATE_PLACEHOLDER = 'Pick a day to compare'

/**
 * What the first date row says when there is no date to show, phrased for how
 * far the host has got: a host still reading its timeline is waited on, one
 * without a timeline says so, and one that simply has not sent a date yet is
 * described as unset rather than broken.
 */
const PRIMARY_DATE_PLACEHOLDER: Record<TimeStatus, string> = {
    loading: 'Reading the timeline…',
    ready: 'No date selected',
    unavailable: 'This map has no timeline',
}

/** Why the dates tab is out of reach, when it is. */
const DATES_TAB_TITLE: Record<TimeStatus, string | undefined> = {
    loading: 'Reading this map’s timeline…',
    ready: undefined,
    unavailable: 'This map has no timeline to compare across',
}

/**
 * Presentational Comparison panel (Disasters Portal design). Renders the header
 * (brand + EXIT + collapse), the mode tab toggle, a body that holds either the
 * two visible-layer dropdowns or the two date rows depending on the mode, and
 * the action row holding swap plus the two layout choices. Holds only local
 * collapse UI state and performs no MMGIS interaction — the host wires the
 * callbacks.
 *
 * Swap is a toggle, not a rearrangement: the rows keep showing what the user
 * chose, and the pressed swap button is what says those choices are drawn on
 * the opposite sides of the divider.
 */
export function ComparisonPanel({
    mode,
    onModeChange,
    timeEnabled = false,
    timeStatus = 'ready',
    layout,
    onLayoutChange,
    layers,
    leftLayerId,
    rightLayerId,
    onLeftLayerChange,
    onRightLayerChange,
    timeWindowStart = null,
    timeWindowEnd = null,
    primaryDate = null,
    compareDate = null,
    onPrimaryDateChange,
    onCompareDateChange,
    primaryDatePlaceholder,
    compareDatePlaceholder = COMPARE_DATE_PLACEHOLDER,
    timeMode = 'HOUR',
    swapped = false,
    onSwap,
    onClose,
}: ComparisonPanelProps) {
    const [collapsed, setCollapsed] = useState(false)
    // A host that reports a status is trusted over the flag; one that reports
    // none is read as having finished, so `timeEnabled` alone still decides.
    const status: TimeStatus =
        timeStatus === 'ready' && !timeEnabled ? 'unavailable' : timeStatus
    const datesDisabled = status !== 'ready'
    // Swapping moves the two sides past each other, so both must exist first.
    const canSwap =
        mode === 'dates'
            ? !!primaryDate && !!compareDate
            : !!leftLayerId && !!rightLayerId
    // Nothing else on screen moves when the sides do, so the button carries the
    // state in its wording as well as in its pressed look.
    const swapLabel = swapped ? 'Swap views (sides swapped)' : 'Swap views'

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
                        {/* Points the way the body will move: up to fold it
                            away, down to bring it back. */}
                        <i
                            className={`mdi mdi-18px ${
                                collapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'
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
                            title={DATES_TAB_TITLE[status]}
                            className={`blocks-comparison__tab${
                                mode === 'dates' ? ' blocks-comparison__tab--active' : ''
                            }${datesDisabled ? ' blocks-comparison__tab--disabled' : ''}`}
                            onClick={() => onModeChange?.('dates')}
                        >
                            <i className="mdi mdi-calendar mdi-18px" />
                            <span>Compare dates</span>
                        </button>
                    </div>

                    {mode === 'layers' ? (
                        <>
                            <LayerSelect
                                label="Layer 1"
                                value={leftLayerId}
                                layers={layers}
                                placeholder={PLACEHOLDER}
                                onChange={onLeftLayerChange}
                            />
                            <LayerSelect
                                label="Layer 2"
                                value={rightLayerId}
                                layers={layers}
                                placeholder={PLACEHOLDER}
                                onChange={onRightLayerChange}
                            />
                        </>
                    ) : (
                        <>
                            <DateRow
                                label="Date 1"
                                variant="primary"
                                value={primaryDate}
                                seed={timeWindowEnd}
                                windowStart={timeWindowStart}
                                windowEnd={timeWindowEnd}
                                placeholder={
                                    primaryDatePlaceholder ??
                                    PRIMARY_DATE_PLACEHOLDER[status]
                                }
                                timeMode={timeMode}
                                onChange={onPrimaryDateChange}
                            />
                            {/*
                              * The second date is seeded from the first, so an
                              * empty compare row opens its calendar on the month
                              * the user is already reading rather than at an
                              * unrelated corner of the window. The window's
                              * closing instant stands in for a host that has
                              * sent no date of its own.
                              */}
                            <DateRow
                                label="Date 2"
                                variant="compare"
                                value={compareDate}
                                seed={primaryDate ?? timeWindowEnd}
                                windowStart={timeWindowStart}
                                windowEnd={timeWindowEnd}
                                placeholder={compareDatePlaceholder}
                                timeMode={timeMode}
                                onChange={onCompareDateChange}
                            />
                            <p className="blocks-comparison__hint">
                                Pick a second date to split the map and compare the
                                same layers across time.
                            </p>
                        </>
                    )}

                    <div className="blocks-comparison__actions">
                        <button
                            type="button"
                            className={`blocks-comparison__action-btn blocks-comparison__action-btn--swap${
                                swapped
                                    ? ' blocks-comparison__action-btn--active'
                                    : ''
                            }`}
                            onClick={() => onSwap?.()}
                            disabled={!canSwap}
                            title={swapLabel}
                            aria-label={swapLabel}
                            aria-pressed={swapped}
                        >
                            <i className="mdi mdi-swap-horizontal mdi-18px" />
                        </button>
                        <div className="blocks-comparison__actions-group">
                            <LayoutButton
                                layout="swipe"
                                active={layout === 'swipe'}
                                icon={
                                    <i className="mdi mdi-arrow-split-vertical mdi-18px" />
                                }
                                label="Swipe comparison"
                                onSelect={onLayoutChange}
                            />
                            <LayoutButton
                                layout="sideBySide"
                                active={layout === 'sideBySide'}
                                icon={<SideBySideIcon />}
                                label="Side-by-side comparison"
                                onSelect={onLayoutChange}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

type LayoutButtonProps = {
    layout: ComparisonLayout
    active: boolean
    /** The layout drawn as a glyph, sized to sit beside an 18px icon. */
    icon: ReactNode
    label: string
    onSelect?: (layout: ComparisonLayout) => void
}

/** One of the two mutually exclusive ways to split the map. */
/**
 * The two panes the side-by-side layout draws, meeting at the divider. Material
 * Design Icons' view glyphs all carry three columns, so the pair is drawn here.
 */
function SideBySideIcon() {
    return (
        <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
        >
            <rect
                x="1.5"
                y="3.5"
                width="6"
                height="11"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.5"
            />
            <rect
                x="10.5"
                y="3.5"
                width="6"
                height="11"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.5"
            />
        </svg>
    )
}

function LayoutButton({ layout, active, icon, label, onSelect }: LayoutButtonProps) {
    return (
        <button
            type="button"
            className={`blocks-comparison__action-btn blocks-comparison__action-btn--mode${
                active ? ' blocks-comparison__action-btn--active' : ''
            }`}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => onSelect?.(layout)}
        >
            {icon}
        </button>
    )
}

type DateRowProps = {
    label: string
    /** Which of the two rows this is — its role beside the label, and styling. */
    variant: 'primary' | 'compare'
    value: Date | null
    /**
     * Where the calendar opens while the row has no value of its own. A row
     * whose date is unset is still a picker, so it needs an instant to open
     * around even though it is showing none.
     */
    seed: Date | null
    windowStart: Date | null
    windowEnd: Date | null
    /** Wording the picker carries while there is no date to show. */
    placeholder: string
    /** Granularity the picker selects at. */
    timeMode: TimeMode
    onChange?: (date: Date) => void
}

/**
 * One of the two dates a comparison reads across.
 *
 * A row offers a picker as soon as there is a window to clamp against, whether
 * or not it holds a date — an unset row is how the second date gets set, so
 * withholding the picker until a date exists would leave it unreachable. Until
 * one is picked the button carries the invitation instead of a date, and opens
 * its calendar at `seed`. A host that has not read a window yet has nothing to
 * clamp to, and shows the same wording as plain text.
 *
 * The picker is a button rather than a form field, so a wrapping `<label>`
 * would not name it. The row is a labelled group instead, which names the
 * picker and the invitation alike as assistive tech enters it.
 */
function DateRow({
    label,
    variant,
    value,
    seed,
    windowStart,
    windowEnd,
    placeholder,
    timeMode,
    onChange,
}: DateRowProps) {
    const labelId = useId()
    const anchor = value ?? seed ?? windowEnd
    const pickable = windowStart != null && windowEnd != null && anchor != null

    return (
        <div
            className={`blocks-comparison__date-row blocks-comparison__date-row--${variant}`}
            role="group"
            aria-labelledby={labelId}
        >
            <span className="blocks-comparison__field-label" id={labelId}>
                {label} <span className="blocks-comparison__date-qualifier">({variant})</span>
            </span>
            {pickable ? (
                <DateSelector
                    className={`blocks-comparison__date-selector${
                        value == null
                            ? ' blocks-comparison__date-selector--unset'
                            : ''
                    }`}
                    selectedDate={anchor}
                    startTime={windowStart}
                    endTime={windowEnd}
                    timeMode={timeMode}
                    placeholder={value == null ? placeholder : undefined}
                    onDateChange={(date) => onChange?.(date)}
                />
            ) : (
                <span className="blocks-comparison__date-placeholder">
                    {placeholder}
                </span>
            )}
        </div>
    )
}
