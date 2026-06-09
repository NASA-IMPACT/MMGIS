import React from 'react'
import { Button } from '@trussworks/react-uswds'
import type { AOIShape } from '../../types'

export type DrawPanelProps = {
    shape: AOIShape | null
    shapes?: AOIShape[]
    disabled?: boolean
    isDrawing: boolean
    verticesCount: number
    onShapeChange: (shape: AOIShape) => void
    onConfirm: () => void
    onCancel: () => void
}

const ALL_SHAPES: Array<{ id: AOIShape; label: string; icon: string }> = [
    { id: 'point', label: 'Point', icon: 'map-marker-outline' },
    { id: 'linestring', label: 'Line', icon: 'vector-polyline' },
    { id: 'polygon', label: 'Polygon', icon: 'vector-polygon' },
    { id: 'rectangle', label: 'Rectangle', icon: 'square-outline' },
    { id: 'circle', label: 'Circle', icon: 'circle-outline' },
]

const DEFAULT_ALLOWED_SHAPES: AOIShape[] = ['polygon', 'rectangle', 'circle']

const MIN_VERTICES_BY_SHAPE: Record<AOIShape, number> = {
    point: 1,
    linestring: 2,
    polygon: 3,
    rectangle: 2,
    circle: 2,
}

const HINT_BY_SHAPE: Record<AOIShape, (count: number, min: number) => string> = {
    point: () => 'Click on the map to place the point.',
    linestring: (count) =>
        `Click to add vertices. ${count} placed (need 2+). Double-click or Enter to finish.`,
    polygon: (count, min) =>
        `Click on the map to add vertices. ${count} placed (need ${min}+).`,
    rectangle: () => 'Click two corners to define the rectangle.',
    circle: () => 'Click the centre, then click the edge to define the circle.',
}

export function DrawPanel(props: DrawPanelProps) {
    if (props.isDrawing && props.shape) {
        return <DrawInProgress {...props} shape={props.shape} />
    }
    return <ShapePicker {...props} />
}

function ShapePicker({ shape, shapes, disabled, onShapeChange }: DrawPanelProps) {
    const allow = new Set(shapes ?? DEFAULT_ALLOWED_SHAPES)
    const list = ALL_SHAPES.filter((s) => allow.has(s.id))
    return (
        <div className="blocks-aoi-panel blocks-aoi-panel--draw">
            <p className="blocks-aoi-panel__hint">Choose a shape</p>
            <div className="blocks-aoi-draw__shapes" role="group" aria-label="Shape">
                {list.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        className={
                            'blocks-aoi-draw__shape' +
                            (shape === s.id ? ' blocks-aoi-draw__shape--active' : '')
                        }
                        disabled={disabled}
                        onClick={() => onShapeChange(s.id)}
                        aria-pressed={shape === s.id}
                        aria-label={s.label}
                    >
                        <i className={`mdi mdi-${s.icon} blocks-aoi-draw__shape-icon`} aria-hidden="true" />
                    </button>
                ))}
            </div>
            <p className="blocks-aoi-panel__hint blocks-aoi-panel__hint--secondary">
                Click anywhere on the map to start drawing a shape
            </p>
        </div>
    )
}

function DrawInProgress(props: DrawPanelProps & { shape: AOIShape }) {
    const minVertices = MIN_VERTICES_BY_SHAPE[props.shape]
    const valid = props.verticesCount >= minVertices
    const hint = HINT_BY_SHAPE[props.shape](props.verticesCount, minVertices)

    return (
        <div className="blocks-aoi-panel blocks-aoi-panel--draw">
            <p className="blocks-aoi-panel__hint">{hint}</p>
            <div className="blocks-aoi-draw__actions" role="group" aria-label="Drawing actions">
                <Button
                    type="button"
                    className="blocks-aoi-draw__confirm"
                    onClick={props.onConfirm}
                    disabled={!valid}
                >
                    Confirm
                </Button>
                <Button
                    type="button"
                    outline
                    className="blocks-aoi-draw__cancel"
                    onClick={props.onCancel}
                >
                    Cancel
                </Button>
            </div>
        </div>
    )
}
