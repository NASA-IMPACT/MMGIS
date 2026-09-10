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
 * fills in is the wrong place to keep it: the address is stamped by the
 * plugin's bus handle and travels beside the payload, so it is never an
 * author's to write and never core's to take on trust from one.
 */

export interface MapPopupAction {
    /** Button text. Rendered as text, never HTML. */
    label: string
}

/**
 * What to show and where. The anchor is required, and so is one of the title
 * and the html: a card is free to be a heading over two buttons or a body with
 * none, but a request holding neither has nothing to show and is rejected.
 */
export interface MapPopupRequest {
    /** Map coordinate the popup is anchored to, tracked as the map moves. */
    latlng: { lat: number; lng: number }
    /**
     * Heading, rendered on the close control's row. Text, never HTML: markup
     * in a title reaches the card as the characters it was written with, the
     * same way a button label does. A blank one reads as no title at all.
     */
    title?: string
    /**
     * Popup body, sanitized by the core with DOMPurify's defaults before it
     * reaches the DOM. What an author owns is the inside of the card and
     * nothing past it: a stylesheet of their own is stripped rather than let
     * loose on the app, nothing may reach the browser's top layer, and a link
     * that goes anywhere opens in a tab of its own rather than navigating the
     * app away.
     */
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
     * - `dismiss` — the user dismissed it with the X, with Escape, or with a
     *   click on empty map.
     * - `closed` — it went away without the user acting on it: a later request
     *   replaced it, `map:hidePopup` retracted it, or the plugin that opened
     *   it was torn down.
     */
    action: 'primary' | 'secondary' | 'dismiss' | 'closed'
}
