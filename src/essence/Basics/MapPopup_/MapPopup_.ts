import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

interface OpenPopup {
    engine: IMapEngine
    settle: (result: MapPopupResult) => void
}

type ActionSlot = 'primary' | 'secondary'

interface PopupCardOptions {
    title?: string
    html?: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    onAction: (action: ActionSlot) => void
}

interface PopupCard {
    element: HTMLElement
    /** Where focus goes once the card is placed; null when it has no actions. */
    firstAction: HTMLButtonElement | null
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

function isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
}

function normalizeAction(
    action: MapPopupAction | undefined,
    field: string
): MapPopupAction | undefined {
    if (action == null) return undefined
    const { label } = action
    if (isNonBlankString(label)) return { label }
    console.warn(
        `[MapPopup] Ignoring ${field}: label must be a non-blank string.`
    )
    return undefined
}

function buildActionButton(
    label: string,
    slot: ActionSlot,
    variant: ActionSlot,
    onAction: (action: ActionSlot) => void
): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `mmgis-popup-button mmgis-popup-button--${variant}`
    button.textContent = label
    button.addEventListener('click', () => onAction(slot))
    return button
}

/** Build the card's content; the map library owns the frame around it. */
function buildPopupCard(options: PopupCardOptions): PopupCard {
    const element = document.createElement('div')
    element.className = 'mmgis-popup-card'

    if (options.title) {
        // Not a heading: a level would guess at an outline the card knows not.
        const title = document.createElement('div')
        title.className = 'mmgis-popup-title'
        title.textContent = options.title
        element.appendChild(title)
    }

    if (options.html) {
        const body = document.createElement('div')
        body.className = 'mmgis-popup-body'
        // A fragment rather than a string to re-parse: one parse fewer, and the
        // only form of the call that survives a Trusted Types policy.
        body.appendChild(
            DOMPurify.sanitize(options.html, {
                RETURN_DOM_FRAGMENT: true,
                // An author's stylesheet would be the page's, and a popover
                // paints into the top layer, over the whole app.
                FORBID_TAGS: ['style'],
                FORBID_ATTR: ['popover', 'popovertarget'],
            })
        )
        element.appendChild(body)
    }

    const { primaryAction, secondaryAction, onAction } = options
    const buttons = [
        primaryAction &&
            buildActionButton(primaryAction.label, 'primary', 'primary', onAction),
        // A lone action takes the primary styling, in either slot.
        secondaryAction &&
            buildActionButton(
                secondaryAction.label,
                'secondary',
                primaryAction ? 'secondary' : 'primary',
                onAction
            ),
    ].filter(Boolean) as HTMLButtonElement[]
    if (buttons.length > 0) {
        const actions = document.createElement('div')
        actions.className = 'mmgis-popup-actions'
        buttons.forEach((button) => actions.appendChild(button))
        element.appendChild(actions)
    }

    return { element, firstAction: buttons[0] ?? null }
}

/** Core-owned, map-anchored popup. One at a time: a request replaces it. */
const MapPopup_ = {
    _open: null as OpenPopup | null,

    /**
     * Show a popup anchored to `request.latlng`, replacing any current one.
     * The promise stays pending for as long as the popup is open and resolves
     * with how it closed. An invalid request rejects and leaves an open popup
     * alone; a card the engine cannot place rejects with nothing open.
     */
    show(
        request: MapPopupRequest,
        engine: IMapEngine
    ): Promise<MapPopupResult> {
        if (
            !request ||
            !request.latlng ||
            !isFiniteNumber(request.latlng.lat) ||
            !isFiniteNumber(request.latlng.lng) ||
            (request.title != null && typeof request.title !== 'string') ||
            (request.html != null && typeof request.html !== 'string')
        ) {
            return Promise.reject(
                new Error(
                    '[MapPopup] Invalid request: latlng must hold finite lat/lng numbers, and title and html must be strings when given.'
                )
            )
        }
        const title = isNonBlankString(request.title)
            ? request.title
            : undefined
        const html = isNonBlankString(request.html) ? request.html : undefined
        if (!title && !html) {
            return Promise.reject(
                new Error(
                    '[MapPopup] Invalid request: a popup needs a title or html to show.'
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

        const card = buildPopupCard({
            title,
            html,
            primaryAction: normalizeAction(
                request.primaryAction,
                'primaryAction'
            ),
            secondaryAction: normalizeAction(
                request.secondaryAction,
                'secondaryAction'
            ),
            onAction: (action) => this.hide({ action }),
        })

        // Recorded before the card is handed over, so `hide` can unwind an
        // engine that fails to place it.
        this._open = { engine, settle }
        try {
            engine.showPopup(
                { lat: request.latlng.lat, lng: request.latlng.lng },
                card.element,
                () => this.hide({ action: 'dismiss' })
            )
            // After the hand-off, not before: Leaflet's popup empties its
            // content node and re-appends the card on open, which blurs it.
            card.firstAction?.focus({ preventScroll: true })
        } catch (err) {
            // Reject before unwinding: the failure is the answer, not the
            // `closed` of the popup's own teardown.
            fail(new Error(`[MapPopup] Could not show the popup: ${err}`))
            this.hide()
            return outcome
        }

        return outcome
    },

    /**
     * Close the current popup, if any, and answer its request with `action`.
     * The default covers every close code made: replacement, `map:hidePopup`
     * and map re-initialization.
     */
    hide({
        action = 'closed',
    }: { action?: MapPopupResult['action'] } = {}): void {
        const open = this._open
        if (!open) return
        this._open = null

        try {
            open.engine.hidePopup()
        } catch {
            // A destroyed engine throws; the card is gone either way.
        }

        open.settle({ action })
    },
}

export default MapPopup_
