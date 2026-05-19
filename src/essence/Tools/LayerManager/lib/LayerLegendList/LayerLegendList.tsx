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
    onCogReset?: LayerLegendProps['onCogReset']
}

export function LayerLegendList({
    layers,
    emptyMessage = 'No layers with legends are currently visible.',
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onCogReset,
}: LayerLegendListProps) {
    if (!layers || layers.length === 0) {
        return (
            <div className="layer-legend-list">
                <div className="layer-legend-empty">{emptyMessage}</div>
            </div>
        )
    }
    return (
        <div className="layer-legend-list">
            {layers.map((layer) => (
                <LayerLegend
                    key={layer.id}
                    layer={layer}
                    onVisibilityChange={onVisibilityChange}
                    onOpacityChange={onOpacityChange}
                    onColormapChange={onColormapChange}
                    onRescaleChange={onRescaleChange}
                    onCogReset={onCogReset}
                />
            ))}
        </div>
    )
}
