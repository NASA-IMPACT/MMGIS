/**
 * Payload types for the `map:showPopup` event bus provider.
 *
 * Every field is JSON-serializable so a request survives a `postMessage`
 * boundary unchanged — no functions, no DOM nodes, no component code.
 */

export interface MapPopupAction {
    /** Button text. Rendered as text, never HTML. */
    label: string
    /** Bus event name broadcast (with no payload) when the button is clicked. */
    event: string
}

export interface MapPopupRequest {
    /** Map coordinate the popup is anchored to. */
    latlng: { lat: number; lng: number }
    /** Popup body. Sanitized by the core before it reaches the DOM. */
    html: string
    /** Filled button, rendered last in the actions row. */
    primaryAction?: MapPopupAction
    /** Outlined button, rendered first in the actions row. */
    secondaryAction?: MapPopupAction
    /** Bus event broadcast when the user dismisses via X, click-away, or Escape. */
    dismissEvent?: string
}
