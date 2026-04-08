import React, { useState, useEffect, useCallback } from 'react'
import { COLORMAP_OPTIONS, findColormapName } from '../utils/constants'

/**
 * ColormapControl - Controls for TiTiler COG layer colormap and rescale
 *
 * @param {object} props
 * @param {string} props.layerName - Layer name/UUID
 * @param {string} props.colormap - Current colormap name
 * @param {number} props.min - Current rescale min value
 * @param {number} props.max - Current rescale max value
 * @param {string} [props.units] - Units label
 * @param {function} props.onColormapChange - Callback when colormap changes
 * @param {function} props.onRescaleChange - Callback when rescale values change
 * @param {function} [props.onReset] - Callback to reset to defaults
 */
const ColormapControl = ({
    layerName,
    colormap,
    min,
    max,
    units,
    onColormapChange,
    onRescaleChange,
    onReset,
}) => {
    const [localMin, setLocalMin] = useState(min)
    const [localMax, setLocalMax] = useState(max)
    const [reversed, setReversed] = useState(colormap?.endsWith('_r') || false)
    const [baseColormap, setBaseColormap] = useState(() => findColormapName(colormap))

    // Update local state when props change
    useEffect(() => {
        setLocalMin(min)
        setLocalMax(max)
        setReversed(colormap?.endsWith('_r') || false)
        setBaseColormap(findColormapName(colormap))
    }, [colormap, min, max])

    const handleColormapSelect = useCallback(
        (e) => {
            const newColormap = e.target.value
            setBaseColormap(newColormap)
            // Colormap names must be lowercase for TiTiler
            const fullColormap = (reversed ? `${newColormap}_r` : newColormap).toLowerCase()
            onColormapChange?.(layerName, fullColormap)
        },
        [layerName, reversed, onColormapChange]
    )

    const handleReverseToggle = useCallback(() => {
        const newReversed = !reversed
        setReversed(newReversed)
        // Colormap names must be lowercase for TiTiler
        const fullColormap = (newReversed
            ? `${baseColormap}_r`
            : baseColormap).toLowerCase()
        onColormapChange?.(layerName, fullColormap)
    }, [layerName, baseColormap, reversed, onColormapChange])

    const handleMinChange = useCallback((e) => {
        const value = parseFloat(e.target.value)
        if (!isNaN(value)) {
            setLocalMin(value)
        }
    }, [])

    const handleMaxChange = useCallback((e) => {
        const value = parseFloat(e.target.value)
        if (!isNaN(value)) {
            setLocalMax(value)
        }
    }, [])

    const handleMinBlur = useCallback(() => {
        if (localMin !== min) {
            onRescaleChange?.(layerName, localMin, localMax)
        }
    }, [layerName, localMin, localMax, min, onRescaleChange])

    const handleMaxBlur = useCallback(() => {
        if (localMax !== max) {
            onRescaleChange?.(layerName, localMin, localMax)
        }
    }, [layerName, localMin, localMax, max, onRescaleChange])

    const handleKeyDown = useCallback(
        (e) => {
            if (e.key === 'Enter') {
                e.target.blur()
                onRescaleChange?.(layerName, localMin, localMax)
            }
        },
        [layerName, localMin, localMax, onRescaleChange]
    )

    const handleReset = useCallback(() => {
        onReset?.(layerName)
    }, [layerName, onReset])

    return (
        <div className="colormap-control">
            {onReset && (
                <div className="colormap-control-header">
                    <button
                        className="colormap-control-reset"
                        onClick={handleReset}
                        title="Reset to defaults"
                    >
                        <i className="mdi mdi-restore mdi-14px" />
                    </button>
                </div>
            )}

            {/* Colormap selector */}
            <div className="colormap-control-row">
                <label className="colormap-control-label">Colormap</label>
                <div className="colormap-control-input-group">
                    <select
                        className="colormap-control-select"
                        value={baseColormap}
                        onChange={handleColormapSelect}
                    >
                        {COLORMAP_OPTIONS.map((cm) => (
                            <option key={cm.name} value={cm.name}>
                                {cm.label}
                            </option>
                        ))}
                    </select>
                    <button
                        className={`colormap-control-reverse ${reversed ? 'active' : ''}`}
                        onClick={handleReverseToggle}
                        title="Reverse colormap"
                    >
                        <i className="mdi mdi-swap-horizontal mdi-14px" />
                    </button>
                </div>
            </div>

            {/* Rescale controls */}
            <div className="colormap-control-row">
                <label className="colormap-control-label">Min</label>
                <div className="colormap-control-input-group">
                    <input
                        type="number"
                        className="colormap-control-number"
                        value={localMin}
                        onChange={handleMinChange}
                        onBlur={handleMinBlur}
                        onKeyDown={handleKeyDown}
                    />
                    {units && <span className="colormap-control-units">{units}</span>}
                </div>
            </div>

            <div className="colormap-control-row">
                <label className="colormap-control-label">Max</label>
                <div className="colormap-control-input-group">
                    <input
                        type="number"
                        className="colormap-control-number"
                        value={localMax}
                        onChange={handleMaxChange}
                        onBlur={handleMaxBlur}
                        onKeyDown={handleKeyDown}
                    />
                    {units && <span className="colormap-control-units">{units}</span>}
                </div>
            </div>
        </div>
    )
}

export default ColormapControl
