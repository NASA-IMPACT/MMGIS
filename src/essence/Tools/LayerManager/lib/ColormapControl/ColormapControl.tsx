import React from 'react'
import {
    useState,
    useEffect,
    useCallback,
    useMemo,
    type ChangeEvent,
    type KeyboardEvent,
} from 'react'
import { useAvailableColormaps } from '../hooks/useAvailableColormaps'

export type ColormapControlProps = {
    layerName: string
    colormap: string
    min: number
    max: number
    units?: string | null
    titilerUrl?: string | null
    onColormapChange?: (layerName: string, colormap: string) => void
    onRescaleChange?: (layerName: string, min: number, max: number) => void
    onReset?: (layerName: string) => void
}

const getBaseColormapName = (colormapName: string | null | undefined): string => {
    if (!colormapName) return 'viridis'
    return colormapName.replace(/_r$/i, '')
}

const formatColormapLabel = (name: string): string => {
    if (!name) return ''
    const baseName = name.replace(/_r$/i, '')
    return baseName.charAt(0).toUpperCase() + baseName.slice(1).replace(/_/g, ' ')
}

export function ColormapControl({
    layerName,
    colormap,
    min,
    max,
    units,
    titilerUrl,
    onColormapChange,
    onRescaleChange,
    onReset,
}: ColormapControlProps) {
    const [localMin, setLocalMin] = useState<number>(min)
    const [localMax, setLocalMax] = useState<number>(max)
    const [reversed, setReversed] = useState<boolean>(colormap?.endsWith('_r') || false)
    const [baseColormap, setBaseColormap] = useState<string>(() => getBaseColormapName(colormap))

    const { colormaps: availableColormaps, loading: colormapsLoading } =
        useAvailableColormaps(titilerUrl ? { titilerUrl } : null)

    const colormapOptions = useMemo<string[]>(() => {
        if (!availableColormaps) {
            return ['viridis', 'plasma', 'inferno', 'magma', 'cividis', 'greys', 'blues', 'greens', 'reds', 'rdbu', 'spectral', 'jet', 'turbo']
        }
        return availableColormaps.filter((cm) => !cm.endsWith('_r'))
    }, [availableColormaps])

    useEffect(() => {
        setLocalMin(min)
        setLocalMax(max)
        setReversed(colormap?.endsWith('_r') || false)
        setBaseColormap(getBaseColormapName(colormap))
    }, [colormap, min, max])

    const handleColormapSelect = useCallback(
        (e: ChangeEvent<HTMLSelectElement>) => {
            const newColormap = e.target.value
            setBaseColormap(newColormap)
            const fullColormap = (reversed ? `${newColormap}_r` : newColormap).toLowerCase()
            onColormapChange?.(layerName, fullColormap)
        },
        [layerName, reversed, onColormapChange],
    )

    const handleReverseToggle = useCallback(() => {
        const newReversed = !reversed
        setReversed(newReversed)
        const fullColormap = (newReversed ? `${baseColormap}_r` : baseColormap).toLowerCase()
        onColormapChange?.(layerName, fullColormap)
    }, [layerName, baseColormap, reversed, onColormapChange])

    const handleMinChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(e.target.value)
        if (!isNaN(value)) setLocalMin(value)
    }, [])

    const handleMaxChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(e.target.value)
        if (!isNaN(value)) setLocalMax(value)
    }, [])

    const handleMinBlur = useCallback(() => {
        if (localMin !== min) onRescaleChange?.(layerName, localMin, localMax)
    }, [layerName, localMin, localMax, min, onRescaleChange])

    const handleMaxBlur = useCallback(() => {
        if (localMax !== max) onRescaleChange?.(layerName, localMin, localMax)
    }, [layerName, localMin, localMax, max, onRescaleChange])

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur()
                onRescaleChange?.(layerName, localMin, localMax)
            }
        },
        [layerName, localMin, localMax, onRescaleChange],
    )

    return (
        <div className="blocks-colormap-control">
            <div className="blocks-colormap-control__row">
                <label className="blocks-colormap-control__label">Colormap</label>
                <div className="blocks-colormap-control__input-group">
                    <select
                        className="blocks-colormap-control__select"
                        value={baseColormap}
                        onChange={handleColormapSelect}
                        disabled={colormapsLoading}
                    >
                        {colormapOptions.map((cm) => (
                            <option key={cm} value={cm}>{formatColormapLabel(cm)}</option>
                        ))}
                    </select>
                    <button
                        className={`blocks-colormap-control__reverse ${reversed ? 'blocks-colormap-control__reverse--active' : ''}`}
                        onClick={handleReverseToggle}
                        title="Reverse colormap"
                    >
                        <i className="mdi mdi-swap-horizontal mdi-14px" />
                    </button>
                </div>
            </div>
            <div className="blocks-colormap-control__row">
                <label className="blocks-colormap-control__label">Min</label>
                <div className="blocks-colormap-control__input-group">
                    <input
                        type="number"
                        className="blocks-colormap-control__number"
                        value={localMin}
                        onChange={handleMinChange}
                        onBlur={handleMinBlur}
                        onKeyDown={handleKeyDown}
                    />
                    {units && <span className="blocks-colormap-control__units">{units}</span>}
                </div>
            </div>
            <div className="blocks-colormap-control__row">
                <label className="blocks-colormap-control__label">Max</label>
                <div className="blocks-colormap-control__input-group">
                    <input
                        type="number"
                        className="blocks-colormap-control__number"
                        value={localMax}
                        onChange={handleMaxChange}
                        onBlur={handleMaxBlur}
                        onKeyDown={handleKeyDown}
                    />
                    {units && <span className="blocks-colormap-control__units">{units}</span>}
                </div>
            </div>
        </div>
    )
}
