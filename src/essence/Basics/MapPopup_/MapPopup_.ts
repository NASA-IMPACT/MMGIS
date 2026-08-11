import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to a viewport edge. */
const VIEWPORT_MARGIN = 8
/** How far in pixels an anchor may sit outside the map before the card hides. */
const CONTAINER_MARGIN = 4

interface OpenPopup {
    card: HTMLElement
    engine: IMapEngine
    latlng: { lat: number; lng: number }
    /** Settles this popup's request promise with how the popup closed. */
    settle: (result: MapPopupResult) => void
    offMapClick: () => void
    /** Pending subscription to `map:click`, see `show`. */
    subscribeTimer: ReturnType<typeof setTimeout> | null
    /** Watches the card for late-reflowing content. Absent outside browsers. */
    cardResize: ResizeObserver | null
}

/** The two button slots a card can render. */
type ActionSlot = 'primary' | 'secondary'

interface PopupCardOptions {
    /** Popup body, already sanitized by the caller. */
    html: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    /** Called with the slot of the clicked action button. */
    onAction: (action: ActionSlot) => void
    /** Called when the close control is pressed. */
    onClose: () => void
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== ''
}

/**
 * Accept an action only when its label is usable, so a malformed request
 * cannot render a blank button.
 */
function normalizeAction(
    action: MapPopupAction | undefined,
    field: string
): MapPopupAction | undefined {
    if (action == null) return undefined
    const { label } = action
    if (isNonEmptyString(label)) return { label }
    console.warn(
        `[MapPopup] Ignoring ${field}: label must be a non-empty string.`
    )
    return undefined
}

function buildActionButton(
    label: string,
    variant: ActionSlot,
    onAction: (action: ActionSlot) => void
): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `mmgis-map-popup__button mmgis-map-popup__button--${variant}`
    button.textContent = label
    button.addEventListener('click', () => onAction(variant))
    return button
}

/**
 * Build the popup card element. Pure view: it renders the given content and
 * reports clicks back through the callbacks, with no knowledge of the event
 * bus, the map, or where the card is positioned.
 */
function buildPopupCard(options: PopupCardOptions): HTMLElement {
    const card = document.createElement('div')
    card.className = 'mmgis-map-popup'
    card.setAttribute('role', 'group')
    card.setAttribute('aria-label', 'Map popup')
    // Stays hidden until a projection lands, so the card never flashes at the
    // top-left corner before it is positioned.
    card.style.visibility = 'hidden'

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'mmgis-map-popup__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', options.onClose)
    card.appendChild(close)

    const content = document.createElement('div')
    content.className = 'mmgis-map-popup__content'
    content.innerHTML = options.html
    card.appendChild(content)

    const { primaryAction, secondaryAction, onAction } = options
    if (primaryAction || secondaryAction) {
        const actions = document.createElement('div')
        actions.className = 'mmgis-map-popup__actions'
        if (secondaryAction) {
            actions.appendChild(
                buildActionButton(secondaryAction.label, 'secondary', onAction)
            )
        }
        if (primaryAction) {
            actions.appendChild(
                buildActionButton(primaryAction.label, 'primary', onAction)
            )
        }
        card.appendChild(actions)
    }

    return card
}

/**
 * Stable handler identities, so the engine and window subscriptions made in
 * `show` can be removed again in `hide`.
 */
const reposition = (): void => MapPopup_._reposition()
const hideForZoom = (): void => MapPopup_._hideForZoom()

/**
 * Core-owned, map-anchored popup.
 *
 * A single popup exists at a time: a fresh request replaces the current one.
 * The popup is hosted on `document.body` rather than inside the map container
 * so it paints above the panel layer and so clicks on it can never reach the
 * map engine's own click pipeline.
 */
