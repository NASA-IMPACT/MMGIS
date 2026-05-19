import React from 'react'
import { LayerLegend, type LayerLegendProps } from '../LayerLegend/LayerLegend'
import type { Layer } from '../types'

export type LayerLegendListProps = {
    layers: Layer[]
    emptyMessage?: string
    onVisibilityChange?: LayerLegendProps['onVisibilityChange']
    onOpacityChange?: LayerLegendProps['onOpacityChange']
    onColormapChange?: LayerLegendProps['onColormapChange']
    onRescaleChange?: LayerLegendProps['onRescaleChange']
}

export function LayerLegendList({
    layers,
    emptyMessage = 'No layers with legends are currently visible.',
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
}: LayerLegendListProps) {
    if (!layers || layers.length === 0) {
        return (
            <div className="blocks-layer-legend-list">
                <div className="blocks-layer-legend-list__empty">{emptyMessage}</div>
            </div>
        )
    }
    return (
        <div className="blocks-layer-legend-list">
            {layers.map((layer) => (
                <LayerLegend
                    key={layer.id}
                    layer={layer}
                    onVisibilityChange={onVisibilityChange}
                    onOpacityChange={onOpacityChange}
                    onColormapChange={onColormapChange}
                    onRescaleChange={onRescaleChange}
                />
            ))}
        </div>
    )
}
