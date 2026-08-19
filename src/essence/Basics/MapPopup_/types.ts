/**
 * Payload types for the `map:showPopup` event bus provider.
 *
 * Every field of both the request and its result is JSON-serializable, so they
 * survive a `postMessage` boundary unchanged — no functions, no DOM nodes, no
 * component code. The popup's outcome travels back on the request's own
 * promise, so nothing about a popup is broadcast on the bus.
 *
 * Who is asking is deliberately not one of these fields. The core needs it to
 * decide whose popup a `map:hidePopup` may retract, but a request an author
 * fills in is the wrong place to keep it: the id is stamped by the plugin's
 * bus handle and travels beside the payload, so it is never an author's to
 * write and never core's to take on trust from one. It is plain data today,
 * which the sandbox bridge is what will later make unforgeable.
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
    /** Filled button, rendered first in the actions row. */
    primaryAction?: MapPopupAction
    /** Outlined button, rendered last in the actions row. */
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
