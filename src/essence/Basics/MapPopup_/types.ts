/**
 * Payloads for the `map:showPopup` and `map:hidePopup` bus providers.
 *
 * Every field is JSON-serializable, so a request survives a `postMessage`
 * boundary unchanged — no functions, no DOM nodes. Nothing about a popup is
 * broadcast on the bus: its outcome travels back on the request's own promise.
 */

export interface MapPopupAction {
    /** Button text. Rendered as text, never as markup. */
    label: string
}

/**
 * What to show and where. The anchor is required, and so is one of the title
 * and the html: a card is free to be a heading over two buttons or a body with
 * none, but a request holding neither has nothing to show and is rejected.
 */
export interface MapPopupRequest {
    /** Map coordinate the popup is anchored to. */
    latlng: { lat: number; lng: number }
    /**
     * Heading, rendered as text: markup in a title reaches the card as the
     * characters it was written with. A blank one reads as no title at all.
     */
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
     * How the popup closed:
     * - `primary` / `secondary` — the matching button was pressed.
     * - `dismiss` — the map library took it down: its own close control, or a
     *   click on the map.
     * - `closed` — code took it down: a later request replaced it,
     *   `map:hidePopup` retracted it, or the map was re-initialized.
     */
    action: 'primary' | 'secondary' | 'dismiss' | 'closed'
}
