/**
 * Payloads for the `map:showPopup` and `map:hidePopup` bus providers. Every
 * field is JSON-serializable — no functions, no DOM nodes — so a request
 * survives a `postMessage` boundary unchanged.
 */

export interface MapPopupAction {
    /** Button text. Rendered as text, never as markup. */
    label: string
}

export interface MapPopupRequest {
    /** Map coordinate the popup is anchored to. */
    latlng: { lat: number; lng: number }
    /** Heading, rendered as text. */
    title?: string
    /** Card body, sanitized by the core before it reaches the DOM. */
    html?: string
    /** Filled button, rendered first in the actions row. */
    primaryAction?: MapPopupAction
    /** Outlined button, rendered last in the actions row. */
    secondaryAction?: MapPopupAction
}

export interface MapPopupResult {
    /**
     * How the popup closed. `dismiss` is a close the map library made, `closed`
     * one that code made; the Event Bus API docs list the cases.
     */
    action: 'primary' | 'secondary' | 'dismiss' | 'closed'
}
