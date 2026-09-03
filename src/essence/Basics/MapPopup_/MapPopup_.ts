import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to an edge of the map it sits on. */
const VIEWPORT_MARGIN = 8

/**
 * Where a card waits when it has nowhere on screen to be: while the map
 * animates a zoom, once the anchor has panned off the map, and before the
 * engine can project the anchor at all.
 *
 * A transform rather than a `visibility`, because `visibility: hidden` is not a
 * hide the card can rely on — plugin content is free to set `visibility:
 * visible` on itself and paint straight through the card's hiding. `display:
 * none` would hold, but it also zeroes the card's box, and `_reposition`
 * measures that box to work out where the card goes when it comes back.
 */
const PARKED = 'translate(-100000px, -100000px)'

/**
 * The namespace an SVG link keeps its target in. SVG 1.1 spells the attribute
 * `xlink:href`, and content written against it is still what most drawing
 * tools export.
 */
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

/**
 * What a card may hand focus to, in the order a Tab moves through it. Which of
 * them a Tab actually reaches is {@link focusStops}' to settle: an element the
 * selector names can still be hidden, or held out of the sequence.
 *
 * The controls are named for both sides of the card. The chrome contributes
 * the close control and the action buttons {@link buildPopupCard} makes, and a
 * plugin's markup may contribute any of them: form controls reach a card as
 * inert content, and a field this list did not name is a field a Tab would
 * walk out of the dialog through.
 */
const FOCUS_STOP = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'details > summary:first-of-type',
    'audio[controls]',
    'video[controls]',
    '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * How plugin content is sanitized before it reaches a card: DOMPurify's own
 * defaults, and two deliberate divergences from them.
 *
 * The defaults are the whole of the security answer. They are curated upstream,
 * against markup a card's author would never think of, and kept current by the
 * one dependency that ships sanitizer-bypass fixes — which is why `dompurify`
 * floats on a caret range rather than an exact pin, an exact one being what
 * would hold the app on a known-bypassable release. What a card adds to them is
 * only what the shape of a card asks for.
 *
 * The bargain the defaults leave is that an author owns the inside of their
 * card and nothing else. Form controls and a `<canvas>` reach a card as inert
 * content: the contract carries no script, so nothing reads a field back or
 * paints a canvas, and a `<form>` that tries to submit is stopped at the click
 * by {@link guardNavigation}. What must not reach past the card is the top
 * layer, which is what the `FORBID_ATTR` below is for.
 */
export const POPUP_SANITIZE_CONFIG = {
    // DOMPurify's defaults strip `<style>` whole, tag and rules alike. An
    // author's own stylesheet is the point of mounting content in a shadow
    // root, where the rules reach the card's content and stop there, so it is
    // added back — see {@link buildContent}.
    ADD_TAGS: ['style'],
    // The one default-passed capability a card cannot contain: a popover
    // promotes itself into the browser's top layer, above the app's panels and
    // out of reach of both the card's clipping and its paint containment.
    FORBID_ATTR: ['popover', 'popovertarget'],
    // Keeps a leading `<style>` where the author wrote it: the HTML parser
    // hoists a stylesheet that opens a document into the head, and DOMPurify
    // returns the body, so without this the one place an author is most likely
    // to write their stylesheet is the one place it would vanish from.
    FORCE_BODY: true,
}

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
    /** Whatever held focus when the popup opened, to give it back on close. */
    restoreFocus: HTMLElement | SVGElement | null
}

/** The two button slots a card can render. */
type ActionSlot = 'primary' | 'secondary'

/** Anything in a card a Tab can land on. */
type FocusStop = HTMLElement | SVGElement

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
 * Whether the anchor names a latitude a map can project. Web Mercator clamps
 * one past a pole, so a card anchored there would open somewhere the caller
 * never asked for.
 *
 * Longitude is left alone. A map panned across the antimeridian hands out
 * longitudes past ±180 — a bounds' east edge, a click, a view's centre — and
 * each projects to the pixel the caller meant, one world east or west of the
 * prime copy. Refusing them would refuse the anchors those maps are made of.
 */
