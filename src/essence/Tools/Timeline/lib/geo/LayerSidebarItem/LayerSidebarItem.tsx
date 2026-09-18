import React from 'react'
import type { LayerTimeData, TimeMode } from '../../types'
import type { LayerNavigation } from '../../utils/layerNavigation'
import { LayerNavControls } from '../LayerNavControls/LayerNavControls'
import './LayerSidebarItem.css'

export interface LayerSidebarItemProps {
    layer: LayerTimeData
    /** The row pitch, shared with the chart row drawn beside it. */
    height: number
    /** The current time the navigation controls move away from. */
    currentTime: Date
    /** The timeline's granularity, the step a periodic layer moves by. */
    timeMode: TimeMode
    onNavigate: (target: Date, navigation: LayerNavigation) => void
    /** Frames this layer's own span in the chart. */
    onFit: (layer: LayerTimeData) => void
}

/** A magnifier over a bracketed frame, in the same 24-unit space as the rest. */
const FIT_ICON =
    'M4 4h5v2H6v3H4V4zm11 0h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z' +
    'M11.5 8a3.5 3.5 0 0 1 2.74 5.67l2.05 2.04-1.42 1.42-2.04-2.05A3.5 3.5 0 1 1 11.5 8z' +
    'm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z'

/**
 * One layer's row in the sidebar: its colour, its name, the controls that step
 * the timeline through its dates, and — in the colour dot's own slot — a
 * magnifier that frames the layer.
 *
 * Both controls key on `layer.navigation`, which is present exactly when the
 * layer declares bounds of its own — so the magnifier never appears on a row
 * where fitting would frame the global window and do nothing.
 *
 * The slot wrapping the dot is conditional for the same reason, not only
 * tidiness: the stylesheet blanks the dot inside a slot wherever the device
 * cannot hover, on the grounds that the magnifier is covering it. Wrapping
 * every row's dot would blank the swatch on rows that have no magnifier to
 * show in its place.
 */
export const LayerSidebarItem: React.FC<LayerSidebarItemProps> = ({
    layer,
    height,
    currentTime,
    timeMode,
    onNavigate,
    onFit,
}) => {
    const dot = (
        <span
            className="layer-color-dot"
            style={{ backgroundColor: layer.color }}
        />
    )

    const fitLabel = `${layer.displayName}: fit to this layer`

    // Handed to the stylesheet so the magnifier can take the layer's colour
    // where it stands in for the dot permanently. Custom properties are not
    // part of React's CSSProperties type, hence the cast.
    const slotStyle = { '--layer-color': layer.color } as React.CSSProperties

    return (
        <div className="layer-item" style={{ height, flexShrink: 0 }}>
            {layer.navigation ? (
                <span className="layer-fit-slot" style={slotStyle}>
                    {dot}
                    <button
                        type="button"
                        className="layer-fit-btn"
                        onClick={() => onFit(layer)}
                        title={fitLabel}
                        aria-label={fitLabel}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                        fill="currentColor" aria-hidden="true" focusable="false">
                            <path d={FIT_ICON} />
                        </svg>
                    </button>
                </span>
            ) : (
                dot
            )}
            <span className="layer-name">{layer.displayName}</span>
            {layer.navigation && (
                <LayerNavControls
                    displayName={layer.displayName}
                    navigation={layer.navigation}
                    from={currentTime}
                    timeMode={timeMode}
                    onNavigate={onNavigate}
                />
            )}
        </div>
    )
}
