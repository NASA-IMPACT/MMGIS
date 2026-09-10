import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to an edge of the map it sits on. */
const VIEWPORT_MARGIN = 8

/**
 * Where a card waits when it has nowhere on screen to be: mid-zoom, panned off
 * the map, or not yet projectable. Not a `display: none`, which would zero the
 * box `_reposition` measures.
 */
const PARKED = 'translate(-100000px, -100000px)'

/**
 * Defaults, plus `<style>` (a card's stylesheet is the page's) and `popover`
 * (the top layer escapes the card's clipping).
 */
const POPUP_SANITIZE_CONFIG = {
    FORBID_TAGS: ['style'],
    FORBID_ATTR: ['popover', 'popovertarget'],
}

interface OpenPopup {
    card: HTMLElement
    engine: IMapEngine
    latlng: { lat: number; lng: number }
    /** The address the caller's handle stamped, or null when it had none. */
    owner: string | null
    settle: (result: MapPopupResult) => void
    offClick: () => void
    /** Whatever held focus when the popup opened, to give it back on close. */
    restoreFocus: HTMLElement | null
}

type ActionSlot = 'primary' | 'secondary'

interface PopupCardOptions {
    title?: string
    /** Popup body as the caller wrote it, sanitized on the way in. */
    html?: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    onAction: (action: ActionSlot) => void
    /** The user waving the card away, by the X button or by Escape. */
    onDismiss: () => void
}

/** Keeps a new card's heading id clear of the outgoing card's. */
let titleCount = 0

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Hold `value` between `lo` and `hi`. `lo` wins when the two cross, which is a
 * map with less room than the card needs: the card pins to the near edge and
 * spills past the far one, rather than being pushed clean off the near edge.
 */
function clampBetween(value: number, lo: number, hi: number): number {
    return hi <= lo ? lo : Math.min(Math.max(value, lo), hi)
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
    button.className = `mmgis-map-popup__button mmgis-map-popup__button--${variant}`
    button.textContent = label
    button.addEventListener('click', () => onAction(slot))
    return button
}

/**
 * Where a link points, in either spelling: SVG 1.1's `xlink:href` is what most
 * drawing tools still export, and it is the qualified name the attribute
 * carries whichever namespace the parser put it in.
 */
function linkTarget(anchor: Element): string | null {
    return anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href')
}

/** Links and form submits would navigate the app away; links get a tab. */
function guardNavigation(event: Event): void {
    if (event.type === 'submit') {
        event.preventDefault()
        return
    }
    const anchor = (event.target as Element | null)?.closest?.('a, area')
    if (!anchor) return
    const href = linkTarget(anchor)
    // An empty `href` reloads the app: it resolves to the app's own document.
    if (href == null || href.startsWith('#')) return
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
}

function buildContent(html: string): HTMLElement {
    const content = document.createElement('div')
    content.className = 'mmgis-map-popup__content'
    // A fragment rather than a string to re-parse: one parse fewer, and the
    // only form of the call that survives a Trusted Types policy.
    content.appendChild(
        DOMPurify.sanitize(html, {
            ...POPUP_SANITIZE_CONFIG,
            RETURN_DOM_FRAGMENT: true,
        })
    )
    content.addEventListener('click', guardNavigation, true)
    content.addEventListener('submit', guardNavigation, true)
    return content
}