function isAnchorInRange(latlng: { lat: number; lng: number }): boolean {
    return latlng.lat >= -90 && latlng.lat <= 90
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

/** Where a link points, in either of the two spellings SVG and HTML use. */
function linkTarget(anchor: Element): string | null {
    return (
        anchor.getAttribute('href') ??
        anchor.getAttributeNS(XLINK_NAMESPACE, 'href') ??
        anchor.getAttribute('xlink:href')
    )
}

/**
 * Whether following a link would take the browser away from where it already
 * is. A bare fragment goes nowhere: fragment lookup never enters a shadow
 * tree, so a `#` link in a card reaches none of the card's own ids, and the
 * most it can do is name an element of the app and put the fragment in the
 * address bar, which is inert here.
 *
 * Everything else goes somewhere, an empty `href` included: it resolves to the
 * document the app is running in, so following one reloads the whole app.
 */
function leavesTheCard(href: string | null): href is string {
    return href != null && !href.startsWith('#')
}

/**
 * Send every link that goes anywhere to a tab of its own.
 *
 * A plain `<a href>` in a card navigates the whole app away, taking the map,
 * the session and every other plugin with it, so a card cannot be allowed to
 * hold one. The `rel` keeps the app out of reach of wherever the link points.
 * `<area href>` is the same link wearing an image map, and the sanitizer
 * passes `<map>` and `<area>` through, so the walk covers both.
 *
 * A walk over the sanitized markup rather than a DOMPurify hook, which is the
 * same choice `Markdown_` makes for the same reason: hooks are registered on
 * the library, not on a call, so one added here would reach every other caller
 * in the app.
 */
function sendLinksToTheirOwnTab(content: DocumentFragment): void {
    content.querySelectorAll('a, area').forEach((anchor) => {
        if (!leavesTheCard(linkTarget(anchor))) return
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
    })
}

/**
 * Refuse, at the moment of the click, anything that would navigate the app
 * away — a link the walk above did not reach, and the submit of a form.
 *
 * For links this is a backstop: the walk is what makes them behave, and this
 * catches the case the walk did not see. For a submit it is the mechanism. A
 * `<form>` reaches a card whole, `action` and all, and submitting one would
 * navigate the app away as surely as a link; refusing it here is what leaves
 * the controls inside inert rather than dangerous.
 *
 * It runs in the capture phase on the shadow root, which is where an event
 * inside the content can still be read for what it really targeted; `submit`
 * does not cross a shadow boundary at all, so a listener on the host would
 * never see one.
 */
function guardNavigation(event: Event): void {
    if (event.type === 'submit') {
        event.preventDefault()
        return
    }
    for (const node of event.composedPath()) {
        if (
            !(node instanceof Element) ||
            (node.localName !== 'a' && node.localName !== 'area')
        )
            continue
        const href = linkTarget(node)
        if (!leavesTheCard(href)) return
        if (node.getAttribute('target') === '_blank') return
        event.preventDefault()
        window.open(href, '_blank', 'noopener,noreferrer')
        return
    }
}

/**
 * Build the box the plugin's own markup lives in.
 *
 * The markup is mounted in a shadow root, which is what lets an author style
 * their card however they like without restyling the app around it. A
 * `<style>` in the light DOM is a stylesheet for the whole page: it can repaint
 * the panels, and it can write `.mmgis-map-popup { contain: none !important }`
 * and switch off the very containment the card relies on to keep the content
 * inside itself. Inside a shadow root the same stylesheet reaches the card's
 * content and stops there, while `:hover`, `@keyframes` and the rest go on
 * working — and the theme's custom properties and the card's typography still
 * cross the boundary inwards, so a card that styles nothing still looks like
 * the app it opened over.
 *
 * The root is open rather than closed. Closing it would buy nothing — content
 * sharing this realm can already reach anything in the document, and content
 * that cannot reach the DOM at all is the sandbox's job, not the root mode's —
 * while the focus trap and the specs both need to see in.
 */
function buildContent(html: string): HTMLElement {
    const content = document.createElement('div')
    content.className = 'mmgis-map-popup__content'
    const root = content.attachShadow({ mode: 'open' })
    // A fragment rather than a string to re-parse: one parse fewer, and the
    // only form of the call that survives a Trusted Types policy, which
    // refuses an assignment to `innerHTML` however clean the markup is.
    const sanitized = DOMPurify.sanitize(html, {
        ...POPUP_SANITIZE_CONFIG,
        RETURN_DOM_FRAGMENT: true,
    })
    sendLinksToTheirOwnTab(sanitized)
    root.appendChild(sanitized)
    root.addEventListener('click', guardNavigation, true)
    root.addEventListener('submit', guardNavigation, true)
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
    // A dialog rather than a group: focus moves into the card when it opens
    // and stays there until it closes, so the card is what the keyboard is
    // working in. No `aria-modal` to go with it: the card lays no barrier over
    // the app, so a pointer is free to reach everything outside the card, and
    // announcing the app as unavailable would describe a page nobody has.
    card.setAttribute('role', 'dialog')
    // Focusable, but never a Tab stop of its own: opening the popup puts focus
    // here so the card announces itself by name before anything in it does.
    card.tabIndex = -1
    // Parked until a projection lands, so the card never flashes at the
    // top-left corner before it is positioned.
    card.style.transform = PARKED
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // The app closes its own things on Escape, and the innermost thing
            // open is the one the key was meant for.
            event.stopPropagation()
            options.onEscape()
            return
        }
        if (event.key === 'Tab') trapTab(card, event)
    })

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'mmgis-map-popup__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', options.onClose)
    card.appendChild(close)

    if (options.title) {
        // A plain element rather than a heading: the card is a dialog in
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
 * Whether an element renders at all, itself and everything beneath it.
 *
 * `display: none` takes a subtree off the page entirely, and a closed
 * `<details>` does the same to all it holds but the summary that opens it —
 * which no computed style reports, the contents being hidden by the disclosure
 * widget rather than by any style of their own.
 */
function rendersSubtree(element: Element): boolean {
    const parent = element.parentElement
    if (
        parent?.localName === 'details' &&
        !parent.hasAttribute('open') &&
        !element.matches('summary:first-of-type')
    ) {
        return false
    }
    return getComputedStyle(element).display !== 'none'
}

/**
 * Whether a Tab really stops here: something the selector names, that a
 * `visibility` has not hidden, and that a negative `tabindex` has not taken
 * out of the sequence — `-1` is the only one the selector can spell, and any
 * other negative value means the same thing.
 */
function isTabStop(element: Element): boolean {
    if (!element.matches(FOCUS_STOP)) return false
    if (element.hasAttribute('tabindex') && (element as FocusStop).tabIndex < 0)
        return false
    return getComputedStyle(element).visibility === 'visible'
}

/**
 * Every stop a Tab makes inside the card, in the order it makes them.
 *
 * The walk descends into shadow roots, which is the plainest reason the
 * plugin's root is open: sequential focus navigation moves through a shadow
 * tree as though its contents sat where the host does, so a list gathered from
 * the card's light DOM alone would put the plugin's own links outside the
 * card's last stop and let a Tab out of the dialog from there.
 *
 * Only what a Tab can actually reach counts, because the trap wraps at the
 * ends of this list: an element the keyboard skips, sitting last in the
 * markup, would hold the last place while the Tab that reached the real last
 * stop walked straight out of the card. Content hides its own markup often
 * enough to make this ordinary — a closed `<details>` reaches a card, and so
 * does a stylesheet that can `display: none` anything at all.
 *
 * Tab order is read as document order, which a positive `tabindex` inside the
 * content would reorder. Following it would mean reimplementing sequential
 * navigation, shadow-tree scoping and all, to guard against markup the author
 * of the card wrote against themselves; what they get instead is a control
 * their own `tabindex` has stranded, with focus still held inside the card.
 */
function focusStops(root: ParentNode, found: FocusStop[] = []): FocusStop[] {
    Array.from(root.children).forEach((child) => {
        if (!rendersSubtree(child)) return
        // `visibility` is inherited rather than structural, so a descendant of
        // a hidden element that shows itself again is a stop once more, and
        // the walk goes on through either way.
        if (isTabStop(child)) found.push(child as FocusStop)
        focusStops(child.shadowRoot ?? child, found)
    })
    return found
}

/**
 * Where focus really is, which is not what `document.activeElement` reports
 * once it is inside a shadow root: the document names the host, and the host
 * names what is focused within it.
 */
function deepActiveElement(): Element | null {
    let active = document.activeElement
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement
    }
    return active
}

