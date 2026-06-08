import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { AddTempLayerInput, validateUrl, detectLayerType } from './addTempLayerHelpers'
import './AddTempLayerComponent.scss'

export interface AddTempLayerComponentProps {
    /** Submit a layer to add. Wired to mmgisAPI.addLayer by the wrapper (later). */
    onAddLayer?: (input: AddTempLayerInput) => void
}

export function AddTempLayerComponent({ onAddLayer }: AddTempLayerComponentProps) {
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
                'This link is not supported. Please paste a valid WMS, WMTS, or GeoJSON URL.'
            )
            return
        }

        setError(null)
        setSubmitting(true)
        Promise.resolve(
            onAddLayer?.({
                url: trimmedUrl,
                displayName: displayName.trim() || undefined,
            })
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
        <div className="add-temp-layer">
            <button
                type="button"
                className="add-temp-layer__trigger"
                onClick={() => setOpen(true)}
            >
                <PlusIcon />
                <span className="add-temp-layer__trigger-label">Add layer from URL</span>
            </button>

            {open &&
                createPortal(
                    <div className="add-temp-layer__overlay">
                        <div
                            className="add-temp-layer__modal"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Add layer from URL"
                        >
                            <div className="add-temp-layer__modal-header">
                                <span className="add-temp-layer__modal-title">
                                    <LinkIcon />
                                    Add layer from URL
                                </span>
                                <button
                                    type="button"
                                    className="add-temp-layer__close"
                                    onClick={close}
                                    aria-label="Close"
                                >
                                    <CloseIcon />
                                </button>
                            </div>

                            <div className="add-temp-layer__modal-body">
                                <p className="add-temp-layer__help">
                                    Provide a WMS, WMTS, or GeoJSON link to add to your layer gallery.
                                </p>

                                <label className="add-temp-layer__field">
                                    <span className="add-temp-layer__label">URL</span>
                                    <input
                                        type="text"
                                        className={`add-temp-layer__input${
                                            error ? ' add-temp-layer__input--error' : ''
                                        }`}
                                        placeholder="http://"
                                        value={url}
                                        onChange={(e) => onUrlChange(e.target.value)}
                                    />
                                    {error && (
                                        <span className="add-temp-layer__error">{error}</span>
                                    )}
                                </label>

                                <label className="add-temp-layer__field">
                                    <span className="add-temp-layer__label">
                                        Display name (optional)
                                    </span>
                                    <input
                                        type="text"
                                        className="add-temp-layer__input"
                                        placeholder="My imported layer"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                    />
                                </label>

                                <div className="add-temp-layer__behaviour">
                                    <ul className="add-temp-layer__behaviour-list">
                                        <li>Color map is fixed (returned with the request)</li>
                                        <li>Min &amp; max values are fixed (if returned)</li>
                                        <li>No date / time controls (WCS-time disabled)</li>
                                        <li>Only the opacity slider is editable</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="add-temp-layer__modal-footer">
                                <button
                                    type="button"
                                    className="add-temp-layer__submit"
                                    onClick={handleAdd}
                                    disabled={submitting}
                                >
                                    {submitting ? 'Adding…' : 'Add layer'}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
        </div>
    )
}

// ─── Inline Material/USWDS glyphs (portable; no sprite/MDI-font coupling) ───

function Icon({ size = 18, children }: { size?: number; children: React.ReactNode }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            {children}
        </svg>
    )
}

function PlusIcon() {
    return (
        <Icon size={16}>
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </Icon>
    )
}

function LinkIcon() {
    return (
        <Icon>
            <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
        </Icon>
    )
}

function CloseIcon() {
    return (
        <Icon>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </Icon>
    )
}

export default AddTempLayerComponent
