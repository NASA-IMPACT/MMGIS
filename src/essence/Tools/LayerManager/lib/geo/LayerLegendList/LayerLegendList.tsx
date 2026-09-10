import React from 'react'
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
    onMoveLayer?: LayerLegendProps['onMoveLayer']
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
    onMoveLayer,
    onReorder,
}: LayerLegendListProps) {
    // A small distance before a drag starts keeps a click on the handle from
    // becoming one.
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )

    if (!layers || layers.length === 0) {
        return (
            <div className="blocks-layer-legend-list">
                <div className="blocks-layer-legend-list__empty">{emptyMessage}</div>
            </div>
        )
    }

    const legendProps = (layer: Layer, index: number): LayerLegendProps => ({
        layer,
        isFirst: index === 0,
        isLast: index === layers.length - 1,
        renderDescription,
        onVisibilityChange,
        onOpacityChange,
        onColormapChange,
        onRescaleChange,
        onZoomToLayer,
        canZoomToLayer,
        onCompareLayer,
        onMoveLayer,
    })

    if (!onReorder) {
        return (
            <div className="blocks-layer-legend-list">
                {layers.map((layer, index) => (
                    <LayerLegend key={layer.id} {...legendProps(layer, index)} />
                ))}
            </div>
        )
    }

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return
        const toIndex = layers.findIndex((l) => l.id === over.id)
        if (toIndex !== -1) onReorder(String(active.id), toIndex)
    }

    return (
        <div className="blocks-layer-legend-list">
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={layers.map((l) => l.id)}
                    strategy={verticalListSortingStrategy}
                >
                    {layers.map((layer, index) => (
                        <SortableLegend key={layer.id} {...legendProps(layer, index)} />
                    ))}
                </SortableContext>
            </DndContext>
        </div>
    )
}