/**
 * Keep a Tab inside the open card, wrapping at either end.
 *
 * The card is the only thing the keyboard can reach for as long as it is open,
 * which is the half of a modal the popup keeps. It deliberately keeps no
 * click barrier over the rest of the app, so a pointer is still free to go
 * anywhere — and once it has, this never fires, because the key it reads
 * arrives at the card only while the card holds focus.
 */
function trapTab(card: HTMLElement, event: KeyboardEvent): void {
    const stops = focusStops(card)
    const active = deepActiveElement()
    // A card of nothing but text still holds focus, on the card itself.
    if (stops.length === 0) {
        event.preventDefault()
        card.focus({ preventScroll: true })
        return
    }
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (event.shiftKey ? active === first || active === card : active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
    }
}

/**
 * Where a card is mounted: beside the map container, never inside it.
 *
 * A card inside the container would hand the map its own clicks — the engines
 * listen on the container they were given, so a press on a button would read
 * as a press on the map and dismiss the very popup it was aimed at. A sibling
 * is out of that path while still sitting in the map's layer. The card is a
 * positioned box at `z-index: auto`, so it paints over the map without asking
 * for a level; anything the app means to paint over the card has to be
 * positioned itself and carry a level, which is what the panel regions do.
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
                    '[MapPopup] Invalid request: latlng must hold a lat within ±90.'
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
                html,
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
                // Escape is the keyboard's X, and answers the same way.
                onEscape: () => this.hide({ action: 'dismiss' }),
            }),
            engine,
            latlng: { lat: request.latlng.lat, lng: request.latlng.lng },
            owner: owner ?? null,
            settle,
            offClick: () => {},
            subscribeTimer: null,
            cardResize: null,
            // Read after the replaced popup has given focus back, so a run of
            // popups hands focus to whatever held it before the first of them.
            restoreFocus: deepActiveElement() as FocusStop | null,
        }

        // Recorded before anything is wired so that a failure part-way through
        // can be unwound by `hide`, leaving nothing subscribed or mounted.
        this._open = popup
        try {
            popupHost(engine).appendChild(popup.card)
            // Focus lands on the card rather than on a control inside it, so
            // what a screen reader reads first is the card's own name.
            popup.card.focus({ preventScroll: true })
            engine.on('move', reposition)
            // `moveend` as well as `move`: deck.gl's comparison panes report
            // a camera only when it settles, so a card following `move` alone
            // would sit still while a pane is dragged.
            engine.on('moveend', reposition)
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
     * dismissal (the X, Escape, and a click elsewhere on the map) and
     * `'primary'` or `'secondary'` for a button press; the default `'closed'`
     * covers replacement, `map:hidePopup`, and teardown, where the popup goes
     * away without the user acting on it.
     */
    hide({
        action = 'closed',
    }: { action?: MapPopupResult['action'] } = {}): void {
        const open = this._open
        if (!open) return
        this._open = null

        try {
            // Read while the card is still mounted: removing it sends focus to
            // the body, which is the same thing the body reports when the user
            // had already moved focus somewhere of their own.
            const hadFocus = open.card.contains(document.activeElement)
            if (open.card.parentNode)
                open.card.parentNode.removeChild(open.card)
            if (open.subscribeTimer !== null) clearTimeout(open.subscribeTimer)
            open.cardResize?.disconnect()
            // Focus goes back where the popup found it, but only when the
            // popup still had it: a user who clicked into a panel while the
            // card was open is left where they went.
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
     * Park the card for the duration of a zoom.
     *
     * Leaflet animates a zoom by transforming its panes and emits no `move`
     * until the animation lands, so a card left on screen would hang at its
     * pre-zoom position and then jump. Hiding it is the honest reading; the
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

            // Where a card that stays put is allowed to be: the map, cut down
            // to what of it is on screen. The map alone is not enough — a card
            // held inside a container scrolled half off screen would sit half
            // off screen with it — and the viewport alone is not enough
            // either, because the layout lays panels over the map's edges and
            // those panels are positioned, so a card that spills past the map
            // is painted over and its buttons swallowed.
            const boundsLeft = Math.max(container.left, 0)
            const boundsTop = Math.max(container.top, 0)
            const boundsRight = Math.min(containerRight, window.innerWidth)
            const boundsBottom = Math.min(containerBottom, window.innerHeight)

            const above = anchorTop - card.height - ANCHOR_GAP
            // Flip below the anchor when the card would clip the top edge.
            const flipped =
                above < boundsTop + VIEWPORT_MARGIN
                    ? anchorTop + ANCHOR_GAP
                    : above
            // A tall card flipped below a low anchor would otherwise hang past
            // the bottom edge, and nothing scrolls down to it — the document
            // is pinned — so its actions row would be unreachable and the
            // request it answers could never be settled. The top edge wins the
            // tie, since the card's own max-height keeps it short enough that
            // both clamps can be honoured.
            const top = onMap
                ? Math.max(
                      Math.min(
                          flipped,
                          boundsBottom - card.height - VIEWPORT_MARGIN
                      ),
                      boundsTop + VIEWPORT_MARGIN
                  )
                : flipped

            const halfCard = card.width / 2
            const center = onMap
                ? Math.min(
                      Math.max(
                          anchorLeft,
                          boundsLeft + halfCard + VIEWPORT_MARGIN
                      ),
                      boundsRight - halfCard - VIEWPORT_MARGIN
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
                open.card.style.transform = PARKED
                return
            }

            open.card.style.transform = `translate(${left}px, ${top}px)`
        } catch {
            // The anchor cannot be projected — before the engine has a view, or
            // once its container is gone — so the card waits, parked, for a
            // later move to place it.
            open.card.style.transform = PARKED
        }
    },
}

export default MapPopup_
