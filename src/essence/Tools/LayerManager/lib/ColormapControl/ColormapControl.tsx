import {
    useState,
    useEffect,
    useCallback,
    useMemo,
    type ChangeEvent,
    type KeyboardEvent,
} from 'react'
import { useAvailableColormaps } from '../hooks/useAvailableColormaps'
import styles from './ColormapControl.module.scss'

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

    const handleReset = useCallback(() => {
        onReset?.(layerName)
    }, [layerName, onReset])

    return (
        <div className={styles.colormapControl}>
            {onReset && (
                <div className={styles.colormapControlHeader}>
                    <button
                        className={styles.colormapControlReset}
                        onClick={handleReset}
                        title="Reset to defaults"
                    >
                        <i className="mdi mdi-restore mdi-14px" />
                    </button>
                </div>
            )}
            <div className={styles.colormapControlRow}>
                <label className={styles.colormapControlLabel}>Colormap</label>
                <div className={styles.colormapControlInputGroup}>
                    <select
                        className={styles.colormapControlSelect}
                        value={baseColormap}
                        onChange={handleColormapSelect}
                        disabled={colormapsLoading}
                    >
                        {colormapOptions.map((cm) => (
                            <option key={cm} value={cm}>{formatColormapLabel(cm)}</option>
                        ))}
                    </select>
                    <button
                        className={`${styles.colormapControlReverse} ${reversed ? styles.active : ''}`}
                        onClick={handleReverseToggle}
                        title="Reverse colormap"
                    >
                        <i className="mdi mdi-swap-horizontal mdi-14px" />
                    </button>
                </div>
            </div>
            <div className={styles.colormapControlRow}>
                <label className={styles.colormapControlLabel}>Min</label>
                <div className={styles.colormapControlInputGroup}>
                    <input
                        type="number"
                        className={styles.colormapControlNumber}
                        value={localMin}
                        onChange={handleMinChange}
                        onBlur={handleMinBlur}
                        onKeyDown={handleKeyDown}
                    />
                    {units && <span className={styles.colormapControlUnits}>{units}</span>}
                </div>
            </div>
            <div className={styles.colormapControlRow}>
                <label className={styles.colormapControlLabel}>Max</label>
                <div className={styles.colormapControlInputGroup}>
                    <input
                        type="number"
                        className={styles.colormapControlNumber}
                        value={localMax}
                        onChange={handleMaxChange}
                        onBlur={handleMaxBlur}
                        onKeyDown={handleKeyDown}
                    />
                    {units && <span className={styles.colormapControlUnits}>{units}</span>}
                </div>
            </div>
        </div>
    )
}
