import React, { useState } from 'react'
import type { AddTempLayerInput } from '../../types'
import { validateUrl, detectLayerType } from '../../utils/url'
import { PlusIcon } from '../../utils/icons'
import { AddLayerModal } from '../AddLayerModal/AddLayerModal'

export type AddTempLayerPanelProps = {
    /** Submit a layer to add. Resolves on success, rejects to show an error. */
    onAddLayer?: (input: AddTempLayerInput) => void | Promise<unknown>
}

export function AddTempLayerPanel({ onAddLayer }: AddTempLayerPanelProps) {
    const [open, setOpen] = useState(false)
    const [url, setUrl] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    function close() {
        setOpen(false)
        setError(null)
        setSubmitting(false)
    }

    function onUrlChange(next: string) {
        setUrl(next)
        if (error) setError(null)
    }

    function handleAdd() {
        const trimmedUrl = url.trim()
        if (!validateUrl(trimmedUrl)) {
            setError('Please enter a valid http(s) URL.')
            return
        }
        if (!detectLayerType(trimmedUrl)) {
            setError(
                'This link is not supported. Please paste a valid WMS, WMTS, or GeoJSON URL.',
            )
            return
        }

        setError(null)
        setSubmitting(true)
        Promise.resolve(
            onAddLayer?.({
                url: trimmedUrl,
                displayName: displayName.trim() || undefined,
            }),
        )
            .then(() => {
                // Keep the modal open so multiple layers can be added; only the
                // close (✕) button dismisses it. Clear fields for the next add.
                setUrl('')
                setDisplayName('')
                setSubmitting(false)
                setError(null)
            })
            .catch((e) => {
                setSubmitting(false)
                setError(e?.message || 'Failed to add layer.')
            })
    }

    return (
        <div className="blocks-add-temp-layer">
            <button
                type="button"
                className="blocks-add-temp-layer__trigger"
                onClick={() => setOpen(true)}
            >
                <PlusIcon />
                <span className="blocks-add-temp-layer__trigger-label">Add layer from URL</span>
            </button>

            {open && (
                <AddLayerModal
                    url={url}
                    displayName={displayName}
                    error={error}
                    submitting={submitting}
                    onUrlChange={onUrlChange}
                    onDisplayNameChange={setDisplayName}
                    onSubmit={handleAdd}
                    onClose={close}
                />
            )}
        </div>
    )
}
