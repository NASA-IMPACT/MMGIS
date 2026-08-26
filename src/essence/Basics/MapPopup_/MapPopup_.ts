import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to a viewport edge. */
const VIEWPORT_MARGIN = 8

interface OpenPopup {
    card: HTMLElement
    engine: IMapEngine
    latlng: { lat: number; lng: number }
    /**
     * Who asked for this popup: the id the plugin's bus handle stamped on the
     * request, or null when it came from a caller that has no handle (the
     * console, an embedding page). Only this caller can retract it.
     */
    owner: string | null
    /** Settles this popup's request promise with how the popup closed. */
    settle: (result: MapPopupResult) => void
    offClick: () => void
    /** Pending subscription to the engine's click, see `show`. */
    subscribeTimer: ReturnType<typeof setTimeout> | null
    /** Watches the card for late-reflowing content. Absent outside browsers. */
    cardResize: ResizeObserver | null
}

/** The two button slots a card can render. */
type ActionSlot = 'primary' | 'secondary'

interface PopupCardOptions {
    /** Heading, rendered as text. Absent when the request carried none. */
    title?: string
    /** Popup body, already sanitized by the caller. */
    html?: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    /** Called with the slot of the clicked action button. */
    onAction: (action: ActionSlot) => void
    /** Called when the close control is pressed. */
    onClose: () => void
}

/**
 * Tells one card's heading from the next's. The card names itself by pointing
 * at its own heading, so the id has to be the card's alone: a card on its way
 * out is still in the document while its replacement is built, and a shared id
 * would name the new card after the old one's heading.
 */
let titleCount = 0

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Whitespace counts as blank: a label of spaces reads as a filled button with
 * nothing on it, which is the very thing `normalizeAction` exists to refuse.
 */
function isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
}

/**
 * The geographic range an anchor has to fall inside. A coordinate outside it
 * is not a place: the projection silently clamps it, so the popup would open
 * somewhere the caller never asked for.
 */
function isAnchorInRange(latlng: { lat: number; lng: number }): boolean {
    return (
        latlng.lat >= -90 &&
        latlng.lat <= 90 &&
        latlng.lng >= -180 &&
        latlng.lng <= 180
    )
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
    if (isNonBlankString(label)) return { label }
    console.warn(
        `[MapPopup] Ignoring ${field}: label must be a non-blank string.`
    )
    return undefined
}

/**
 * @param slot Which action the button reports when pressed.
 * @param variant Which styling it takes, which is the slot except for a lone
 * secondary action, see `buildPopupCard`.
 */
