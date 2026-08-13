import React, { useEffect, useRef } from 'react'
import { Alert, Button, TextInput } from '@trussworks/react-uswds'
import './AOIComponent.scss'

export type AOIMode = 'search' | 'inspect' | 'draw' | 'upload'
export type AOIShape = 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle'
export type UploadStatus = 'idle' | 'parsing' | 'error'
export type AnalysisStatus = 'idle' | 'running'

export interface AOISearchResult {
    id: string
    label: string
    kind: 'city' | 'county' | 'state'
}

export interface AOIComponentProps {
    mode: AOIMode
    onModeChange: (mode: AOIMode) => void

    searchQuery: string
    searchResults: AOISearchResult[]
    searchDisabled?: boolean
    searchLoading?: boolean
    onSearchQueryChange: (q: string) => void
    onSearchSelect: (id: string) => void

    drawShape: AOIShape | null
    drawShapes?: AOIShape[]
    drawDisabled?: boolean
    isDrawing: boolean
    drawVerticesCount: number
    onDrawShapeChange: (shape: AOIShape) => void

    uploadStatus: UploadStatus
    uploadError?: string
    onUploadFile: (file: File) => void

    analysisStatus?: AnalysisStatus
    analysisLabel?: string
    analysisDone?: number
    analysisTotal?: number
    analysisError?: string | null
    onDismissAnalysisError?: () => void

    onClose: () => void
}

// `icon` names an .aoi-icon--* modifier, which masks the matching SVG exported
// from the design. The glyph takes its color from the tab, so one file serves
// the default, hover and selected states.
const MODES: Array<{ id: AOIMode; label: string; icon: string }> = [
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'inspect', label: 'Inspect', icon: 'inspect' },
    { id: 'draw', label: 'Draw', icon: 'draw' },
    { id: 'upload', label: 'Upload', icon: 'upload' },
]

