import React from 'react'
import { Button } from '@trussworks/react-uswds'
import type {
    AOIMode,
    AOIShape,
    AOISearchResult,
    UploadStatus,
    AnalysisStatus,
} from '../../types'
import { SearchPanel } from '../SearchPanel/SearchPanel'
import { InspectPanel } from '../InspectPanel/InspectPanel'
import { DrawPanel } from '../DrawPanel/DrawPanel'
import { UploadPanel } from '../UploadPanel/UploadPanel'
import { AnalyzingPanel } from '../AnalyzingPanel/AnalyzingPanel'

export interface AOIPanelProps {
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
    onDrawConfirm: () => void
    onDrawCancel: () => void

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

const MODES: Array<{ id: AOIMode; label: string; icon: string }> = [
    { id: 'search', label: 'Search', icon: 'magnify' },
    { id: 'inspect', label: 'Inspect', icon: 'hand-pointing-up' },
    { id: 'draw', label: 'Draw', icon: 'vector-polyline' },
    { id: 'upload', label: 'Upload', icon: 'tray-arrow-up' },
]

export function AOIPanel(props: AOIPanelProps) {
    const isAnalyzing = props.analysisStatus === 'running'

    return (
        <div className="blocks-aoi-tool" role="region" aria-label="Analyze areas">
            <header className="blocks-aoi-tool__header">
                <div className="blocks-aoi-tool__title">
                    <i className="mdi mdi-chart-bar blocks-aoi-tool__title-icon" aria-hidden="true" />
                    <span>Analyze areas</span>
                </div>
                <Button
                    type="button"
                    unstyled
                    className="blocks-aoi-tool__close"
                    onClick={props.onClose}
                    aria-label="Close"
                >
                    <i className="mdi mdi-close" aria-hidden="true" />
                </Button>
            </header>

            {props.analysisError ? (
                <div className="blocks-aoi-tool__alert blocks-aoi-tool__alert--error" role="alert">
                    <i className="mdi mdi-alert-circle blocks-aoi-tool__alert-icon" aria-hidden="true" />
                    <p className="blocks-aoi-tool__alert-text">{props.analysisError}</p>
                    {props.onDismissAnalysisError && (
                        <button
                            type="button"
                            className="blocks-aoi-tool__alert-dismiss"
                            onClick={props.onDismissAnalysisError}
                            aria-label="Dismiss notice"
                        >
                            <i className="mdi mdi-close" aria-hidden="true" />
                        </button>
                    )}
                </div>
            ) : null}

            {isAnalyzing ? (
                <AnalyzingPanel
                    label={props.analysisLabel || 'Area of interest'}
                    done={props.analysisDone ?? 0}
                    total={props.analysisTotal ?? 0}
                />
            ) : (
                <>
                    <nav className="blocks-aoi-tool__tabs" role="tablist" aria-label="AOI selection mode">
                        {MODES.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                role="tab"
                                aria-selected={props.mode === m.id}
                                className={
                                    'blocks-aoi-tool__tab' +
                                    (props.mode === m.id ? ' blocks-aoi-tool__tab--active' : '')
                                }
                                onClick={() => props.onModeChange(m.id)}
                            >
                                <i className={`mdi mdi-${m.icon} blocks-aoi-tool__tab-icon`} aria-hidden="true" />
                                <span className="blocks-aoi-tool__tab-label">{m.label}</span>
                            </button>
                        ))}
                    </nav>

                    <div className="blocks-aoi-tool__body" role="tabpanel">
                        {props.mode === 'search' && (
                            <SearchPanel
                                query={props.searchQuery}
                                results={props.searchResults}
                                disabled={props.searchDisabled}
                                loading={props.searchLoading}
                                onQueryChange={props.onSearchQueryChange}
                                onSelect={props.onSearchSelect}
                            />
                        )}
                        {props.mode === 'inspect' && <InspectPanel />}
                        {props.mode === 'draw' && (
                            <DrawPanel
                                shape={props.drawShape}
                                shapes={props.drawShapes}
                                disabled={props.drawDisabled}
                                isDrawing={props.isDrawing}
                                verticesCount={props.drawVerticesCount}
                                onShapeChange={props.onDrawShapeChange}
                                onConfirm={props.onDrawConfirm}
                                onCancel={props.onDrawCancel}
                            />
                        )}
                        {props.mode === 'upload' && (
                            <UploadPanel
                                status={props.uploadStatus}
                                error={props.uploadError}
                                onUploadFile={props.onUploadFile}
                            />
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
