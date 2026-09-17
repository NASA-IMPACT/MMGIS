import React, { useMemo } from 'react'
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LayerLegend, type LayerLegendProps } from '../LayerLegend/LayerLegend'
import { dropIndex, orderAnnouncements } from '../../utils/layerOrder'
import type { Layer } from '../../types'

export type LayerLegendListProps = {
    layers: Layer[]
    emptyMessage?: string
    renderDescription?: LayerLegendProps['renderDescription']
    onVisibilityChange?: LayerLegendProps['onVisibilityChange']
    onOpacityChange?: LayerLegendProps['onOpacityChange']
    onColormapChange?: LayerLegendProps['onColormapChange']
    onRescaleChange?: LayerLegendProps['onRescaleChange']
    onZoomToLayer?: LayerLegendProps['onZoomToLayer']
    canZoomToLayer?: LayerLegendProps['canZoomToLayer']
    onCompareLayer?: LayerLegendProps['onCompareLayer']
    /** A layer was dropped at `toIndex` of this list. Rows drag only with it. */
    onReorder?: (layerId: string, toIndex: number) => void
}

function SortableLegend(props: LayerLegendProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.layer.id })
    return (
        <div
            ref={setNodeRef}
            className={`blocks-layer-legend-list__item ${isDragging ? 'blocks-layer-legend-list__item--dragging' : ''}`}
            style={{ transform: CSS.Translate.toString(transform), transition }}
        >
            <LayerLegend
                {...props}
                // Copied into a plain record: DraggableAttributes has no index
                // signature, and LayerLegend stays free of the library's types.
                dragHandle={{ ref: setActivatorNodeRef, attributes: { ...attributes }, listeners }}
            />
        </div>
    )
}

export function LayerLegendList({
    layers,
    emptyMessage = 'No layers with legends are currently visible.',
    renderDescription,
    onVisibilityChange,
    onOpacityChange,
    onColormapChange,
    onRescaleChange,
    onZoomToLayer,
    canZoomToLayer,
    onCompareLayer,
    onReorder,
}: LayerLegendListProps) {
    // A small distance before a drag starts keeps a click on the handle from
    // becoming one.
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )
    const announcements = useMemo(() => orderAnnouncements(layers ?? []), [layers])

    if (!layers || layers.length === 0) {
        return (
            <div className="blocks-layer-legend-list">
                <div className="blocks-layer-legend-list__empty">{emptyMessage}</div>
            </div>
        )
    }

    const legendProps = (layer: Layer): LayerLegendProps => ({
        layer,
        renderDescription,
        onVisibilityChange,
        onOpacityChange,
        onColormapChange,
        onRescaleChange,
        onZoomToLayer,
        canZoomToLayer,
        onCompareLayer,
    })

    if (!onReorder) {
        return (
            <div className="blocks-layer-legend-list">
                {layers.map((layer) => (
                    <LayerLegend key={layer.id} {...legendProps(layer)} />
                ))}
            </div>
        )
    }

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        const toIndex = dropIndex(layers.map((l) => l.id), active.id, over)
        if (toIndex !== null) onReorder(String(active.id), toIndex)
    }

    return (
        <div className="blocks-layer-legend-list">
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                accessibility={{ announcements }}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={layers.map((l) => l.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {layers.map((layer) => (
                        <SortableLegend key={layer.id} {...legendProps(layer)} />
                    ))}
                </SortableContext>
            </DndContext>
        </div>
    )
}
