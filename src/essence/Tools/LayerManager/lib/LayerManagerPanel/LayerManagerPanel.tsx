import React from 'react'
import { Button } from '@trussworks/react-uswds'
import type { Layer } from '../types'
import { LayerLegendList } from '../LayerLegendList/LayerLegendList'

export type LayerManagerPanelProps = {
    layers: Layer[]
    loading?: boolean
    emptyMessage?: string
    title?: string
    onRefresh?: () => void
    onVisibilityChange?: (layerId: string, newVisibility: boolean) => void
    onOpacityChange?: (layerId: string, opacity: number) => void
    onColormapChange?: (layerId: string, colormap: string) => void
    onRescaleChange?: (layerId: string, min: number, max: number) => void
}

export function LayerManagerPanel({
    layers,
    loading = false,
    emptyMessage = 'No visible layers. Turn on layers in the Layers tool to manage them here.',
    title,
    onRefresh,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
}: LayerManagerPanelProps) {
    const hasHeader = Boolean(title) || Boolean(onRefresh)
    return (
        <div className="blocks-layer-manager-scope">
            <div className="blocks-layer-manager">
                {hasHeader && (
                    <div className="blocks-layer-manager__header">
                        {title && <div className="blocks-layer-manager__title">{title}</div>}
                        {onRefresh && (
                            <div className="blocks-layer-manager__actions">
                                <Button
                                    type="button"
                                    unstyled
                                    title="Refresh legends"
                                    onClick={onRefresh}
                                    className="blocks-layer-manager__action"
                                >
                                    <i className="mdi mdi-refresh mdi-18px" />
                                </Button>
                            </div>
                        )}
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
                            onVisibilityChange={onVisibilityChange}
                            onOpacityChange={onOpacityChange}
                            onColormapChange={onColormapChange}
                            onRescaleChange={onRescaleChange}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
