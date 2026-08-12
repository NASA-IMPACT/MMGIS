import React, { useState } from 'react'
import type { AddTempLayerInput } from '../../types'
import { validateUrl, detectLayerType } from '../../utils/url'
import { AddLayerModal } from '../AddLayerModal/AddLayerModal'

export type AddTempLayerPanelProps = {
    /** Submit a layer to add. Resolves on success, rejects to show an error. */
    onAddLayer?: (input: AddTempLayerInput) => void | Promise<unknown>
    /** Dismiss the form — the host hides the hosting panel/plugin. */
    onClose?: () => void
    /**
     * The map engine's verdict on the most recently added layer, reported
     * after the add (null while unknown or once the layer loads fine). Layers
     * are added optimistically — this is how load failures reach the user.
     */
    engineError?: string | null
}

export function AddTempLayerPanel({
    onAddLayer,
    onClose,
    engineError,
}: AddTempLayerPanelProps) {
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
        // Detect the type, or reject as an unsupported kind of URL. That's the
        // only gate — the layer is added optimistically and the map engine
        // reports whether it actually loads (surfaced via engineError).
        const type = detectLayerType(trimmedUrl)
        if (!type) {
            setError(
                'We can’t add that layer — this URL isn’t supported. We support XYZ, WMS, WMTS, and GeoJSON.',
            )
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
            error={error || engineError || null}
            submitting={submitting}
            onUrlChange={onUrlChange}
            onDisplayNameChange={setDisplayName}
            onSubmit={handleAdd}
            onClose={close}
        />
    )
}
