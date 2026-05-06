import React, { useEffect, useRef } from 'react'
import './AOIComponent.css'

export type AOIMode = 'search' | 'inspect' | 'draw' | 'upload'
export type AOIShape = 'polygon' | 'rectangle' | 'circle'
export type UploadStatus = 'idle' | 'parsing' | 'error'

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
    drawDisabled?: boolean
    isDrawing: boolean
    drawVerticesCount: number
    onDrawShapeChange: (shape: AOIShape) => void
    onDrawConfirm: () => void
    onDrawCancel: () => void

    uploadStatus: UploadStatus
    uploadError?: string
    onUploadFile: (file: File) => void

    onClose: () => void
}

const MODES: Array<{ id: AOIMode; label: string; icon: string }> = [
    { id: 'search', label: 'Search', icon: 'magnify' },
    { id: 'inspect', label: 'Inspect', icon: 'hand-pointing-up' },
    { id: 'draw', label: 'Draw', icon: 'vector-polyline' },
    { id: 'upload', label: 'Upload', icon: 'tray-arrow-up' },
]

export function AOIComponent(props: AOIComponentProps) {
    return (
        <div className="aoi-tool" role="region" aria-label="Analyze areas">
            <header className="aoi-tool__header">
                <div className="aoi-tool__title">
                    <i className="mdi mdi-chart-bar aoi-tool__title-icon" aria-hidden="true" />
                    <span>Analyze areas</span>
                </div>
                <button
                    type="button"
                    className="aoi-tool__close"
                    onClick={props.onClose}
                    aria-label="Close"
                >
                    <i className="mdi mdi-close" aria-hidden="true" />
                </button>
            </header>

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
                        <i
                            className={`mdi mdi-${m.icon} aoi-tool__tab-icon`}
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
                <input
                    ref={inputRef}
                    type="search"
                    className="aoi-search__input"
                    placeholder={props.searchLoading ? 'Loading boundaries…' : 'Search'}
                    value={props.searchQuery}
                    disabled={inputDisabled}
                    onChange={(e) => props.onSearchQueryChange(e.target.value)}
                />
                <i className="mdi mdi-magnify aoi-search__icon" aria-hidden="true" />
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

function DrawShapePickerPanel(props: AOIComponentProps) {
    const shapes: Array<{ id: AOIShape; label: string; icon: string }> = [
        { id: 'polygon', label: 'Polygon', icon: 'vector-polygon' },
        { id: 'rectangle', label: 'Rectangle', icon: 'square-outline' },
        { id: 'circle', label: 'Circle', icon: 'circle-outline' },
    ]
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

function DrawInProgressPanel(props: AOIComponentProps) {
    const shape = props.drawShape!
    const minVertices = shape === 'polygon' ? 3 : 2
    const valid = props.drawVerticesCount >= minVertices
    const hint =
        shape === 'polygon'
            ? `Click on the map to add vertices. ${props.drawVerticesCount} placed (need ${minVertices}+).`
            : shape === 'rectangle'
                ? 'Click two corners to define the rectangle.'
                : 'Click the centre, then click the edge to define the circle.'

    return (
        <div className="aoi-panel aoi-panel--draw">
            <p className="aoi-panel__hint">{hint}</p>
            <div className="aoi-draw__actions" role="group" aria-label="Drawing actions">
                <button
                    type="button"
                    className="aoi-draw__confirm"
                    onClick={props.onDrawConfirm}
                    disabled={!valid}
                >
                    Confirm
                </button>
                <button
                    type="button"
                    className="aoi-draw__cancel"
                    onClick={props.onDrawCancel}
                >
                    Cancel
                </button>
            </div>
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

            <button
                type="button"
                className="aoi-upload__button"
                onClick={() => inputRef.current?.click()}
                disabled={props.uploadStatus === 'parsing'}
            >
                {props.uploadStatus === 'parsing' ? 'Parsing…' : 'Upload file'}
            </button>
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
                <p className="aoi-panel__error" role="alert">
                    {props.uploadError || 'Could not parse that file.'}
                </p>
            )}

            <p className="aoi-panel__hint aoi-panel__hint--secondary">
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
