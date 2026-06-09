import React, { useRef } from 'react'
import { Alert, Button } from '@trussworks/react-uswds'
import type { UploadStatus } from '../../types'

export type UploadPanelProps = {
    status: UploadStatus
    error?: string
    onUploadFile: (file: File) => void
}

export function UploadPanel({ status, error, onUploadFile }: UploadPanelProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    return (
        <div className="blocks-aoi-panel blocks-aoi-panel--upload">
            <p className="blocks-aoi-panel__hint">
                Upload a GeoJSON, KML, or zipped Shapefile to define your analysis area.
            </p>

            <Button
                type="button"
                outline
                className="blocks-aoi-upload__button"
                onClick={() => inputRef.current?.click()}
                disabled={status === 'parsing'}
            >
                {status === 'parsing' ? 'Parsing…' : 'Upload file'}
            </Button>
            <input
                ref={inputRef}
                type="file"
                accept=".geojson,.json,.kml,.zip,.shp"
                className="blocks-aoi-upload__input"
                onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) onUploadFile(f)
                    e.target.value = ''
                }}
            />

            {status === 'error' && (
                <Alert type="error" headingLevel="h4" slim className="blocks-aoi-panel__error">
                    {error || 'Could not parse that file.'}
                </Alert>
            )}

            <p className="blocks-aoi-panel__hint blocks-aoi-panel__hint--secondary">
                Supported formats:
            </p>
            <ul className="blocks-aoi-upload__formats">
                <li>GeoJSON (.geojson, .json)</li>
                <li>KML (.kml)</li>
                <li>Shapefile (.zip — must include .shp, .dbf, and .prj)</li>
            </ul>
        </div>
    )
}
