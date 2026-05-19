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
    onCogReset?: (layerId: string) => void
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
    onCogReset,
}: LayerManagerPanelProps) {
    const hasHeader = Boolean(title) || Boolean(onRefresh)
    return (
        <div className="layer-manager-scope">
            <div className="layer-manager-panel">
                {hasHeader && (
                    <div className="layer-manager-header">
                        {title && <div className="layer-manager-title">{title}</div>}
                        {onRefresh && (
                            <div className="layer-manager-actions">
                                <Button
                                    type="button"
                                    unstyled
                                    title="Refresh legends"
                                    onClick={onRefresh}
                                    className="layer-manager-action"
                                >
                                    <i className="mdi mdi-refresh mdi-18px" />
                                </Button>
                            </div>
                        )}
                    </div>
                )}
                <div className="layer-manager-content">
                    {loading ? (
                        <div className="layer-manager-loading">
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
                            onCogReset={onCogReset}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}
