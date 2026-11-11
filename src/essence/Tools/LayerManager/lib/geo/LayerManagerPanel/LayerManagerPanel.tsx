import React from 'react'
import type { Layer, LayerListNode } from '../../types'
import type { RenderDescription } from '../LayerLegend/LayerLegend'
import { LayerTreeList, type LayerTreeListProps } from '../LayerTreeList/LayerTreeList'

export type LayerManagerPanelProps = {
    layers: Layer[]
    /** The rows arranged under their groups; `layers` as a flat list when absent. */
    nodes?: LayerListNode[]
    /** No handler, no drag handles. */
    onMove?: LayerTreeListProps['onMove']
    loading?: boolean
    emptyMessage?: string
    renderDescription?: RenderDescription
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
    onZoomToLayer?: LayerTreeListProps['onZoomToLayer']
    canZoomToLayer?: LayerTreeListProps['canZoomToLayer']
    selectedTime?: LayerTreeListProps['selectedTime']
    onCompareLayer?: LayerTreeListProps['onCompareLayer']
    /** Opens the host's "add layer" surface. No handler, no button. */
    onAddLayer?: () => void
    /**
     * Switches off every layer a filter has taken out of the list. Filtering
     * narrows the list only; the layers it leaves out stay on the map.
     */
    onHideFilteredLayers?: () => void
    /** Titles of those layers. No handler or none to hide, no button. */
    filteredOutLayers?: string[]
    onRunChange?: LayerTreeListProps['onRunChange']
}

export function LayerManagerPanel({
    layers,
    nodes,
    onMove,
    loading = false,
    emptyMessage = 'No visible layers. Turn on layers in the Layers tool to manage them here.',
    renderDescription,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onZoomToLayer,
    canZoomToLayer,
    selectedTime,
    onCompareLayer,
    onAddLayer,
    onHideFilteredLayers,
    filteredOutLayers = [],
    onRunChange,
}: LayerManagerPanelProps) {
    const filteredOutCount = filteredOutLayers.length
    return (
        <div className="blocks-layer-manager">
            <div className="blocks-layer-manager__header">
                {onAddLayer && (
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
                )}
                {onHideFilteredLayers && filteredOutCount > 0 && (
                    <button
                        type="button"
                        className="blocks-layer-manager__hide-filtered"
                        onClick={onHideFilteredLayers}
                        title={`Switch off: ${filteredOutLayers.join(', ')}`}
                    >
                        <i
                            className="mdi mdi-eye-off-outline blocks-layer-manager__hide-filtered-icon"
                            aria-hidden="true"
                        />
                        <span>
                            Hide {filteredOutCount} filtered-out{' '}
                            {filteredOutCount === 1 ? 'layer' : 'layers'}
                        </span>
                    </button>
                )}
            </div>
            <div className="blocks-layer-manager__content">
                {loading ? (
                    <div className="blocks-layer-manager__loading">
                        <div className="mmgisLoading" />
                    </div>
                ) : (
                    <LayerTreeList
                        nodes={nodes ?? layers.map((layer) => ({ kind: 'layer', layer }))}
                        emptyMessage={emptyMessage}
                        renderDescription={renderDescription}
                        onVisibilityChange={onVisibilityChange}
                        onOpacityChange={onOpacityChange}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                        onZoomToLayer={onZoomToLayer}
                        canZoomToLayer={canZoomToLayer}
                        selectedTime={selectedTime}
                        onCompareLayer={onCompareLayer}
                        onMove={onMove}
                        onRunChange={onRunChange}
                    />
                )}
            </div>
        </div>
    )
}
