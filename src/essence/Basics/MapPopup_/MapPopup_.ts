import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to an edge of the map it sits on. */
const VIEWPORT_MARGIN = 8

/**
 * Where a card waits when it has nowhere on screen to be: mid-zoom, once the
 * anchor has panned off the map, and before the engine can project it at all.
 *
 * A transform rather than a `visibility`, which plugin content is free to set
 * back to `visible` on itself, or a `display: none`, which zeroes the box
 * `_reposition` measures to work out where the card goes when it returns.
 */
const PARKED = 'translate(-100000px, -100000px)'

/**
 * How plugin content is sanitized: DOMPurify's own defaults — curated upstream
 * and kept current by the caret range the dependency floats on — plus the two
 * capabilities the shape of a card asks it to name outright.
 *
 * What the defaults leave is that an author owns the inside of their card and
 * nothing else. Form controls and a `<canvas>` arrive as inert content, since
 * the contract carries no script, and a `<form>` that tries to submit is
 * stopped at the click by {@link guardNavigation}.
 */
const POPUP_SANITIZE_CONFIG = {
    // A card is plain DOM in the app's own document, so a stylesheet inside it
    // is a stylesheet for the whole page: it can repaint the panels, and it can
    // write `.mmgis-map-popup { contain: none !important }` and switch off the
    // containment the card relies on. The defaults strip `<style>` today, and
    // naming it holds that as the card's own rule rather than a default the
    // dependency's range is free to move.
    FORBID_TAGS: ['style'],
    // The one default-passed capability a card cannot contain: a popover
    // promotes itself into the browser's top layer, above the app's panels and
    // out of reach of both the card's clipping and its paint containment.
    FORBID_ATTR: ['popover', 'popovertarget'],
}

interface OpenPopup {
    card: HTMLElement
    engine: IMapEngine
    latlng: { lat: number; lng: number }
    /**
     * The address the caller's bus handle stamped on the request, or null from
     * a caller that has no handle. Only this caller can retract the popup.
     */
    owner: string | null
    /** Settles this popup's request promise with how the popup closed. */
    settle: (result: MapPopupResult) => void
    offClick: () => void
    /** Whatever held focus when the popup opened, to give it back on close. */
    restoreFocus: HTMLElement | null
}

/** The two button slots a card can render. */
type ActionSlot = 'primary' | 'secondary'

interface PopupCardOptions {
    /** Heading, rendered as text. Absent when the request carried none. */
    title?: string
    /** Popup body as the caller wrote it, sanitized on the way in. */
    html?: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    /** Called with the slot of the clicked action button. */
    onAction: (action: ActionSlot) => void
    /** Called when the close control is pressed. */
    onClose: () => void
    /** Called when Escape is pressed anywhere inside the card. */
    onEscape: () => void
}

/**
 * Tells one card's heading from the next's. A card on its way out is still in
 * the document while its replacement is built, and the card names itself by
 * pointing at its own heading, so a shared id would name the new card after
 * the old one's.
 */
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
 * nothing on it, which is the very thing `normalizeAction` exists to refuse.
 */
function isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== ''
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
 * @param variant Which styling it takes — the slot, except for a lone
 * secondary action; see `buildPopupCard`.
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
 * Where a link points, in either spelling: SVG 1.1's `xlink:href` is what most
 * drawing tools still export, and it is the qualified name the attribute
 * carries whichever namespace the parser put it in.
 */
function linkTarget(anchor: Element): string | null {
    return anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href')
}

/**
 * Refuse, in the capture phase, anything that would navigate the app away.
 *
 * A plain `<a href>` in a card takes the map, the session and every other
 * plugin with it, so following one opens a tab of its own instead and the
 * `rel` keeps the app out of reach of wherever it points. `<area href>` is the
 * same link wearing an image map, which the sanitizer passes through. A bare
 * fragment goes nowhere and is left alone.
 *
 * A `<form>` reaches a card whole, `action` and all, and submitting one would
 * navigate away as surely as a link; refusing it here is what leaves the
 * controls inside inert rather than dangerous.
 */
