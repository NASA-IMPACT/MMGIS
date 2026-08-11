/**
 * Payload types for the `map:showPopup` event bus provider.
 *
 * Every field of both the request and its result is JSON-serializable, so they
 * survive a `postMessage` boundary unchanged — no functions, no DOM nodes, no
 * component code. The popup's outcome travels back on the request's own
 * promise, so nothing about a popup is broadcast on the bus.
 */

export interface MapPopupAction {
    /** Button text. Rendered as text, never HTML. */
    label: string
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
}

export interface MapPopupResult {
    /**
     * How the popup closed:
     * - `primary` / `secondary` — the matching button was pressed.
     * - `dismiss` — the user dismissed it with the X or a click on the map.
     * - `closed` — it went away without the user acting on it: a later request
     *   replaced it, `map:hidePopup` retracted it, or the map was torn down.
     */
    action: 'primary' | 'secondary' | 'dismiss' | 'closed'
}