export function AOIComponent(props: AOIComponentProps) {
    const isAnalyzing = props.analysisStatus === 'running'

    return (
        <div className="aoi-tool" role="region" aria-label="Analyze areas">
            <header className="aoi-tool__header">
                <div className="aoi-tool__title">
                    <span
                        className="aoi-icon aoi-icon--analyze aoi-tool__title-icon"
                        aria-hidden="true"
                    />
                    <span>Analyze areas</span>
                </div>
                <div className="aoi-tool__header-actions">
                    <button
                        type="button"
                        className="aoi-tool__exit"
                        onClick={props.onClose}
                    >
                        EXIT
                    </button>
                </div>
            </header>

            {props.analysisError ? (
                <div
                    className="aoi-tool__alert aoi-tool__alert--error"
                    role="alert"
                >
                    <i
                        className="mdi mdi-alert-circle aoi-tool__alert-icon"
                        aria-hidden="true"
                    />
                    <p className="aoi-tool__alert-text">{props.analysisError}</p>
                    {props.onDismissAnalysisError && (
                        <button
                            type="button"
                            className="aoi-tool__alert-dismiss"
                            onClick={props.onDismissAnalysisError}
                            aria-label="Dismiss notice"
                        >
                            <i className="mdi mdi-close" aria-hidden="true" />
                        </button>
                    )}
                </div>
            ) : null}

            <div className="aoi-tool__content">
                {isAnalyzing ? (
                    <AnalyzingPanel
                        label={props.analysisLabel || 'Area of interest'}
                        done={props.analysisDone ?? 0}
                        total={props.analysisTotal ?? 0}
                    />
                ) : (
                    <>
                        <nav className="aoi-tool__tabs" role="tablist" aria-label="AOI selection mode">
                            {MODES.map((m) => (
                                <button
                                    key={m.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={props.mode === m.id}
                                    className={
                                        'aoi-tool__tab' +
                                        (props.mode === m.id ? ' aoi-tool__tab--active' : '')
                                    }
                                    onClick={() => props.onModeChange(m.id)}
                                >
                                    <span
                                        className={`aoi-icon aoi-icon--${m.icon}`}
                                        aria-hidden="true"
                                    />
                                    <span className="aoi-tool__tab-label">{m.label}</span>
                                </button>
                            ))}
                        </nav>

                        <div className="aoi-tool__body" role="tabpanel">
                            {props.mode === 'search' && <SearchPanel {...props} />}
                            {props.mode === 'inspect' && <InspectPanel />}
                            {props.mode === 'draw' && <DrawPanel {...props} />}
                            {props.mode === 'upload' && <UploadPanel {...props} />}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function AnalyzingPanel(
    { label, done, total }: { label: string; done: number; total: number }
) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0
    return (
        <div
            className="aoi-panel aoi-panel--analyzing"
            role="status"
            aria-live="polite"
        >
            <div className="aoi-analyzing__spinner" aria-hidden="true" />
            <p className="aoi-analyzing__caption">Analyzing</p>
            <p className="aoi-analyzing__label">{label}</p>
            <p className="aoi-analyzing__percent">{percent}%</p>
            <div
                className="aoi-analyzing__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <div
                    className="aoi-analyzing__bar-fill"
                    style={{ width: `${percent}%` }}
                />
            </div>
            <p className="aoi-analyzing__status">Looking for insights</p>
        </div>
    )
}

function SearchPanel(props: AOIComponentProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    const inputDisabled = props.searchDisabled || props.searchLoading

    return (
        <div className="aoi-panel aoi-panel--search">
            <p className="aoi-panel__hint">Search for a country or a region</p>
            <label className="aoi-search">
                <TextInput
                    id="aoi-search-input"
                    name="aoi-search"
                    type="search"
                    inputRef={inputRef}
                    className="aoi-search__input"
                    placeholder={props.searchLoading ? 'Loading boundaries…' : 'Search'}
                    value={props.searchQuery}
                    disabled={inputDisabled}
                    onChange={(e) => props.onSearchQueryChange(e.target.value)}
                />
                <span
                    className="aoi-icon aoi-icon--search aoi-search__icon"
                    aria-hidden="true"
                />
            </label>

            {props.searchLoading && (
                <p className="aoi-panel__empty">Loading boundary data…</p>
            )}

            {!props.searchLoading && props.searchDisabled && (
                <p className="aoi-panel__empty">
                    No boundary data is available for this mission.
                </p>
            )}

            {!inputDisabled && props.searchResults.length > 0 && (
                <ul className="aoi-search__results" role="listbox">
                    {props.searchResults.map((r) => (
                        <li key={r.id}>
                            <button
                                type="button"
                                className="aoi-search__result"
                                onClick={() => props.onSearchSelect(r.id)}
                            >
                                <span className="aoi-search__result-label">{r.label}</span>
                                <span className="aoi-search__result-kind">{r.kind}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function InspectPanel() {
    return (
        <div className="aoi-panel aoi-panel--inspect">
            <p className="aoi-panel__hint">
                Click on a boundary on the map to select it for analysis.
            </p>
        </div>
    )
}

function DrawPanel(props: AOIComponentProps) {
    if (props.isDrawing && props.drawShape) {
        return <DrawInProgressPanel {...props} />
    }
    return <DrawShapePickerPanel {...props} />
}

const ALL_SHAPES: Array<{ id: AOIShape; label: string; icon: string }> = [
    { id: 'point', label: 'Point', icon: 'map-marker-outline' },
    { id: 'linestring', label: 'Line', icon: 'vector-polyline' },
    { id: 'polygon', label: 'Polygon', icon: 'vector-polygon' },
    { id: 'rectangle', label: 'Rectangle', icon: 'square-outline' },
    { id: 'circle', label: 'Circle', icon: 'circle-outline' },
]

const DEFAULT_ALLOWED_SHAPES: AOIShape[] = ['polygon', 'rectangle', 'circle']

function DrawShapePickerPanel(props: AOIComponentProps) {
    const allow = new Set(props.drawShapes ?? DEFAULT_ALLOWED_SHAPES)
    const shapes = ALL_SHAPES.filter((s) => allow.has(s.id))
    return (
        <div className="aoi-panel aoi-panel--draw">
            <p className="aoi-panel__hint">Choose a shape</p>
            <div className="aoi-draw__shapes" role="group" aria-label="Shape">
                {shapes.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        className={
                            'aoi-draw__shape' +
                            (props.drawShape === s.id
                                ? ' aoi-draw__shape--active'
                                : '')
                        }
                        disabled={props.drawDisabled}
                        onClick={() => props.onDrawShapeChange(s.id)}
                        aria-pressed={props.drawShape === s.id}
                        aria-label={s.label}
                    >
                        <i
                            className={`mdi mdi-${s.icon} aoi-draw__shape-icon`}
                            aria-hidden="true"
                        />
                    </button>
                ))}
            </div>
            <p className="aoi-panel__hint aoi-panel__hint--secondary">
                Click anywhere on the map to start drawing a shape
            </p>
        </div>
    )
}

// The finish gestures of polygon and line are inert until the shape has enough
// vertices to close, so name them only from that vertex on.
function vertexHint(count: number, min: number, finish: string): string {
    return (
        `Click on the map to add vertices. ${count} placed (need ${min}+). ` +
        (count >= min ? `${finish} ` : '') +
        'Esc to cancel.'
    )
}

// Two-click shapes (rectangle, circle) finish on their final click, so their
// hints must not advertise Enter/double-click — only gestures that work.
const HINT_BY_SHAPE: Record<AOIShape, (count: number) => string> = {
    point: () => 'Click on the map to place the point. Esc to cancel.',
    linestring: (count) =>
        vertexHint(count, 2, 'Press Enter or double-click to finish.'),
    polygon: (count) =>
        vertexHint(
            count,
            3,
            'Press Enter, double-click, or click the first vertex to finish.'
        ),
    rectangle: (count) =>
        count < 1
            ? 'Click the first corner of the rectangle. Esc to cancel.'
            : 'Click the opposite corner to finish. Esc to cancel.',
    circle: (count) =>
        count < 1
            ? 'Click the center of the circle. Esc to cancel.'
            : 'Click the edge to set the radius and finish. Esc to cancel.',
}

function DrawInProgressPanel(props: AOIComponentProps) {
    const hint = HINT_BY_SHAPE[props.drawShape!](props.drawVerticesCount)

    return (
        <div className="aoi-panel aoi-panel--draw">
            <p className="aoi-panel__hint">{hint}</p>
        </div>
    )
}

function UploadPanel(props: AOIComponentProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
        <div className="aoi-panel aoi-panel--upload">
            <p className="aoi-panel__hint">
                Upload a GeoJSON, KML, or zipped Shapefile to define your analysis area.
            </p>

            <Button
                type="button"
                className="aoi-upload__button"
                onClick={() => inputRef.current?.click()}
                disabled={props.uploadStatus === 'parsing'}
            >
                {props.uploadStatus === 'parsing' ? 'Parsing…' : 'Upload file'}
            </Button>
            <input
                ref={inputRef}
                type="file"
                accept=".geojson,.json,.kml,.zip,.shp"
                className="aoi-upload__input"
                onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) props.onUploadFile(f)
                    e.target.value = ''
                }}
            />

            {props.uploadStatus === 'error' && (
                <Alert type="error" headingLevel="h4" slim className="aoi-panel__error">
                    {props.uploadError || 'Could not parse that file.'}
                </Alert>
            )}

            <p className="aoi-panel__hint">
                Supported formats:
            </p>
            <ul className="aoi-upload__formats">
                <li>GeoJSON (.geojson, .json)</li>
                <li>KML (.kml)</li>
                <li>Shapefile (.zip — must include .shp, .dbf, and .prj)</li>
            </ul>
        </div>
    )
}

export default AOIComponent
