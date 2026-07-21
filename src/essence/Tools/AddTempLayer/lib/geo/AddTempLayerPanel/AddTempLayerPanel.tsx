import React, { useState } from 'react'
import type { AddTempLayerInput } from '../../types'
import { validateUrl, detectLayerType, validateForType } from '../../utils/url'
import { AddLayerModal } from '../AddLayerModal/AddLayerModal'

export type AddTempLayerPanelProps = {
    /** Submit a layer to add. Resolves on success, rejects to show an error. */
    onAddLayer?: (input: AddTempLayerInput) => void | Promise<unknown>
    /** Dismiss the form — the host hides the hosting panel/plugin. */
    onClose?: () => void
}

export function AddTempLayerPanel({ onAddLayer, onClose }: AddTempLayerPanelProps) {
    const [url, setUrl] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    function close() {
        setError(null)
        setSubmitting(false)
        onClose?.()
    }

    function onUrlChange(next: string) {
        setUrl(next)
        if (error) setError(null)
    }

    function handleAdd() {
        const trimmedUrl = url.trim()
        // Basic URL sanity.
        if (!validateUrl(trimmedUrl)) {
            setError('Please enter a valid http(s) URL.')
            return
        }
        // Stage 1 — detect the type, or reject as an unsupported kind of URL.
        const type = detectLayerType(trimmedUrl)
        if (!type) {
            setError(
                'We can’t add that layer — this URL isn’t supported. We support XYZ, WMS, WMTS, and GeoJSON.',
            )
            return
        }
        // Stage 2 — validate the URL is structurally usable for that type.
        const result = validateForType(type, trimmedUrl)
        if (!result.ok) {
            setError(result.message || 'This URL isn’t valid for its type.')
            return
        }

        setError(null)
        setSubmitting(true)
        Promise.resolve(
            onAddLayer?.({
                url: trimmedUrl,
                type,
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
    )
}