const MapPopup_ = {
    _open: null as OpenPopup | null,

    /**
     * Show a popup anchored to `request.latlng`, replacing any current popup.
     *
     * @param request Serializable popup description from the event bus.
     * @param engine The active map engine, used to project the anchor.
     * @returns A promise that stays pending for as long as the popup is open
     * and resolves with how it closed. It rejects when the request is invalid
     * or the popup could not be mounted, in which case nothing is shown.
     */
    show(
        request: MapPopupRequest,
        engine: IMapEngine
    ): Promise<MapPopupResult> {
        if (
            !request ||
            typeof request.html !== 'string' ||
            !request.latlng ||
            !isFiniteNumber(request.latlng.lat) ||
            !isFiniteNumber(request.latlng.lng)
        ) {
            return Promise.reject(
                new Error(
                    '[MapPopup] Invalid request: html must be a string and latlng must hold finite lat/lng numbers.'
                )
            )
        }

        this.hide()

        let settle: (result: MapPopupResult) => void
        let fail: (error: Error) => void
        const outcome = new Promise<MapPopupResult>((resolve, reject) => {
            settle = resolve
            fail = reject
        })

        const popup: OpenPopup = {
            card: buildPopupCard({
                html: DOMPurify.sanitize(request.html),
                primaryAction: normalizeAction(
                    request.primaryAction,
                    'primaryAction'
                ),
                secondaryAction: normalizeAction(
                    request.secondaryAction,
                    'secondaryAction'
                ),
                // The popup closes before its request is answered, so a caller
                // that opens its own popup in response keeps it. A button
                // press never counts as a dismissal.
                onAction: (action) => this.hide({ action }),
                onClose: () => this.hide({ action: 'dismiss' }),
            }),
            engine,
            latlng: { lat: request.latlng.lat, lng: request.latlng.lng },
            settle,
            offMapClick: () => {},
            subscribeTimer: null,
            cardResize: null,
        }

        // Recorded before anything is wired so that a failure part-way through
        // can be unwound by `hide`, leaving nothing subscribed or mounted.
        this._open = popup
        try {
            document.body.appendChild(popup.card)
            engine.on('move', reposition)
            engine.on('zoomstart', hideForZoom)
            engine.on('zoomend', reposition)
            window.addEventListener('resize', reposition)
            if (typeof ResizeObserver === 'function') {
                popup.cardResize = new ResizeObserver(reposition)
                popup.cardResize.observe(popup.card)
            }
            // The gesture that opens a popup usually carries the very map
            // click that would dismiss it, so this popup does not listen for
            // clicks until the task that opened it has run to completion.
            popup.subscribeTimer = setTimeout(() => {
                popup.subscribeTimer = null
                popup.offMapClick = window.mmgisAPI.on('map:click', () => {
                    // A replacement popup can still be shown later in the
                    // same gesture, so the dismissal waits a task too and
                    // fires only while this popup is still the open one.
                    setTimeout(() => {
                        if (this._open === popup) {
                            this.hide({ action: 'dismiss' })
                        }
                    }, 0)
                })
            }, 0)
        } catch (err) {
            // Reject before unwinding, so the request is answered with the
            // failure rather than with the `closed` of its own teardown.
            fail(new Error(`[MapPopup] Could not show the popup: ${err}`))
            this.hide()
            return outcome
        }

        this._reposition()
        return outcome
    },

    /**
     * Close the current popup, if any, and answer the request that opened it.
     *
     * @param action How the popup closed. Pass `'dismiss'` for a user
     * dismissal (the X and a click elsewhere on the map) and `'primary'` or
     * `'secondary'` for a button press; the default `'closed'` covers
     * replacement, `map:hidePopup`, and teardown, where the popup goes away
     * without the user acting on it.
     */
    hide({
        action = 'closed',
    }: { action?: MapPopupResult['action'] } = {}): void {
        const open = this._open
        if (!open) return
        this._open = null

        try {
            if (open.card.parentNode)
                open.card.parentNode.removeChild(open.card)
            if (open.subscribeTimer !== null) clearTimeout(open.subscribeTimer)
            open.cardResize?.disconnect()

            try {
                open.engine.off('move', reposition)
                open.engine.off('zoomstart', hideForZoom)
                open.engine.off('zoomend', reposition)
            } catch {
                // Teardown can run after the engine has been destroyed (the
                // map is re-initialised), in which case unsubscribing throws.
            }
            window.removeEventListener('resize', reposition)
            open.offMapClick()
        } finally {
            // Answer the request whatever teardown did, so a throw part-way
            // through cannot leave the caller waiting on a popup that is
            // already gone. A rejection raised before the unwind still sticks:
            // the first settlement is the answer.
            open.settle({ action })
        }
    },

    /**
     * Blank the card for the duration of a zoom.
     *
     * Leaflet animates a zoom by transforming its panes and emits no `move`
     * until the animation lands, so a card left on screen would hang at its
     * pre-zoom position and then jump. Hiding it is the honest reading; the
     * `move` and `zoomend` that follow the animation put it back. Engines that
     * report every zoom frame (deck.gl) emit no `zoomstart` and keep tracking.
     */
    _hideForZoom(): void {
        if (this._open) this._open.card.style.visibility = 'hidden'
    },

    /** Project the anchor to viewport coordinates and move the card there. */
    _reposition(): void {
        const open = this._open
        if (!open) return
        try {
            const point = open.engine.latLngToContainerPoint(open.latlng) as {
                x: number
                y: number
            }
            const container = open.engine.getContainer().getBoundingClientRect()

            // Nothing clips a body-hosted card to the map, so an anchor that
            // has panned off the map hides its card rather than parking it at
            // the viewport edge. It returns when the anchor does.
            if (
                point.x < -CONTAINER_MARGIN ||
                point.y < -CONTAINER_MARGIN ||
                point.x > container.width + CONTAINER_MARGIN ||
                point.y > container.height + CONTAINER_MARGIN
            ) {
                open.card.style.visibility = 'hidden'
                return
            }

            const card = open.card.getBoundingClientRect()
            const anchorTop = container.top + point.y
            const above = anchorTop - card.height - ANCHOR_GAP
            // Flip below the anchor when the card would clip the viewport top.
            const top = above < VIEWPORT_MARGIN ? anchorTop + ANCHOR_GAP : above

            const halfCard = card.width / 2
            const center = Math.min(
                Math.max(container.left + point.x, halfCard + VIEWPORT_MARGIN),
                window.innerWidth - halfCard - VIEWPORT_MARGIN
            )
            open.card.style.transform = `translate(${center - halfCard}px, ${top}px)`
            open.card.style.visibility = 'visible'
        } catch {
            // The anchor cannot be projected — before the engine has a view, or
            // once its container is gone — so the card waits, hidden, for a
            // later move to place it.
            open.card.style.visibility = 'hidden'
        }
    },
}

export default MapPopup_
