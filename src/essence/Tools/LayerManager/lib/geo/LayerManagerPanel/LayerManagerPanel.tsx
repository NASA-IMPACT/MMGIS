import React from 'react'
import type { Layer } from '../../types'
import {
    LayerLegendList,
    type LayerLegendListProps,
} from '../LayerLegendList/LayerLegendList'
import type { RenderDescription } from '../LayerLegend/LayerLegend'

export type LayerManagerPanelProps = {
    layers: Layer[]
    loading?: boolean
    emptyMessage?: string
    renderDescription?: RenderDescription
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
    onZoomToLayer?: LayerLegendListProps['onZoomToLayer']
    canZoomToLayer?: LayerLegendListProps['canZoomToLayer']
}

export function LayerManagerPanel({
    layers,
    loading = false,
    emptyMessage = 'No visible layers. Turn on layers in the Layers tool to manage them here.',
    renderDescription,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onZoomToLayer,
    canZoomToLayer,
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
                        renderDescription={renderDescription}
                        onVisibilityChange={onVisibilityChange}
                        onOpacityChange={onOpacityChange}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                        onZoomToLayer={onZoomToLayer}
                        canZoomToLayer={canZoomToLayer}
                    />
                )}
            </div>
        </div>
    )
}