function guardNavigation(event: Event): void {
    if (event.type === 'submit') {
        event.preventDefault()
        return
    }
    const anchor = (event.target as Element | null)?.closest?.('a, area')
    if (!anchor) return
    const href = linkTarget(anchor)
    // An empty `href` goes somewhere too: it resolves to the document the app
    // is running in, so following one reloads the whole app.
    if (href == null || href.startsWith('#')) return
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
}

/** Build the box the plugin's own markup lives in. */
function buildContent(html: string): HTMLElement {
    const content = document.createElement('div')
    content.className = 'mmgis-map-popup__content'
    // A fragment rather than a string to re-parse: one parse fewer, and the
    // only form of the call that survives a Trusted Types policy, which
    // refuses an assignment to `innerHTML` however clean the markup is.
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

/**
 * Build the popup card element. Pure view: it renders the given content and
 * reports clicks back through the callbacks, with no knowledge of the event
 * bus, the map, or where the card is positioned.
 */
function buildPopupCard(options: PopupCardOptions): HTMLElement {
    const card = document.createElement('div')
    card.className = 'mmgis-map-popup'
    // A dialog rather than a group, so the card announces itself by name when
    // focus lands on it. No `aria-modal`: the card lays no barrier over the
    // app and a Tab leaves it the way it leaves any other non-modal dialog.
    card.setAttribute('role', 'dialog')
    // Focusable, but never a Tab stop of its own: opening the popup puts focus
    // here so the card announces itself before anything in it does.
    card.tabIndex = -1
    // Parked until a projection lands, so the card never flashes at the
    // top-left corner before it is positioned.
    card.style.transform = PARKED
    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return
        // The app closes its own things on Escape, and the innermost thing
        // open is the one the key was meant for.
        event.stopPropagation()
        options.onEscape()
    })

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'mmgis-map-popup__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', options.onClose)
    card.appendChild(close)

    if (options.title) {
        // A plain element rather than a heading: a heading level here would be
        // a guess at an outline the popup knows nothing about.
        const title = document.createElement('div')
        title.className = 'mmgis-map-popup__title'
        title.id = `mmgis-map-popup-title-${++titleCount}`
        title.textContent = options.title
        card.appendChild(title)
        // Announced by its heading, so a screen reader reads what a sighted
        // user reads rather than the generic name below.
        card.setAttribute('aria-labelledby', title.id)
    } else {
        card.setAttribute('aria-label', 'Map popup')
    }

    if (options.html) card.appendChild(buildContent(options.html))

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
 * The engines listen on the container they were given, so a card inside it
 * would hand the map its own clicks. A sibling is out of that path while still
 * sitting in the map's layer, painting over the map as a positioned box at
 * `z-index: auto`; anything meant to paint over the card carries a level of
 * its own, which is what the panel regions do. A container with no parent — a
 * bare embedding, a test harness — leaves the body as the only host there is.
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
 * Core-owned, map-anchored popup. A single popup exists at a time: a fresh
 * request replaces the current one.
 */
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
        // A card is a title, a body, or both: buttons are not content, so a
        // request holding neither has nothing to show.
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
                // The popup closes before its request is answered, so a
                // caller that opens its own popup in response keeps it.
                onAction: (action) => this.hide({ action }),
                onClose: () => this.hide({ action: 'dismiss' }),
                // Escape is the keyboard's X, and answers the same way.
                onEscape: () => this.hide({ action: 'dismiss' }),
            }),
            engine,
            latlng: { lat: request.latlng.lat, lng: request.latlng.lng },
            owner: owner ?? null,
            settle,
            offClick: () => {},
            // Read after the replaced popup gave focus back, so a run of
            // popups restores what held focus before the first of them.
            restoreFocus: document.activeElement as HTMLElement | null,
        }

        // Recorded before anything is wired, so a failure part-way through can
        // be unwound by `hide`, leaving nothing subscribed or mounted.
        this._open = popup
        try {
            popupHost(engine).appendChild(popup.card)
            // Focus lands on the card rather than a control inside it, so a
            // screen reader reads the card's own name first.
            popup.card.focus({ preventScroll: true })
            engine.on('move', reposition)
            // `moveend` too: a comparison pane reports a camera only when it
            // settles, so a card following `move` alone would sit still while
            // the pane is dragged.
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
            open.card.parentNode?.removeChild(open.card)
            if (hadFocus && open.restoreFocus?.isConnected) {
                open.restoreFocus.focus({ preventScroll: true })
            }

            try {
                open.engine.off('move', reposition)
                open.engine.off('moveend', reposition)
                open.engine.off('zoomstart', hideForZoom)
                open.engine.off('zoomend', reposition)
                open.offClick()
            } catch {
                // Teardown can run after the engine has been destroyed (the
                // map is re-initialised), in which case unsubscribing throws.
            }
            window.removeEventListener('resize', reposition)
        } finally {
            // Answer whatever teardown did, so a throw part-way through cannot
            // leave the caller waiting on a popup that is already gone. A
            // rejection raised before the unwind still sticks: the first
            // settlement is the answer.
            open.settle({ action })
        }
    },

    /**
     * Retract the popup on behalf of `caller`, if the popup is that caller's.
     *
     * There is one popup slot, so a plugin asking to hide is really asking to
     * empty it — and the slot may hold someone else's popup by then. Rather
     * than make every plugin track that, the core answers only for the popup
     * the caller opened. Ownership is compared exactly, with "no caller" a
     * value of its own, so neither side can reach the other's popup. This is
     * core's own arbitration, not a security boundary: the address is stamped
     * by the bus handle rather than taken from author code.
     *
     * @param caller The address the requesting plugin's handle stamped, if any.
     * @returns Whether a popup was retracted. Its request still answers
     * `{ action: 'closed' }`, as it does for any other close.
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

            // The projection is relative to the map container, while the card
            // is placed by a fixed position and so lives in viewport
            // coordinates. The anchor is carried across once, here.
            const anchorLeft = container.left + point.x
            const anchorTop = container.top + point.y
            const containerRight = container.left + container.width
            const containerBottom = container.top + container.height
            // An anchor still on the map keeps its card whole and on screen.
            // One that has panned off takes its card with it, so the card
            // leaves the way the map does rather than pinning to an edge it
            // would never come off again.
            const onMap =
                point.x >= 0 &&
                point.x <= container.width &&
                point.y >= 0 &&
                point.y <= container.height

            // Where a card that stays put is allowed to be: the map, cut down
            // to what of it is on screen. The map alone is not enough — one
            // scrolled half off screen would take the card with it — and the
            // viewport alone is not enough either, because the layout lays
            // positioned panels over the map's edges, which would paint over a
            // card that spilled past it and swallow its buttons.
            const boundsLeft = Math.max(container.left, 0)
            const boundsTop = Math.max(container.top, 0)
            const boundsRight = Math.min(containerRight, window.innerWidth)
            const boundsBottom = Math.min(containerBottom, window.innerHeight)

            // Hold the card to the room the clamps below have to place it in,
            // so a tall one scrolls its body rather than hanging past an edge
            // with its actions row under a panel. Set before the card is
            // measured, so the height read back is the capped one, and only
            // when it changes, so one reposition dirties the layout once.
            const cap = `${boundsBottom - boundsTop - 2 * VIEWPORT_MARGIN}px`
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
            // A tall card flipped below a low anchor would otherwise hang
            // past the bottom edge, and nothing scrolls down to it — the
            // document is pinned — so its actions row would be out of reach.
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

            // Nothing clips the card to the map, so the card hides itself —
            // and only once its own box has cleared the map entirely, because
            // an anchor just off the edge still has most of its card on the
            // map and that is worth reading. It returns when the map pans back.
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
