import React from 'react'
import type { BasemapStyle } from '../../types'
import { basemapGradient } from '../../utils/basemap'

export type BasemapPanelProps = {
    /** All selectable basemap styles. */
    styles: BasemapStyle[]
    /** Currently-active style, used to mark the selected row. */
    active: BasemapStyle | null
    /** Called when a style row is chosen. */
    onSelect: (style: BasemapStyle) => void
}

export function BasemapPanel({ styles, active, onSelect }: BasemapPanelProps) {
    return (
        <div className="blocks-basemap-panel">
            <div className="blocks-basemap-panel__header">Basemap style</div>
            {styles.map((entry) => {
                const isActive = active?.name === entry.name
                return (
                    <button
                        key={entry.name}
                        type="button"
                        className={`blocks-basemap-panel__row${isActive ? ' blocks-basemap-panel__row--active' : ''}`}
                        onClick={() => onSelect(entry)}
                    >
                        <span className="blocks-basemap-panel__label">{entry.name}</span>
                        <span
                            className={`blocks-basemap-panel__thumb${isActive ? ' blocks-basemap-panel__thumb--active' : ''}`}
                            style={{ background: basemapGradient(entry.name) }}
                        />
                    </button>
                )
            })}
        </div>
    )
}
