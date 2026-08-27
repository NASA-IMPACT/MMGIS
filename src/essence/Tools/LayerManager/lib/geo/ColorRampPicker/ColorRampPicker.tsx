import React from 'react'
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent,
} from 'react'
import { ColorRampSwatch } from './ColorRampSwatch'
import { useAvailableColormaps } from '../../hooks/useAvailableColormaps'
import {
    applyColormapDirection,
    getBaseColormapName,
    isReversedColormap,
    toForwardColormapNames,
    validateRescale,
} from '../../utils/colormaps'

export type ColorRampPickerProps = {
    layerId: string
    /** Current ramp, including any `_r` suffix. */
    colormap: string
    min: number
    max: number
    units?: string | null
    titilerUrl?: string | null
    /**
     * Ramps the app can paint itself, as name -> ordered CSS colors. Present
     * only for a layer the app renders, and then the whole ramp vocabulary.
     */
    localColormaps?: Record<string, string[]> | null
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
}

/**
 * Rescale bounds and ramp selection for one raster layer.
 *
 * Presentational and prop-driven: every change is reported upward and comes
 * back as new props, so the control never holds its own idea of what the layer
 * is rendering. The exceptions are the in-progress text of the min/max fields
 * and the reverse toggle, which the component owns between commits.
 */
