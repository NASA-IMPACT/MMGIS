import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest } from './types'
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
    dismissEvent?: string
    offMapClick: () => void
    /** Set while the gesture that opened this popup is still being delivered. */
    ignoreMapClick: boolean
    pendingDismiss: ReturnType<typeof setTimeout> | null
}

interface PopupCardOptions {
    /** Popup body, already sanitized by the caller. */
    html: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    /** Called with the clicked action's event name. */
    onAction: (event: string) => void
    /** Called when the close control is pressed. */
    onClose: () => void
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isEventName(value: unknown): value is string {
    return typeof value === 'string' && value !== ''
}

/**
 * Accept an action only when both of its strings are usable, so a malformed
 * request cannot render a blank button that broadcasts `undefined`.
 */
function normalizeAction(
    action: MapPopupAction | undefined,
    field: string
): MapPopupAction | undefined {
    if (action == null) return undefined
    const { label, event } = action
    if (isEventName(label) && isEventName(event)) return { label, event }
    console.warn(
        `[MapPopup] Ignoring ${field}: label and event must be non-empty strings.`
    )
    return undefined
}

function buildActionButton(
    action: MapPopupAction,
    variant: 'primary' | 'secondary',
    onAction: (event: string) => void
): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `mmgis-map-popup__button mmgis-map-popup__button--${variant}`
    button.textContent = action.label
    button.addEventListener('click', () => onAction(action.event))
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
    card.setAttribute('role', 'dialog')
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
                buildActionButton(secondaryAction, 'secondary', onAction)
            )
        }
        if (primaryAction) {
            actions.appendChild(
                buildActionButton(primaryAction, 'primary', onAction)
            )
        }
        card.appendChild(actions)
    }

    return card
}

/**
 * Stable handler identity, so the engine and window subscriptions made in
 * `show` can be removed again in `hide`.
 */
const reposition = (): void => MapPopup_._reposition()

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
     * @returns `true` when the popup was shown, `false` on an invalid request.
     */
    show(request: MapPopupRequest, engine: IMapEngine): boolean {
        if (
            !request ||
            typeof request.html !== 'string' ||
            !request.latlng ||
            !isFiniteNumber(request.latlng.lat) ||
            !isFiniteNumber(request.latlng.lng)
        ) {
            console.warn(
                '[MapPopup] Ignoring request: html must be a string and latlng must hold finite lat/lng numbers.'
            )
            return false
        }

        this.hide()

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
                onAction: (event: string) => {
                    // Close first so a handler that opens its own popup in
                    // response keeps it. A button press never dismisses.
                    this.hide()
                    window.mmgisAPI.emit(event)
                },
                onClose: () => this.hide({ fireDismiss: true }),
            }),
            engine,
            latlng: { lat: request.latlng.lat, lng: request.latlng.lng },
            dismissEvent: isEventName(request.dismissEvent)
                ? request.dismissEvent
                : undefined,
            offMapClick: () => {},
            ignoreMapClick: true,
            pendingDismiss: null,
        }

        // The gesture that opens a popup usually carries the very map click
        // that would dismiss it, and the engines order `map:featureClick` and
        // `map:click` differently, so clicks are ignored until the task that
        // opened the popup has run to completion.
        setTimeout(() => {
            popup.ignoreMapClick = false
        }, 0)

        engine.on('move', reposition)
        window.addEventListener('resize', reposition)
        popup.offMapClick = window.mmgisAPI.on('map:click', () => {
            // Every deferral is anchored to its own popup: the bus hands a
            // handler the clicks of the emit it was unsubscribed during, and a
            // later request may have replaced this popup in the meantime.
            if (this._open !== popup || popup.ignoreMapClick) return
            popup.pendingDismiss = setTimeout(() => {
                popup.pendingDismiss = null
                if (this._open !== popup) return
                this.hide({ fireDismiss: true })
            }, 0)
        })

        this._open = popup
        document.body.appendChild(popup.card)
        this._reposition()
        return true
    },

    /**
     * Close the current popup, if any.
     *
     * @param fireDismiss Broadcast the request's `dismissEvent`. Set for user
     * dismissals (the X and a click elsewhere on the map) and left off for
     * replacement, button presses, and teardown.
     */
    hide({ fireDismiss = false }: { fireDismiss?: boolean } = {}): void {
        const open = this._open
        if (!open) return
        this._open = null
        if (open.pendingDismiss !== null) clearTimeout(open.pendingDismiss)

        // Teardown can run after the engine has been destroyed (mission swap),
        // in which case unsubscribing throws.
        try {
            open.engine.off('move', reposition)
        } catch (err) {
            console.warn('[MapPopup] Could not unsubscribe from the engine:', err)
        }
        window.removeEventListener('resize', reposition)
        open.offMapClick()
        if (open.card.parentNode) open.card.parentNode.removeChild(open.card)

        if (fireDismiss && open.dismissEvent) {
            window.mmgisAPI.emit(open.dismissEvent)
        }
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
            // Projection is unavailable until the engine has a view — the
            // popup stays hidden and the next move event places it.
        }
    },
}

export default MapPopup_
