import React from 'react'
import { createPortal } from 'react-dom'
import { LinkIcon, CloseIcon } from '../../utils/icons'

export type AddLayerModalProps = {
    /** Current URL field value. */
    url: string
    /** Current display-name field value. */
    displayName: string
    /** Validation / submission error to surface under the URL field. */
    error?: string | null
    /** Disables the submit button while a request is in flight. */
    submitting?: boolean
    onUrlChange: (next: string) => void
    onDisplayNameChange: (next: string) => void
    onSubmit: () => void
    onClose: () => void
}

export function AddLayerModal({
    url,
    displayName,
    error,
    submitting,
    onUrlChange,
    onDisplayNameChange,
    onSubmit,
    onClose,
}: AddLayerModalProps) {
    return createPortal(
        <div className="blocks-add-layer-modal__overlay">
            <div
                className="blocks-add-layer-modal__dialog"
                role="dialog"
                aria-modal="true"
                aria-label="Add layer from URL"
            >
                <div className="blocks-add-layer-modal__header">
                    <span className="blocks-add-layer-modal__title">
                        <LinkIcon />
                        Add layer from URL
                    </span>
                    <button
                        type="button"
                        className="blocks-add-layer-modal__close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="blocks-add-layer-modal__body">
                    <p className="blocks-add-layer-modal__help">
                        Provide a WMS, WMTS, or GeoJSON link to add to your layer gallery.
                    </p>

                    <label className="blocks-add-layer-modal__field">
                        <span className="blocks-add-layer-modal__label">URL</span>
                        <input
                            type="text"
                            className={`blocks-add-layer-modal__input${
                                error ? ' blocks-add-layer-modal__input--error' : ''
                            }`}
                            placeholder="http://"
                            value={url}
                            onChange={(e) => onUrlChange(e.target.value)}
                        />
                        {error && (
                            <span className="blocks-add-layer-modal__error">{error}</span>
                        )}
                    </label>

                    <label className="blocks-add-layer-modal__field">
                        <span className="blocks-add-layer-modal__label">
                            Display name (optional)
                        </span>
                        <input
                            type="text"
                            className="blocks-add-layer-modal__input"
                            placeholder="My imported layer"
                            value={displayName}
                            onChange={(e) => onDisplayNameChange(e.target.value)}
                        />
                    </label>

                    <div className="blocks-add-layer-modal__behaviour">
                        <ul className="blocks-add-layer-modal__behaviour-list">
                            <li>Color map is fixed (returned with the request)</li>
                            <li>Min &amp; max values are fixed (if returned)</li>
                            <li>No date / time controls (WCS-time disabled)</li>
                            <li>Only the opacity slider is editable</li>
                        </ul>
                    </div>
                </div>

                <div className="blocks-add-layer-modal__footer">
                    <button
                        type="button"
                        className="blocks-add-layer-modal__submit"
                        onClick={onSubmit}
                        disabled={submitting}
                    >
                        {submitting ? 'Adding…' : 'Add layer'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )
}
