import React from 'react'
import type { Layer } from '../../types'
import { LayerLegendList } from '../LayerLegendList/LayerLegendList'

export type LayerManagerPanelProps = {
    layers: Layer[]
    loading?: boolean
    emptyMessage?: string
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
}

export function LayerManagerPanel({
    layers,
    loading = false,
    emptyMessage = 'No visible layers. Turn on layers in the Layers tool to manage them here.',
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
}: LayerManagerPanelProps) {
    return (
        <div className="blocks-layer-manager">
            <div className="blocks-layer-manager__content">
                {loading ? (
                    <div className="blocks-layer-manager__loading">
                        <div className="mmgisLoading" />
                    </div>
                ) : (
                    <LayerLegendList
                        layers={layers}
                        emptyMessage={emptyMessage}
                        onVisibilityChange={onVisibilityChange}
                        onOpacityChange={onOpacityChange}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                    />
                )}
            </div>
        </div>
    )
}
