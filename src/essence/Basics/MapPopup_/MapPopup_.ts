import DOMPurify from 'dompurify'

import { buildPopupCard } from './MapPopupCard'
import { MapPopupAction, MapPopupRequest } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card, mirroring MapPopup.css. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to a viewport edge. */
const VIEWPORT_MARGIN = 8

interface OpenPopup {
    host: HTMLElement
    card: HTMLElement
    engine: IMapEngine
    latlng: { lat: number; lng: number }
    dismissEvent?: string
    reposition: () => void
    onKeyDown: (event: KeyboardEvent) => void
    offMapClick: () => void
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

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
    _pendingDismiss: null as ReturnType<typeof setTimeout> | null,

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

        const html = DOMPurify.sanitize(request.html)
        const latlng = { lat: request.latlng.lat, lng: request.latlng.lng }
        const dismissEvent = request.dismissEvent

        const host = document.createElement('div')
        host.className = 'mmgis-map-popup-host'
        // Stays hidden until a projection lands, so the card never flashes at
        // the top-left corner before it is positioned.
        host.style.visibility = 'hidden'

        const card = buildPopupCard({
            html,
            primaryAction: request.primaryAction,
            secondaryAction: request.secondaryAction,
            onAction: (action: MapPopupAction) => {
                // Close first so a handler that opens its own popup in
                // response keeps it. A button press never dismisses.
                this.hide()
                window.mmgisAPI.emit(action.event)
            },
            onClose: () => this.hide({ fireDismiss: true }),
        })
        host.appendChild(card)
        document.body.appendChild(host)

        const reposition = () => this._reposition()
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') this.hide({ fireDismiss: true })
        }
        // The click that opens a popup is usually the same map click that
        // would dismiss it, so defer the dismissal by a tick: showing a popup
        // in the same task or microtask cancels it.
        const offMapClick = window.mmgisAPI.on('map:click', () => {
            this._clearPendingDismiss()
            this._pendingDismiss = setTimeout(() => {
                this._pendingDismiss = null
                this.hide({ fireDismiss: true })
            }, 0)
        })

        engine.on('move', reposition)
        engine.on('moveend', reposition)
        document.addEventListener('keydown', onKeyDown)

        this._open = {
            host,
            card,
            engine,
            latlng,
            dismissEvent,
            reposition,
            onKeyDown,
            offMapClick,
        }

        this._reposition()
        return true
    },

    /**
     * Close the current popup, if any.
     *
     * @param fireDismiss Broadcast the request's `dismissEvent`. Set for user
     * dismissals (X, click-away, Escape) and left off for replacement, button
     * presses, and teardown.
     */
    hide({ fireDismiss = false }: { fireDismiss?: boolean } = {}): void {
        const open = this._open
        if (!open) return
        this._open = null
        this._clearPendingDismiss()

        // Teardown can run after the engine has been destroyed (mission swap),
        // in which case unsubscribing throws.
        try {
            open.engine.off('move', open.reposition)
            open.engine.off('moveend', open.reposition)
        } catch (err) {
            console.warn('[MapPopup] Could not unsubscribe from the engine:', err)
        }
        open.offMapClick()
        document.removeEventListener('keydown', open.onKeyDown)
        if (open.host.parentNode) open.host.parentNode.removeChild(open.host)

        if (fireDismiss && open.dismissEvent) {
            window.mmgisAPI.emit(open.dismissEvent)
        }
    },

    _clearPendingDismiss(): void {
        if (this._pendingDismiss !== null) {
            clearTimeout(this._pendingDismiss)
            this._pendingDismiss = null
        }
    },

    /** Project the anchor to viewport coordinates and move the host there. */
    _reposition(): void {
        const open = this._open
        if (!open) return
        try {
            const point = open.engine.latLngToContainerPoint(open.latlng) as {
                x: number
                y: number
            }
            const container = open.engine.getContainer().getBoundingClientRect()
            const card = open.card.getBoundingClientRect()

            const top = container.top + point.y
            const below = top - card.height - ANCHOR_GAP < VIEWPORT_MARGIN
            open.host.classList.toggle('mmgis-map-popup-host--below', below)

            const halfCard = card.width / 2
            const left = Math.min(
                Math.max(container.left + point.x, halfCard + VIEWPORT_MARGIN),
                window.innerWidth - halfCard - VIEWPORT_MARGIN
            )
            open.host.style.transform = `translate(${left}px, ${top}px)`
            open.host.style.visibility = 'visible'
        } catch {
            // Projection is unavailable until the engine has a view — the
            // popup stays hidden and the next move event places it.
        }
    },
}

export default MapPopup_