export function ColorRampPicker({
    layerId,
    colormap,
    min,
    max,
    units,
    titilerUrl,
    localColormaps,
    onColormapChange,
    onRescaleChange,
}: ColorRampPickerProps) {
    const headingId = useId()
    const listRef = useRef<HTMLDivElement | null>(null)
    const rangeRef = useRef<HTMLDivElement | null>(null)
    const [minInput, setMinInput] = useState<string>(String(min))
    const [maxInput, setMaxInput] = useState<string>(String(max))
    const [reversed, setReversed] = useState<boolean>(() => isReversedColormap(colormap))

    // The bounds are read back on teardown, when React has already discarded
    // the render that produced them, and are compared against the last range
    // actually sent so a commit is never issued twice for the same edit.
    const boundsRef = useRef({ minInput, maxInput })
    boundsRef.current = { minInput, maxInput }
    const committedRef = useRef<{ min: number; max: number }>({ min, max })

    // Ramp names are matched case-insensitively: a layer may be configured
    // with any casing, while the service reports and accepts lowercase.
    const selectedBase = getBaseColormapName(colormap).toLowerCase()

    const localRampNames = useMemo(
        () => (localColormaps ? Object.keys(localColormaps) : null),
        [localColormaps],
    )

    const {
        colormaps: availableColormaps,
        loading: colormapsLoading,
    } = useAvailableColormaps(titilerUrl, localRampNames)

    // The service reports each ramp twice, forward and reversed; direction is
    // the toggle's job, so only the forward names are listed.
    const rampNames = useMemo(
        () => toForwardColormapNames(availableColormaps),
        [availableColormaps],
    )
    const rampsUnavailable = !colormapsLoading && rampNames.length === 0

    // Track what the layer reports, so an externally applied rescale shows up
    // here. A focused range is a half-finished edit and is left alone —
    // overwriting it would swallow keystrokes and jump the caret.
    useEffect(() => {
        committedRef.current = { min, max }
        if (rangeRef.current?.contains(document.activeElement)) return
        setMinInput(String(min))
        setMaxInput(String(max))
    }, [min, max])

    useEffect(() => {
        setReversed(isReversedColormap(colormap))
    }, [colormap])

    const applyRamp = useCallback(
        (base: string, nextReversed: boolean) => {
            onColormapChange?.(layerId, applyColormapDirection(base, nextReversed))
        },
        [layerId, onColormapChange],
    )

    const handleSelect = useCallback(
        (base: string) => applyRamp(base, reversed),
        [applyRamp, reversed],
    )

    const handleReverseToggle = useCallback(() => {
        const nextReversed = !reversed
        setReversed(nextReversed)
        if (selectedBase) applyRamp(selectedBase, nextReversed)
    }, [applyRamp, reversed, selectedBase])

    /**
     * Commit both bounds together, reverting the fields when the range is
     * unusable. The bounds are validated as a pair, so this runs only once the
     * whole range has been edited — committing per field would reject a
     * still-ascending range mid-edit (raising the minimum before the maximum)
     * and would apply a range the user never asked for.
     */
    const commitRescale = useCallback(() => {
        const { min: lastMin, max: lastMax } = committedRef.current
        const result = validateRescale(
            boundsRef.current.minInput,
            boundsRef.current.maxInput,
        )
        if (!result.valid) {
            setMinInput(String(lastMin))
            setMaxInput(String(lastMax))
            return
        }
        if (result.min === lastMin && result.max === lastMax) return
        // Record before emitting: the layer takes several round trips to
        // report the range back, and a second commit in that window would
        // re-issue the same refresh.
        committedRef.current = { min: result.min, max: result.max }
        onRescaleChange?.(layerId, result.min, result.max)
    }, [layerId, onRescaleChange])

    /** Moving between the two bounds is one continuous edit, not a commit. */
    const handleRangeBlur = useCallback(
        (e: React.FocusEvent<HTMLDivElement>) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            commitRescale()
        },
        [commitRescale],
    )

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                commitRescale()
            }
        },
        [commitRescale],
    )

    // Dismissing the dropdown tears these inputs out of the DOM without ever
    // blurring them, so an edit that was typed but not confirmed is committed
    // here rather than silently dropped.
    useEffect(() => () => commitRescale(), [commitRescale])

    const renderBound = (
        label: string,
        value: string,
        onChange: (e: ChangeEvent<HTMLInputElement>) => void,
    ) => (
        <label className="blocks-color-ramp-picker__bound">
            <span className="blocks-color-ramp-picker__bound-label">{label}</span>
            <span className="blocks-color-ramp-picker__bound-field">
                <input
                    type="number"
                    className="blocks-color-ramp-picker__bound-input"
                    value={value}
                    onChange={onChange}
                    onKeyDown={handleKeyDown}
                />
                {units && (
                    <span className="blocks-color-ramp-picker__bound-units">{units}</span>
                )}
            </span>
        </label>
    )

    return (
        <div className="blocks-color-ramp-picker">
            <div
                ref={rangeRef}
                className="blocks-color-ramp-picker__range"
                onBlur={handleRangeBlur}
            >
                {renderBound('Min', minInput, (e) => setMinInput(e.target.value))}
                {renderBound('Max', maxInput, (e) => setMaxInput(e.target.value))}
            </div>

            <div className="blocks-color-ramp-picker__heading-row">
                <span className="blocks-color-ramp-picker__heading" id={headingId}>
                    Color ramp
                </span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={reversed}
                    className={`blocks-color-ramp-picker__reverse ${
                        reversed ? 'blocks-color-ramp-picker__reverse--active' : ''
                    }`}
                    onClick={handleReverseToggle}
                    title="Reverse the ramp direction"
                >
                    <i aria-hidden="true" className="mdi mdi-swap-horizontal mdi-14px" />
                    <span>Reverse</span>
                </button>
            </div>

            {rampsUnavailable ? (
                <div className="blocks-color-ramp-picker__unavailable" role="status">
                    Color ramps are unavailable.
                </div>
            ) : (
                <div
                    ref={listRef}
                    className="blocks-color-ramp-picker__list"
                    role="group"
                    aria-labelledby={headingId}
                >
                    {colormapsLoading && rampNames.length === 0 ? (
                        <div className="blocks-color-ramp-picker__loading" role="status">
                            Loading ramps…
                        </div>
                    ) : (
                        rampNames.map((name) => (
                            <ColorRampSwatch
                                key={name}
                                name={name}
                                reversed={reversed}
                                selected={name.toLowerCase() === selectedBase}
                                titilerUrl={titilerUrl}
                                localColormaps={localColormaps}
                                rootRef={listRef}
                                onSelect={handleSelect}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
