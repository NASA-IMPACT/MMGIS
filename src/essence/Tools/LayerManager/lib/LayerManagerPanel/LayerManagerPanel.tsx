import React from 'react'
import { Button } from '@trussworks/react-uswds'
import type { Layer } from '../types'
import { LayerLegendList } from '../LayerLegendList/LayerLegendList'
import scope from '../styles/scope.module.scss'
import styles from './LayerManagerPanel.module.scss'

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
    title = 'Layer Manager',
    onRefresh,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onCogReset,
}: LayerManagerPanelProps) {
    return (
        <div className={scope.layerManagerScope}>
            <div className={styles.layerManagerPanel}>
                <div className={styles.layerManagerHeader}>
                    <div className={styles.layerManagerTitle}>{title}</div>
                    {onRefresh && (
                        <div className={styles.layerManagerActions}>
                            <Button
                                type="button"
                                unstyled
                                title="Refresh legends"
                                onClick={onRefresh}
                                className={styles.layerManagerAction}
                            >
                                <i className="mdi mdi-refresh mdi-18px" />
                            </Button>
                        </div>
                    )}
                </div>
                <div className={styles.layerManagerContent}>
                    {loading ? (
                        <div className={styles.layerManagerLoading}>
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
