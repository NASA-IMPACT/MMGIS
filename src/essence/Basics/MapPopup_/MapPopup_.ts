import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/**
 * DOMPurify's defaults, plus `<style>`: the card is plain DOM in the app's
 * document, so an author's stylesheet would be a stylesheet for the page.
 */
const POPUP_SANITIZE_CONFIG = {
    FORBID_TAGS: ['style'],
}

interface OpenPopup {
    engine: IMapEngine
    settle: (result: MapPopupResult) => void
}

type ActionSlot = 'primary' | 'secondary'

interface PopupCardOptions {
    title?: string
    /** Card body as the caller wrote it, sanitized on the way in. */
    html?: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    onAction: (action: ActionSlot) => void
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Whitespace counts as blank: a label of spaces reads as a filled button with
 * nothing on it, the very thing `normalizeAction` refuses.
 */
function isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
}

/** Drop an action whose label is unusable: no card renders a blank button. */
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

/**
 * Build the card: a pure view that reports button presses through `onAction`.
 * It is only the content of the popup — the frame around it, the tip and the
 * close control belong to the map library.
 */
function buildPopupCard(options: PopupCardOptions): HTMLElement {
    const card = document.createElement('div')
    card.className = 'mmgis-popup-card'

    if (options.title) {
        // Not a heading: a level would guess at an outline the card knows not.
        const title = document.createElement('div')
        title.className = 'mmgis-popup-title'
        title.textContent = options.title
        card.appendChild(title)
    }

    if (options.html) {
        const body = document.createElement('div')
        body.className = 'mmgis-popup-body'
        // A fragment rather than a string to re-parse: one parse fewer, and the
        // only form of the call that survives a Trusted Types policy.
        body.appendChild(
            DOMPurify.sanitize(options.html, {
                ...POPUP_SANITIZE_CONFIG,
                RETURN_DOM_FRAGMENT: true,
            })
        )
        card.appendChild(body)
    }

    const { primaryAction, secondaryAction, onAction } = options
    if (primaryAction || secondaryAction) {
        const actions = document.createElement('div')
        actions.className = 'mmgis-popup-actions'
        if (primaryAction) {
            actions.appendChild(
                buildActionButton(
                    primaryAction.label,
                    'primary',
                    'primary',
                    onAction
                )
            )
        }
        if (secondaryAction) {
            // A lone action takes primary styling, but reports its own slot.
            actions.appendChild(
                buildActionButton(
                    secondaryAction.label,
                    'secondary',
                    primaryAction ? 'secondary' : 'primary',
                    onAction
                )
            )
        }
        card.appendChild(actions)
    }

    return card
}

/** Core-owned, map-anchored popup. One at a time: a request replaces it. */
const MapPopup_ = {
    _open: null as OpenPopup | null,

    /**
     * Show a popup anchored to `request.latlng`, replacing any current popup.
     *
     * @param request Serializable popup description from the event bus.
     * @param engine The active map engine, which places the card in its map
     * library's own popup and reports a close the library made.
     * @returns A promise that stays pending for as long as the popup is open
     * and resolves with how it closed. It rejects when the request is invalid
     * or the card could not be placed, in which case nothing is shown and any
     * popup already open is left alone.
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
        // Blank reads as absent, as it does for a button label.
        const title = isNonBlankString(request.title)
            ? request.title
            : undefined
        const html = isNonBlankString(request.html) ? request.html : undefined
        // A card is a title, a body, or both: buttons are not content.
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
            // Closed before its request is answered, so a caller may reply by
            // opening one of its own.
            onAction: (action) => this.hide({ action }),
        })

        // Recorded before the card is handed over, so `hide` can unwind an
        // engine that fails to place it.
        this._open = { engine, settle }
        try {
            engine.showPopup(
                { lat: request.latlng.lat, lng: request.latlng.lng },
                card,
                // The library took the card down itself; it never reports one
                // this service asked for.
                () => this.hide({ action: 'dismiss' })
            )
            // After the hand-off, not before: Leaflet's popup empties its
            // content node and re-appends the card on open, and detaching a
            // focused element blurs it. Scoped to the actions row so a button
            // in an author's html cannot take the focus instead.
            card.querySelector<HTMLButtonElement>(
                '.mmgis-popup-actions button'
            )?.focus({ preventScroll: true })
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
     * Close the current popup, if any, and answer the request that opened it.
     *
     * @param action How the popup closed: `'dismiss'` for a close the map
     * library made, `'primary'`/`'secondary'` for a button press. The default
     * `'closed'` covers replacement, `map:hidePopup` and map re-initialization,
     * where the popup goes away without the user acting on it.
     */
    hide({
        action = 'closed',
    }: { action?: MapPopupResult['action'] } = {}): void {
        const open = this._open
        if (!open) return

        try {
            try {
                open.engine.hidePopup()
            } catch {
                // Taking a card off a destroyed engine throws. The engine is
                // gone and so is the card it held; the request still answers.
            } finally {
                // Dropped whatever the engine did: taking a card off a
                // destroyed engine throws, and a record left behind would
                // stand between the next request and a popup of its own.
                this._open = null
            }
        } finally {
            // Answer whatever teardown did; the first settlement sticks.
            open.settle({ action })
        }
    },
}

export default MapPopup_