function buildActionButton(
    label: string,
    slot: ActionSlot,
    variant: ActionSlot,
    onAction: (action: ActionSlot) => void
): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `mmgis-map-popup__button mmgis-map-popup__button--${variant}`
    button.textContent = label
    button.addEventListener('click', () => onAction(slot))
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

    if (options.title) {
        // A plain element rather than a heading: the card is a group in
        // whatever page it opens over, and a heading level here would be a
        // guess at an outline the popup knows nothing about.
        const title = document.createElement('div')
        title.className = 'mmgis-map-popup__title'
        title.id = `mmgis-map-popup-title-${++titleCount}`
        title.textContent = options.title
        card.appendChild(title)
        // The card announces itself by its heading, so a screen reader reads
        // what a sighted user reads rather than the generic name a card with
        // no heading has to fall back on.
        card.setAttribute('aria-labelledby', title.id)
    } else {
        card.setAttribute('aria-label', 'Map popup')
    }

    if (options.html) {
        const content = document.createElement('div')
        content.className = 'mmgis-map-popup__content'
        content.innerHTML = options.html
        card.appendChild(content)
    }

    const { primaryAction, secondaryAction, onAction } = options
    if (primaryAction || secondaryAction) {
        const actions = document.createElement('div')
        actions.className = 'mmgis-map-popup__actions'
        // The primary action leads the row.
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
            // A lone action is the primary one whichever slot it arrived in,
            // so it takes the primary styling while still reporting its slot.
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

/**
 * Where a card is mounted: beside the map container, never inside it.
 *
 * A card inside the container would hand the map its own clicks — the engines
 * listen on the container they were given, so a press on a button would read
 * as a press on the map and dismiss the very popup it was aimed at. A sibling
 * is out of that path while still sitting in the map's layer, which is what
 * lets the app paint over the card: the panels it lays over the map claim a
 * stacking level of their own, and the card claims none, so the card rises no
 * higher than the map it belongs to.
 *
 * A container with no parent — a bare embedding, a test harness — leaves the
 * body as the only host there is.
 */
function popupHost(engine: IMapEngine): HTMLElement {
    return engine.getContainer()?.parentElement ?? document.body
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
 * The card is mounted beside the map container rather than inside it, see
 * {@link popupHost}.
 */
const MapPopup_ = {
    _open: null as OpenPopup | null,

    /**
     * Show a popup anchored to `request.latlng`, replacing any current popup.
     *
     * @param request Serializable popup description from the event bus.
     * @param engine The active map engine, used to project the anchor.
     * @param owner The id of the caller asking, as stamped by its bus handle.
     * It decides who may retract this popup later; callers with no handle
     * open a popup only they — that is, anyone else without a handle — can
     * retract. See {@link hideForCaller}.
     * @returns A promise that stays pending for as long as the popup is open
     * and resolves with how it closed. It rejects when the request is invalid
     * or the popup could not be mounted, in which case nothing is shown.
     */
    show(
        request: MapPopupRequest,
        engine: IMapEngine,
        owner?: string | null
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
        if (!isAnchorInRange(request.latlng)) {
            return Promise.reject(
                new Error(
                    '[MapPopup] Invalid request: latlng must hold a lat within ±90 and a lng within ±180.'
                )
            )
        }
        // Blank reads as absent, as it does for a button label: a heading of
        // spaces takes a row and says nothing.
        const title = isNonBlankString(request.title)
            ? request.title
            : undefined
        const html = isNonBlankString(request.html) ? request.html : undefined
        // Every field but the anchor is the caller's to leave out, which
        // leaves one combination with nothing on it: a card is a title, a
        // body, or both, and buttons alone are a card with no content to act
        // on.
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

        const popup: OpenPopup = {
            card: buildPopupCard({
                title,
                html: html && DOMPurify.sanitize(html),
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
            owner: owner ?? null,
            settle,
            offClick: () => {},
            subscribeTimer: null,
            cardResize: null,
        }

        // Recorded before anything is wired so that a failure part-way through
        // can be unwound by `hide`, leaving nothing subscribed or mounted.
        this._open = popup
        try {
            popupHost(engine).appendChild(popup.card)
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
                // The dismissing click comes from the engine itself. A click
                // on the map is the map's to report; an announcement of one on
                // the bus is anyone's to make, and no plugin gets to close
                // another's popup by making it.
                const dismiss = (): void => {
                    // A replacement popup can still be shown later in the
                    // same gesture, so the dismissal waits a task too and
                    // fires only while this popup is still the open one.
                    setTimeout(() => {
                        if (this._open === popup) {
                            this.hide({ action: 'dismiss' })
                        }
                    }, 0)
                }
                engine.on('click', dismiss)
                popup.offClick = () => engine.off('click', dismiss)
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
                open.offClick()
            } catch {
                // Teardown can run after the engine has been destroyed (the
                // map is re-initialised), in which case unsubscribing throws.
            }
            window.removeEventListener('resize', reposition)
        } finally {
            // Answer the request whatever teardown did, so a throw part-way
            // through cannot leave the caller waiting on a popup that is
            // already gone. A rejection raised before the unwind still sticks:
            // the first settlement is the answer.
            open.settle({ action })
        }
    },

    /**
     * Retract the popup on behalf of `caller`, if the popup is that caller's.
     *
     * There is one popup slot, so a plugin asking to hide is really asking to
     * empty the slot — and the slot may hold someone else's popup by then, or
     * a replacement of its own it never learned about. Rather than make every
     * plugin track that, the core answers only for the popup the caller
     * opened; a hide aimed at anyone else's popup does nothing.
     *
     * A caller with no handle owns the popups it opens in the same way, and
     * matches only other callers without one. Ownership is compared exactly,
     * with "no caller" as a value of its own, so an anonymous hide cannot
     * reach a plugin's popup and a plugin's hide cannot reach an anonymous one.
     *
     * This is core's own arbitration, not a security boundary — the id is
     * stamped by the bus handle rather than taken from author code, and the
     * sandbox bridge is what will make it unforgeable.
     *
     * @param caller The id the requesting plugin's handle stamped, if any.
     * @returns Whether a popup was retracted. The retracted popup's request
     * still answers `{ action: 'closed' }`, as it does for any other close.
     */
    hideForCaller(caller?: string | null): boolean {
        if (!this._open) return false
        if (this._open.owner !== (caller ?? null)) return false
        this.hide()
        return true
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
            const card = open.card.getBoundingClientRect()

            // The projection is relative to the map container, while the
            // card is placed by a fixed position and so lives in viewport
            // coordinates. The anchor is carried across once, here, and
            // everything below reads in viewport coordinates.
            const anchorLeft = container.left + point.x
            const anchorTop = container.top + point.y
            const containerRight = container.left + container.width
            const containerBottom = container.top + container.height
            // An anchor still on the map keeps its card whole and on screen.
            // One that has panned off the map takes its card with it instead,
            // so the card can leave the way the map does rather than park
            // against a viewport edge it would never come off again.
            const onMap =
                point.x >= 0 &&
                point.x <= container.width &&
                point.y >= 0 &&
                point.y <= container.height

            const above = anchorTop - card.height - ANCHOR_GAP
            // Flip below the anchor when the card would clip the viewport top.
            const flipped =
                above < VIEWPORT_MARGIN ? anchorTop + ANCHOR_GAP : above
            // A tall card flipped below a low anchor would otherwise hang past
            // the bottom of the viewport, and nothing scrolls down to it — the
            // document is pinned — so its actions row would be unreachable and
            // the request it answers could never be settled. The top edge wins
            // the tie, since the card's own max-height keeps it short enough
            // that both clamps can be honoured.
            const top = onMap
                ? Math.max(
                      Math.min(
                          flipped,
                          window.innerHeight - card.height - VIEWPORT_MARGIN
                      ),
                      VIEWPORT_MARGIN
                  )
                : flipped

            const halfCard = card.width / 2
            const center = onMap
                ? Math.min(
                      Math.max(anchorLeft, halfCard + VIEWPORT_MARGIN),
                      window.innerWidth - halfCard - VIEWPORT_MARGIN
                  )
                : anchorLeft
            const left = center - halfCard

            // Nothing clips the card to the map, so the card hides itself,
            // and only once its own box has cleared the map entirely.
            // The card is drawn clear of its anchor, so an anchor sitting just
            // off the map still has most of its card over the map, and that is
            // worth reading. It comes back when the map pans back.
            if (
                left >= containerRight ||
                left + card.width <= container.left ||
                top >= containerBottom ||
                top + card.height <= container.top
            ) {
                open.card.style.visibility = 'hidden'
                return
            }

            open.card.style.transform = `translate(${left}px, ${top}px)`
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
