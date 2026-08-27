import DOMPurify from 'dompurify'

import { MapPopupAction, MapPopupRequest, MapPopupResult } from './types'
import type { IMapEngine } from '../MapEngines/IMapEngine'

import './MapPopup.css'

/** Gap in pixels between the anchor point and the card. */
const ANCHOR_GAP = 12
/** How close in pixels the card may come to a viewport edge. */
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
 * Nothing a form contributes appears here: the sanitizer refuses form controls
 * outright, so no card can hold one.
 */
const FOCUS_STOP = [
    'a[href]',
    'button:not([disabled])',
    'details > summary:first-of-type',
    'audio[controls]',
    'video[controls]',
    '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * What plugin content is allowed to be.
 *
 * An allow-list rather than a denylist, so a tag DOMPurify learns to pass in
 * some later release reaches a card blocked rather than allowed — which is
 * also why the dependency is pinned to an exact version rather than a range.
 *
 * The bargain is that an author owns the inside of their card and nothing
 * else. Text, structure, media, formulae and the whole of static SVG are
 * theirs, and so is a stylesheet of their own, which is safe to hand them
 * because the content is mounted in a shadow root, see {@link buildContent}.
 * What reaches past the card is not theirs: no frames, no plugins, no form
 * controls, and none of the attributes — `popover` above all — that lift
 * content into the top layer, where neither the card's clipping nor its paint
 * containment can follow.
 */
const ALLOWED_TAGS = [
    // Text and structure. `details` and `summary` earn their place twice over:
    // they are the only disclosure widget HTML offers that needs no script.
    'a',
    'abbr',
    'address',
    'article',
    'aside',
    'b',
    'bdi',
    'bdo',
    'blockquote',
    'br',
    'caption',
    'cite',
    'code',
    'col',
    'colgroup',
    'data',
    'dd',
    'del',
    'details',
    'dfn',
    'div',
    'dl',
    'dt',
    'em',
    'figcaption',
    'figure',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hgroup',
    'hr',
    'i',
    'ins',
    'kbd',
    'li',
    'main',
    'mark',
    'meter',
    'nav',
    'ol',
    'p',
    'pre',
    'progress',
    'q',
    'rp',
    'rt',
    'ruby',
    's',
    'samp',
    'section',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'time',
    'tr',
    'u',
    'ul',
    'var',
    'wbr',
    // Media. `canvas` is missing on purpose: it paints only from script, and
    // the contract has no script to offer, so a card that asked for one would
    // get a blank rectangle and no explanation.
    'img',
    'picture',
    'source',
    'video',
    'audio',
    'track',
    // The author's own stylesheet.
    'style',
    // Static SVG: DOMPurify's own tag list less the SMIL animation elements,
    // the deprecated font and glyph machinery, and `symbol`. A `<symbol>`
    // paints nothing without a `<use>` to place it, and `use` is a tag
    // DOMPurify itself declines to pass, so the pair leaves together.
    'svg',
    'g',
    'defs',
    'desc',
    'title',
    'metadata',
    'switch',
    'view',
    'circle',
    'ellipse',
    'line',
    'path',
    'polygon',
    'polyline',
    'rect',
    'text',
    'textpath',
    'tspan',
    'image',
    'lineargradient',
    'radialgradient',
    'stop',
    'pattern',
    'clippath',
    'mask',
    'marker',
    'filter',
    'feblend',
    'fecolormatrix',
    'fecomponenttransfer',
    'fecomposite',
    'feconvolvematrix',
    'fediffuselighting',
    'fedisplacementmap',
    'fedistantlight',
    'fedropshadow',
    'feflood',
    'fefunca',
    'fefuncb',
    'fefuncg',
    'fefuncr',
    'fegaussianblur',
    'feimage',
    'femerge',
    'femergenode',
    'femorphology',
    'feoffset',
    'fepointlight',
    'fespecularlighting',
    'fespotlight',
    'fetile',
    'feturbulence',
    // MathML, DOMPurify's curated set. Inert markup, and the difference
    // between a rendered formula and its operands run together on one line.
    'math',
    'menclose',
    'merror',
    'mfenced',
    'mfrac',
    'mglyph',
    'mi',
    'mlabeledtr',
    'mmultiscripts',
    'mn',
    'mo',
    'mover',
    'mpadded',
    'mphantom',
    'mprescripts',
    'mroot',
    'mrow',
    'ms',
    'mspace',
    'msqrt',
    'mstyle',
    'msub',
    'msubsup',
    'msup',
    'mtable',
    'mtd',
    'mtext',
    'mtr',
    'munder',
    'munderover',
]

/**
 * The HTML attributes a card may carry, curated by hand because DOMPurify's
 * own HTML set is drawn for a wider brief than a popup: it passes `popover`
 * and the form attributes, neither of which belongs in a card.
 *
 * `target` and `rel` are absent because the card writes them itself, see
 * {@link sendLinksToTheirOwnTab}, and `alt`, `kind`, `srclang` and `label`
 * are present because leaving them out would cost a screen reader the only
 * description an image or a text track has.
 */
const HTML_ATTR = [
    'alt',
    'autoplay',
    'cite',
    'class',
    'colspan',
    'controls',
    'datetime',
    'decoding',
    'default',
    'dir',
    'headers',
    'height',
    'high',
    'href',
    'hreflang',
    'id',
    'kind',
    'label',
    'lang',
    'loading',
    'loop',
    'low',
    'max',
    'media',
    'min',
    'muted',
    'open',
    'optimum',
    'playsinline',
    'poster',
    'preload',
    'reversed',
    'role',
    'rowspan',
    'scope',
    'sizes',
    'span',
    'src',
    'srclang',
    'srcset',
    'start',
    'style',
    'title',
    'translate',
    'type',
    'value',
    'width',
]

/**
 * The SVG attributes a card may carry: DOMPurify's own curated set, less the
 * SMIL timing attributes, plus three presentation attributes it does not
 * carry.
 *
 * Taken from the library rather than written out from memory, because writing
 * it out from memory is how `flood-color` goes missing and four of the filter
 * primitives quietly render nothing. The spec re-derives this list from the
 * installed DOMPurify and fails when the two drift apart.
 *
 * The SMIL attributes go because none of the elements that read them —
 * `animate`, `set`, `animateTransform` — is a tag a card may hold, so they
 * describe an animation that could never run.
 */
const SVG_ATTR = [
    'accent-height',
    'alignment-baseline',
    'amplitude',
    'ascent',
    'azimuth',
    'basefrequency',
    'baseline-shift',
    'bias',
    'class',
    'clip',
    'clippathunits',
    'clip-path',
    'clip-rule',
    'color',
    'color-interpolation',
    'color-interpolation-filters',
    'color-profile',
    'color-rendering',
    'cx',
    'cy',
    'd',
    'dx',
    'dy',
    'diffuseconstant',
    'direction',
    'display',
    'divisor',
    'edgemode',
    'elevation',
    'exponent',
    'fill',
    'fill-opacity',
    'fill-rule',
    'filter',
    'filterunits',
    'flood-color',
    'flood-opacity',
    'font-family',
    'font-size',
    'font-size-adjust',
    'font-stretch',
    'font-style',
    'font-variant',
    'font-weight',
    'fx',
    'fy',
    'g1',
    'g2',
    'glyph-name',
    'glyphref',
    'gradientunits',
    'gradienttransform',
    'height',
    'href',
    'id',
    'image-rendering',
    'in',
    'in2',
    'intercept',
    'k',
    'k1',
    'k2',
    'k3',
    'k4',
    'kerning',
    'lang',
    'lengthadjust',
    'letter-spacing',
    'kernelmatrix',
    'kernelunitlength',
    'lighting-color',
    'local',
    'marker-end',
    'marker-mid',
    'marker-start',
    'markerheight',
    'markerunits',
    'markerwidth',
    'maskcontentunits',
    'maskunits',
    'mask',
    'mask-type',
    'media',
    'method',
    'mode',
    'name',
    'numoctaves',
    'offset',
    'operator',
    'opacity',
    'order',
    'orient',
    'orientation',
    'overflow',
    'paint-order',
    'path',
    'pathlength',
    'patterncontentunits',
    'patterntransform',
    'patternunits',
    'points',
    'preservealpha',
    'preserveaspectratio',
    'primitiveunits',
    'r',
    'rx',
    'ry',
    'radius',
    'refx',
    'refy',
    'result',
    'rotate',
    'scale',
    'seed',
    'shape-rendering',
    'slope',
    'specularconstant',
    'specularexponent',
    'spreadmethod',
    'startoffset',
    'stddeviation',
    'stitchtiles',
    'stop-color',
    'stop-opacity',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke',
    'stroke-width',
    'style',
    'surfacescale',
    'systemlanguage',
    'tabindex',
    'tablevalues',
    'targetx',
    'targety',
    'transform',
    'transform-origin',
    'text-anchor',
    'text-decoration',
    'text-rendering',
    'textlength',
    'type',
    'u1',
    'u2',
    'unicode',
    'values',
    'viewbox',
    'visibility',
    'version',
    'vert-adv-y',
    'vert-origin-x',
    'vert-origin-y',
    'width',
    'word-spacing',
    'wrap',
    'writing-mode',
    'xchannelselector',
    'ychannelselector',
    'x',
    'x1',
    'x2',
    'xmlns',
    'y',
    'y1',
    'y2',
    'z',
    'zoomandpan',
    'dominant-baseline',
    'pointer-events',
    'vector-effect',
]

/** The MathML attributes a card may carry: DOMPurify's curated set, whole. */
const MATHML_ATTR = [
    'accent',
    'accentunder',
    'align',
    'bevelled',
    'close',
    'columnalign',
    'columnlines',
    'columnspacing',
    'columnspan',
    'denomalign',
    'depth',
    'dir',
    'display',
    'displaystyle',
    'encoding',
    'fence',
    'frame',
    'height',
    'href',
    'id',
    'largeop',
    'length',
    'linethickness',
    'lquote',
    'lspace',
    'mathbackground',
    'mathcolor',
    'mathsize',
    'mathvariant',
    'maxsize',
    'minsize',
    'movablelimits',
    'notation',
    'numalign',
    'open',
    'rowalign',
    'rowlines',
    'rowspacing',
    'rowspan',
    'rspace',
    'rquote',
    'scriptlevel',
    'scriptminsize',
    'scriptsizemultiplier',
    'selection',
    'separator',
    'separators',
    'stretchy',
    'subscriptshift',
    'supscriptshift',
    'symmetric',
    'voffset',
    'width',
    'xmlns',
]

/**
 * The namespaced attributes a card may carry: DOMPurify's curated set, whole.
 * `xlink:href` is the one that matters — it is where SVG 1.1 content, which is
 * most of the SVG a drawing tool exports, keeps a link's target.
 */
const XML_ATTR = [
    'xlink:href',
    'xml:id',
    'xlink:title',
    'xml:space',
    'xmlns:xlink',
]

/**
 * How plugin content is sanitized before it reaches a card.
 *
 * `FORCE_BODY` keeps a leading `<style>` where the author put it: the HTML
 * parser hoists a stylesheet that opens a document into the head, and
 * DOMPurify returns the body, so without it the one place an author is most
 * likely to write their stylesheet is the one place it would vanish from.
 *
 * `ADD_FORBID_CONTENTS` rather than `FORBID_CONTENTS`, because the latter
 * replaces DOMPurify's own list instead of extending it, and the list holds
 * the tags whose text is not markup — `xmp`, `noscript` — whose contents would
 * then spill into the card as prose. Every tag added to it is a leaf: name a
 * container and DOMPurify takes the container's children with it, so an author
 * who wrapped their card in a `<form>` would get a blank popup and no reason
 * why.
 */
export const POPUP_SANITIZE_CONFIG = {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...HTML_ATTR, ...SVG_ATTR, ...MATHML_ATTR, ...XML_ATTR],
    ADD_FORBID_CONTENTS: [
        'button',
        'canvas',
        'datalist',
        'embed',
        'iframe',
        'input',
        'object',
        'optgroup',
        'option',
        'select',
        'textarea',
    ],
    ALLOW_ARIA_ATTR: true,
    ALLOW_DATA_ATTR: true,
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

/** Where a link points, in either of the two spellings SVG and HTML use. */
function linkTarget(anchor: Element): string | null {
    return (
        anchor.getAttribute('href') ??
        anchor.getAttributeNS(XLINK_NAMESPACE, 'href') ??
        anchor.getAttribute('xlink:href')
    )
}

/**
 * Whether following a link would take the browser somewhere other than a spot
 * inside the card. A bare fragment is a jump within the content — and one that
 * resolves inside the shadow root, so it cannot reach an id in the app either.
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
 *
 * A walk over the sanitized markup rather than a DOMPurify hook, which is the
 * same choice `Markdown_` makes for the same reason: hooks are registered on
 * the library, not on a call, so one added here would reach every other caller
 * in the app.
 */
function sendLinksToTheirOwnTab(content: DocumentFragment): void {
    content.querySelectorAll('a').forEach((anchor) => {
        if (!leavesTheCard(linkTarget(anchor))) return
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
    })
}

/**
 * Refuse, at the moment of the click, anything that would navigate the app
 * away — a link the walk above did not reach, a form the sanitizer somehow
 * left standing.
 *
 * A backstop rather than the mechanism: the walk is what makes links behave,
 * and this is what catches the case the walk did not see. It runs in the
 * capture phase on the shadow root, which is where an event inside the
 * content can still be read for what it really targeted; `submit` does not
 * cross a shadow boundary at all, so a listener on the host would never see
 * one.
 */
function guardNavigation(event: Event): void {
    if (event.type === 'submit') {
        event.preventDefault()
        return
    }
    for (const node of event.composedPath()) {
        if (!(node instanceof Element) || node.localName !== 'a') continue
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
 * enough to make this ordinary — a closed `<details>` is on the allow-list,
 * and so is a stylesheet that can `display: none` anything at all.
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
 * is out of that path while still sitting in the map's layer, which is what
 * lets the app paint over the card: the panels it lays over the map claim a
 * stacking level of their own, and the card claims none of its own, so the
 * card rises no higher than the map it belongs to.
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