/** Build the card: a pure view that reports clicks through its callbacks. */
function buildPopupCard(options: PopupCardOptions): HTMLElement {
    const card = document.createElement('div')
    card.className = 'mmgis-map-popup'
    // Announces itself by name when focus lands. No `aria-modal`: the card
    // lays no barrier over the app. Focusable, but never a Tab stop of its own.
    card.setAttribute('role', 'dialog')
    card.tabIndex = -1
    // Parked until a projection lands, so the card never flashes top-left.
    card.style.transform = PARKED
    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        // The innermost thing open owns the key; the app closes its own too.
        event.stopPropagation()
        options.onDismiss()
    })

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'mmgis-map-popup__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', options.onDismiss)
    card.appendChild(close)

    if (options.title) {
        // Not a heading: a level would guess at an outline the card knows not.
        const title = document.createElement('div')
        title.className = 'mmgis-map-popup__title'
        title.id = `mmgis-map-popup-title-${++titleCount}`
        title.textContent = options.title
        card.appendChild(title)
        card.setAttribute('aria-labelledby', title.id)
    } else {
        card.setAttribute('aria-label', 'Map popup')
    }

    if (options.html) card.appendChild(buildContent(options.html))

    const { primaryAction, secondaryAction, onAction } = options
    if (primaryAction || secondaryAction) {
        const actions = document.createElement('div')
        actions.className = 'mmgis-map-popup__actions'
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

/**
 * Beside the map container, never inside it: the engines listen on the
 * container, so a card inside would hand the map its own clicks. A container
 * with no parent leaves the body as the only host there is.
 */
function popupHost(engine: IMapEngine): HTMLElement {
    return engine.getContainer()?.parentElement ?? document.body
}

/** Stable identities, so `show`'s subscriptions can be removed in `hide`. */
const reposition = (): void => MapPopup_._reposition()
const hideForZoom = (): void => MapPopup_._hideForZoom()

/** Core-owned, map-anchored popup. One at a time: a request replaces it. */
const MapPopup_ = {
    _open: null as OpenPopup | null,

    /**
     * Show a popup anchored to `request.latlng`, replacing any current popup.
     *
     * @param request Serializable popup description from the event bus.
     * @param engine The active map engine, used to project the anchor.
     * @param owner The address of the caller asking, as stamped by its bus
     * handle. It decides who may retract this popup later, see
     * {@link hideForCaller}.
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

        const popup: OpenPopup = {
            card: buildPopupCard({
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
                // Closed before its request is answered, so a caller may
                // reply by opening one of its own.
                onAction: (action) => this.hide({ action }),
                onDismiss: () => this.hide({ action: 'dismiss' }),
            }),
            engine,
            latlng: { lat: request.latlng.lat, lng: request.latlng.lng },
            owner: owner ?? null,
            settle,
            offClick: () => {},
            // Read after the replaced popup gave focus back, so a run of
            // popups restores what held focus before the first.
            restoreFocus: document.activeElement as HTMLElement | null,
        }

        // Recorded before anything is wired, so `hide` can unwind a failure.
        this._open = popup
        try {
            popupHost(engine).appendChild(popup.card)
            // On the card, not a control inside it: it names itself first.
            popup.card.focus({ preventScroll: true })
            engine.on('move', reposition)
            // `moveend` too: a comparison pane reports a camera only when it
            // settles, so a card on `move` alone would sit still mid-drag.
            engine.on('moveend', reposition)
            engine.on('zoomstart', hideForZoom)
            engine.on('zoomend', reposition)
            window.addEventListener('resize', reposition)
            // The dismissing click comes from the engine itself: a click on
            // the map is the map's to report, where an announcement of one on
            // the bus is anyone's to make. Only empty map dismisses — a click
            // that landed on a feature is the gesture a plugin answers by
            // opening or replacing a card, so it must not take one away.
            const dismiss = (event?: { feature?: unknown }): void => {
                if (!event?.feature) this.hide({ action: 'dismiss' })
            }
            engine.on('click', dismiss)
            popup.offClick = () => engine.off('click', dismiss)
        } catch (err) {
            // Reject before unwinding: the failure is the answer, not the
            // `closed` of the popup's own teardown.
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
     * @param action How the popup closed: `'dismiss'` for the X, Escape or a
     * click on empty map, `'primary'`/`'secondary'` for a button press. The
     * default `'closed'` covers replacement, `map:hidePopup` and teardown,
     * where the popup goes away without the user acting on it.
     */
    hide({
        action = 'closed',
    }: { action?: MapPopupResult['action'] } = {}): void {
        const open = this._open
        if (!open) return
        this._open = null

        try {
            // Read while the card is still mounted: removing it sends focus to
            // the body, which is what the body also reports when the user had
            // already moved focus somewhere of their own. Focus goes back only
            // when the card still held it, so a user who clicked into a panel
            // while it was open is left where they went.
            const hadFocus = open.card.contains(document.activeElement)

            try {
                open.engine.off('move', reposition)
                open.engine.off('moveend', reposition)
                open.engine.off('zoomstart', hideForZoom)
                open.engine.off('zoomend', reposition)
                open.offClick()
            } catch {
                // Unsubscribing throws once the engine has been destroyed.
            } finally {
                // After the unsubscribes so nothing here can skip one, in a
                // `finally` so an engine that threw still loses its card.
                window.removeEventListener('resize', reposition)
                open.card.parentNode?.removeChild(open.card)
                if (hadFocus && open.restoreFocus?.isConnected) {
                    open.restoreFocus.focus({ preventScroll: true })
                }
            }
        } finally {
            // Answer whatever teardown did; the first settlement sticks.
            open.settle({ action })
        }
    },

    /**
     * Retract the popup for `caller`, but only if it is that caller's: one
     * slot, so core answers for the popup the caller opened, and "no caller"
     * is its own identity. Returns whether one was retracted; its request
     * answers `{ action: 'closed' }`, as any other close does.
     */
    hideForCaller(caller?: string | null): boolean {
        if (!this._open) return false
        if (this._open.owner !== (caller ?? null)) return false
        this.hide()
        return true
    },

    /**
     * Park the card for the duration of a zoom. Leaflet animates a zoom by
     * transforming its panes and emits no `move` until it lands, so a card
     * left on screen would hang at its pre-zoom position and then jump; the
     * `move` and `zoomend` that follow the animation put it back. Engines that
     * report every zoom frame (deck.gl) emit no `zoomstart` and keep tracking.
     */
    _hideForZoom(): void {
        if (this._open) this._open.card.style.transform = PARKED
    },

    _reposition(): void {
        const open = this._open
        if (!open) return
        try {
            const point = open.engine.latLngToContainerPoint(open.latlng) as {
                x: number
                y: number
            }
            const container = open.engine.getContainer().getBoundingClientRect()

            // Container-relative, while the card is placed by a fixed
            // position and so lives in viewport coordinates.
            const anchorLeft = container.left + point.x
            const anchorTop = container.top + point.y
            const containerRight = container.left + container.width
            const containerBottom = container.top + container.height
            // An anchor on the map keeps its card on screen; one that has
            // panned off takes its card with it.
            const onMap =
                point.x >= 0 &&
                point.x <= container.width &&
                point.y >= 0 &&
                point.y <= container.height

            // Where a card that stays put may be: the map, cut to what of it
            // is on screen — panels lie over the map's edges. The card is
            // capped to that room before it is measured, so the height read
            // back is the capped one, and only on a change.
            const boundsLeft = Math.max(container.left, 0)
            const boundsTop = Math.max(container.top, 0)
            const boundsRight = Math.min(containerRight, window.innerWidth)
            const boundsBottom = Math.min(containerBottom, window.innerHeight)

            // Floored at zero: a map entirely off screen leaves the bounds
            // inverted, and a negative `max-height` is one the browser drops.
            const cap = `${Math.max(
                0,
                boundsBottom - boundsTop - 2 * VIEWPORT_MARGIN
            )}px`
            if (open.card.style.maxHeight !== cap) {
                open.card.style.maxHeight = cap
            }

            const card = open.card.getBoundingClientRect()

            const above = anchorTop - card.height - ANCHOR_GAP
            // Flip below the anchor when the card would clip the top edge.
            const flipped =
                above < boundsTop + VIEWPORT_MARGIN
                    ? anchorTop + ANCHOR_GAP
                    : above
            // A card flipped below a low anchor would otherwise hang out of
            // reach past the bottom edge; the document is pinned.
            const top = onMap
                ? clampBetween(
                      flipped,
                      boundsTop + VIEWPORT_MARGIN,
                      boundsBottom - card.height - VIEWPORT_MARGIN
                  )
                : flipped

            const halfCard = card.width / 2
            const center = onMap
                ? clampBetween(
                      anchorLeft,
                      boundsLeft + halfCard + VIEWPORT_MARGIN,
                      boundsRight - halfCard - VIEWPORT_MARGIN
                  )
                : anchorLeft
            const left = center - halfCard

            // Nothing clips the card to the map, so it hides itself — once
            // its box has cleared the map entirely, since an anchor just off
            // the edge still has a card worth reading.
            if (
                left >= containerRight ||
                left + card.width <= container.left ||
                top >= containerBottom ||
                top + card.height <= container.top
            ) {
                open.card.style.transform = PARKED
                return
            }

            open.card.style.transform = `translate(${left}px, ${top}px)`
        } catch {
            // The anchor cannot be projected — before the engine has a view,
            // or once its container is gone — so the card waits, parked.
            open.card.style.transform = PARKED
        }
    },
}

export default MapPopup_
