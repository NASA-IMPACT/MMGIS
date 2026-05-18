import React from 'react'
import { LayerLegend, type LayerLegendProps } from '../LayerLegend/LayerLegend'
import type { Layer } from '../types'
import styles from './LayerLegendList.module.scss'

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
            <div className={styles.layerLegendList}>
                <div className={styles.layerLegendEmpty}>{emptyMessage}</div>
            </div>
        )
    }
    return (
        <div className={styles.layerLegendList}>
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
