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
    onCompareLayer?: (layerId: string) => void
    /** When provided, renders an "Add layer from URL" button at the top. */
    onAddLayer?: () => void
}

// Inline plus glyph — matches the AddTempLayer trigger this button replaces.
function PlusIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
    )
}

export function LayerManagerPanel({
    layers,
    loading = false,
    emptyMessage = 'No visible layers. Turn on layers in the Layers tool to manage them here.',
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onCompareLayer,
    onAddLayer,
}: LayerManagerPanelProps) {
    return (
        <div className="blocks-layer-manager">
            {onAddLayer && (
                <div className="blocks-layer-manager__add">
                    <button
                        type="button"
                        className="blocks-layer-manager__add-trigger"
                        onClick={onAddLayer}
                    >
                        <PlusIcon />
                        <span className="blocks-layer-manager__add-label">Add layer from URL</span>
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
                        onVisibilityChange={onVisibilityChange}
                        onOpacityChange={onOpacityChange}
                        onColormapChange={onColormapChange}
                        onRescaleChange={onRescaleChange}
                        onCompareLayer={onCompareLayer}
                    />
                )}
            </div>
        </div>
    )
}
