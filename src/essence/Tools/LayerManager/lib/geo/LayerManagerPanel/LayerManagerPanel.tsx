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
    onCompareLayer?: LayerLegendListProps['onCompareLayer']
    /** Opens the host's "add layer" surface. No handler, no button. */
    onAddLayer?: () => void
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
    onCompareLayer,
    onAddLayer,
}: LayerManagerPanelProps) {
    return (
        <div className="blocks-layer-manager">
            {onAddLayer && (
                <div className="blocks-layer-manager__header">
                    <button
                        type="button"
                        className="blocks-layer-manager__add-layer"
                        onClick={onAddLayer}
                    >
                        <span
                            className="blocks-layer-manager__add-layer-icon"
                            aria-hidden="true"
                        />
                        <span>Add layer from URL</span>
                    </button>
                </div>
            )}
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
                        onCompareLayer={onCompareLayer}
                    />
                )}
            </div>
        </div>
    )
}
