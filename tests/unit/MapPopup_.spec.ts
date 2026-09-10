import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type {
    MapPopupRequest,
    MapPopupResult,
} from '../../src/essence/Basics/MapPopup_/types'

/**
 * Stand-in for the active map engine. jsdom lays nothing out, so the container
 * rect is stubbed to a known position and size. `subscribed` and
 * `unsubscribed` keep the handler objects themselves, so a spec can ask
 * whether `off` was given back what `on` was handed.
 */
function makeEngine({
    point = { x: 300, y: 200 },
    containerTop = 50,
    containerLeft = 100,
    containerWidth = 800,
    containerHeight = 600,
    offThrows = false,
} = {}) {
    const listeners = new Map<string, Set<(event?: unknown) => void>>()
    const subscribed: Array<[string, unknown]> = []
    const unsubscribed: Array<[string, unknown]> = []
    const container = document.createElement('div')
    container.getBoundingClientRect = () =>
        ({
            top: containerTop,
            left: containerLeft,
            width: containerWidth,
            height: containerHeight,
        }) as DOMRect
    let projected = point
    return {
        listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
        subscribed,
        unsubscribed,
        // Fanned out over a snapshot, the way the adapters do it: a handler
        // subscribed while an event is being delivered does not receive it.
        fire: (event: string, payload?: unknown) => {
            const handlers = listeners.get(event)
            if (handlers)
                Array.from(handlers).forEach((handler) => handler(payload))
        },
        setPoint: (next: { x: number; y: number }) => {
            projected = next
        },
        engine: {
            on: (event: string, handler: (event?: unknown) => void) => {
                subscribed.push([event, handler])
                if (!listeners.has(event)) listeners.set(event, new Set())
                listeners.get(event)!.add(handler)
            },
            off: (event: string, handler: (event?: unknown) => void) => {
                unsubscribed.push([event, handler])
                if (offThrows) throw new Error('engine destroyed')
                listeners.get(event)?.delete(handler)
            },
            getContainer: () => container,
            latLngToContainerPoint: () => projected,
        },
    }
}

function request(overrides: Partial<MapPopupRequest> = {}): MapPopupRequest {
    return {
        latlng: { lat: 45, lng: -120 },
        html: '<p>Crater A</p>',
        ...overrides,
    }
}

/**
 * Watch a request promise and record how it settles: a resolution as its
 * action, a rejection as `rejected: <message>`. The list is the count of
 * answers the caller saw, so a request that is never answered reads as empty
 * and one answered a second time would read as two entries.
 */
function track(promise: Promise<MapPopupResult>): string[] {
    const settlements: string[] = []
    promise.then(
        (result) => settlements.push(result.action),
        (error) => settlements.push(`rejected: ${error.message}`)
    )
    return settlements
}

function show(
    engine: ReturnType<typeof makeEngine>,
    overrides: Partial<MapPopupRequest> = {},
    owner?: string | null
): string[] {
    return track(
        MapPopup_.show(request(overrides), engine.engine as never, owner)
    )
}

const INVALID_REQUEST =
    'rejected: [MapPopup] Invalid request: latlng must hold finite lat/lng numbers, and title and html must be strings when given.'
const NOTHING_TO_SHOW =
    'rejected: [MapPopup] Invalid request: a popup needs a title or html to show.'
const WIRING_FAILED =
    'rejected: [MapPopup] Could not show the popup: Error: engine destroyed'

const popups = () => document.querySelectorAll('.mmgis-map-popup')
const card = () => document.querySelector<HTMLElement>('.mmgis-map-popup')!
const title = () =>
    document.querySelector<HTMLElement>('.mmgis-map-popup__title')
const body = () =>
    document.querySelector<HTMLElement>('.mmgis-map-popup__content')!.innerHTML
const buttons = () => document.querySelectorAll('.mmgis-map-popup__button')
const closeButton = () =>
    document.querySelector('.mmgis-map-popup__close')! as HTMLElement
const clickOn = (element: Element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
/** Where MapPopup_ parks a card that has nowhere on screen to be. */
const PARKED = 'translate(-100000px, -100000px)'
/**
 * Give the card a real size; jsdom reports every element as 0x0. jsdom also
 * applies no styles, so the stub honours the `max-height` MapPopup_ sets the
 * way a browser's own layout would.
 */
const sizeCard = (width: number, height: number) => {
    const element = card()
    element.getBoundingClientRect = () => {
        const cap = parseFloat(element.style.maxHeight)
        return {
            width,
            height: Number.isNaN(cap) ? height : Math.min(height, cap),
        } as DOMRect
    }
}
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))
const transform = () => card().style.transform

describe('MapPopup_', () => {
    let engine: ReturnType<typeof makeEngine>

    /**
     * Open a card of the given size on a map placed by `options`, and let it
     * settle where the anchor first puts it. The engine it opened on stays in
     * `engine`, so a spec can move the anchor on from there.
     */
    const placeCard = (
        options: Parameters<typeof makeEngine>[0] = {},
        { width = 200, height = 100 } = {}
    ): void => {
        engine = makeEngine(options)
        show(engine)
        sizeCard(width, height)
        engine.fire('move')
    }

    beforeEach(() => {
        engine = makeEngine()
    })

    afterEach(() => {
        MapPopup_.hide()
        document.body.innerHTML = ''
    })

    it('mounts one popup and leaves its request pending until it closes', async () => {
        const outcome = show(engine)

        expect(popups()).toHaveLength(1)

        await nextTick()
        expect(outcome).toEqual([])
    })

    it('renders both actions and resolves with the primary on its click', async () => {
        const outcome = show(engine, {
            secondaryAction: { label: 'Cancel' },
            primaryAction: { label: 'Analyze' },
        })

        // The primary leads the row.
        expect(
            Array.from(buttons()).map((button) => button.textContent)
        ).toEqual(['Analyze', 'Cancel'])

        clickOn(buttons()[0])
        await nextTick()

        expect(outcome).toEqual(['primary'])
        expect(popups()).toHaveLength(0)
    })

    it('styles a lone secondary action as the primary button', async () => {
        const outcome = show(engine, { secondaryAction: { label: 'Cancel' } })

        expect(buttons()).toHaveLength(1)
        expect(buttons()[0].className).toContain(
            'mmgis-map-popup__button--primary'
        )

        // It still answers with the slot it was requested in.
        clickOn(buttons()[0])
        await nextTick()
        expect(outcome).toEqual(['secondary'])
    })

    it('drops an action whose label is unusable', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        // A button with spaces on it is as blank as one with nothing on it.
        show(engine, {
            primaryAction: { label: '   ' },
            secondaryAction: {} as never,
        })

        expect(buttons()).toHaveLength(0)
        expect(warn).toHaveBeenCalledWith(
            '[MapPopup] Ignoring primaryAction: label must be a non-blank string.'
        )
        warn.mockRestore()
    })

    // A title is neither sanitized nor parsed: it never goes near the html
    // path, so markup in one arrives as the characters it was written with.
    it('renders the title as text rather than as markup', () => {
        show(engine, { title: '<b>Drawn</b> rectangle' })

        expect(title()!.textContent).toBe('<b>Drawn</b> rectangle')
        // The card announces itself by its heading.
        expect(card().getAttribute('aria-labelledby')).toBe(title()!.id)
    })

    // Buttons are not content: a card is a title, a body, or both.
    it('rejects a request with neither a title nor html to show', async () => {
        const outcome = track(
            MapPopup_.show(
                {
                    latlng: { lat: 45, lng: -120 },
                    title: '   ',
                    primaryAction: { label: 'Analyze' },
                },
                engine.engine as never
            )
        )
        await nextTick()

        expect(outcome).toEqual([NOTHING_TO_SHOW])
        expect(popups()).toHaveLength(0)
    })

    it.each([
        ['no anchor', { html: '<p>No anchor</p>' }],
        [
            'an html that is not a string',
            { latlng: { lat: 1, lng: 2 }, html: 42 },
        ],
        [
            'a title that is not a string',
            { latlng: { lat: 1, lng: 2 }, title: 42 },
        ],
    ])('rejects a request with %s', async (_case, invalid) => {
        const outcome = track(
            MapPopup_.show(invalid as never, engine.engine as never)
        )
        await nextTick()

        expect(outcome).toEqual([INVALID_REQUEST])
        expect(popups()).toHaveLength(0)
    })

    it('leaves an open popup alone when a later request is invalid', async () => {
        const outcome = show(engine, { html: '<p>Crater A</p>' })

        const invalid = track(
            MapPopup_.show(
                { html: '<p>No anchor</p>' } as MapPopupRequest,
                engine.engine as never
            )
        )
        await nextTick()

        expect(invalid).toEqual([INVALID_REQUEST])
        expect(popups()).toHaveLength(1)
        expect(card().textContent).toContain('Crater A')
        expect(outcome).toEqual([])
    })

    it('resolves dismiss and closes when the X is pressed', async () => {
        const outcome = show(engine)

        clickOn(closeButton())
        await nextTick()

        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
    })

    it('closes on Escape, answers as a dismissal, and gives focus back', async () => {
        const opener = document.createElement('button')
        document.body.appendChild(opener)
        opener.focus()

        const outcome = show(engine)
        // The app closes its own things on Escape too, and the innermost thing
        // open is the one the key was meant for.
        const alsoListening: string[] = []
        const app = () => alsoListening.push('app')
        document.body.addEventListener('keydown', app)

        card().dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        )
        await nextTick()
        document.body.removeEventListener('keydown', app)

        expect(alsoListening).toEqual([])
        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
        expect(document.activeElement).toBe(opener)
    })

    it('dismisses on a click that landed on empty map', async () => {
        const outcome = show(engine)

        engine.fire('click', { feature: null })
        await nextTick()

        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
    })

    // A click on a feature is the gesture a plugin answers by opening or
    // replacing a card, so it must never take one away — including the click
    // that opened this very card, which both engines report to every click
    // subscriber.
    it('keeps the card when the click landed on a feature', async () => {
        const outcome = show(engine)

        engine.fire('click', { feature: { type: 'Feature' } })
        await nextTick()

        expect(popups()).toHaveLength(1)
        expect(outcome).toEqual([])
    })

    // A plugin that opens a card from a click on empty map is itself a click
    // subscriber, and that same click is the one the card dismisses on. The
    // fake engine models the adapters' snapshot fan-out, so the card's own
    // dismiss subscription — made while the click is being delivered — is not
    // handed the click that created it.
    it('keeps a card opened by a click on empty map', async () => {
        let outcome: string[] = []
        engine.engine.on('click', () => {
            outcome = show(engine)
        })

        engine.fire('click', { feature: null })
        await nextTick()

        expect(popups()).toHaveLength(1)
        expect(outcome).toEqual([])
    })

    it('replaces the current popup and resolves the replaced request with closed', async () => {
        const first = show(engine, { html: '<p>First</p>' })
        const second = show(engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(card().textContent).toContain('Second')
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
    })

    it('retracts the popup for map:hidePopup, resolving its request with closed', async () => {
        const outcome = show(engine)

        // What the map:hidePopup provider calls.
        MapPopup_.hide()
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(outcome).toEqual(['closed'])
    })

    // deck.gl reports a camera every frame; Leaflet's comparison panes report
    // one only when it settles; a resized window resizes the map with it and
    // moves the anchor to a different pixel. A card has to follow all three.
    it('repositions the card on a move, a moveend and a window resize', () => {
        placeCard()
        expect(transform()).toBe('translate(300px, 138px)')

        engine.setPoint({ x: 210, y: 220 })
        engine.fire('moveend')
        expect(transform()).toBe('translate(210px, 158px)')

        engine.setPoint({ x: 300, y: 300 })
        window.dispatchEvent(new Event('resize'))
        expect(transform()).toBe('translate(300px, 238px)')
    })

    it('flips below the anchor when the card would clip the map top', () => {
        placeCard({ point: { x: 300, y: 50 }, containerTop: 0 })

        // 50 - 100 - 12 clips the top, so the card sits 12px below the anchor.
        expect(transform()).toBe('translate(300px, 62px)')
    })

    it('caps a card taller than the map so it fits inside the map', () => {
        // Taller than the room above its anchor, so it flips below, and taller
        // than the 600px map, so uncapped its actions row would end up out of
        // reach under the bottom panel region.
        placeCard(
            { point: { x: 300, y: 200 }, containerTop: 0 },
            { height: 650 }
        )

        // The map less the 8px margin at each edge, and the card placed at the
        // top margin, so it ends at 592 — inside the map.
        expect(card().style.maxHeight).toBe('584px')
        expect(transform()).toBe('translate(300px, 8px)')
    })

    // The layout lays panels over the map's edges, and those panels are
    // positioned, so a card that spilled past the map would be painted over
    // and its buttons swallowed.
    it('clamps the card to the map, not to the viewport', () => {
        placeCard({ point: { x: 5, y: 200 }, containerLeft: 300 })

        // Centred on its anchor at 305 the card would start at 205, clear of
        // the viewport but 95px over whatever sits left of the map, so it
        // stops 8px inside the map's own edge.
        expect(transform()).toBe('translate(308px, 138px)')
    })

    // The card is drawn clear of its anchor, so an anchor just off the map's
    // left edge still has most of its card over the map, and rides off with
    // the anchor rather than pinning to a viewport edge.
    it('parks the card once it no longer overlaps the map, and brings it back', () => {
        placeCard({ point: { x: -20, y: 200 }, containerLeft: 0 })
        expect(transform()).toBe('translate(-120px, 138px)')

        // Far enough left that the card's right edge clears the map's left.
        engine.setPoint({ x: -140, y: 200 })
        engine.fire('move')
        expect(transform()).toBe(PARKED)

        engine.setPoint({ x: 300, y: 200 })
        engine.fire('move')
        expect(transform()).toBe('translate(200px, 138px)')
    })

    // Before the engine has a view the projection throws, and the card waits,
    // parked, for a move that can place it.
    it('parks the card whenever its anchor cannot be projected', () => {
        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the engine has no view yet')
        }
        show(engine)
        expect(transform()).toBe(PARKED)

        engine.engine.latLngToContainerPoint = () => ({ x: 300, y: 200 })
        sizeCard(200, 100)
        engine.fire('move')
        expect(transform()).toBe('translate(300px, 138px)')
    })

    // Leaflet emits no move while its zoom animation runs, so the card would
    // otherwise hang at the pre-zoom position and jump at the end.
    it('parks the card while the engine animates a zoom and places it again after', () => {
        placeCard()

        engine.fire('zoomstart')
        expect(transform()).toBe(PARKED)

        engine.fire('zoomend')
        expect(transform()).toBe('translate(300px, 138px)')
    })

    it('unsubscribes from the engine and the window when hidden', async () => {
        const addListener = vi.spyOn(window, 'addEventListener')
        const removeListener = vi.spyOn(window, 'removeEventListener')
        const events = ['move', 'moveend', 'zoomstart', 'zoomend', 'click']
        const outcome = show(engine)
        for (const event of events) expect(engine.listenerCount(event)).toBe(1)

        MapPopup_.hide()
        await nextTick()

        for (const event of events) expect(engine.listenerCount(event)).toBe(0)
        // The same function objects, not merely the same event names: `off`
        // handed a fresh arrow unsubscribes nothing.
        const subscribedTo = new Map(engine.subscribed)
        expect(engine.unsubscribed.map(([event]) => event)).toEqual(events)
        for (const [event, handler] of engine.unsubscribed)
            expect(handler).toBe(subscribedTo.get(event))

        const added = addListener.mock.calls.filter(
            ([event]) => event === 'resize'
        )
        const removed = removeListener.mock.calls.filter(
            ([event]) => event === 'resize'
        )
        expect(added).toHaveLength(1)
        expect(removed).toHaveLength(1)
        expect(removed[0][1]).toBe(added[0][1])

        expect(outcome).toEqual(['closed'])
        addListener.mockRestore()
        removeListener.mockRestore()
    })

    // Teardown can run after the engine has been destroyed, when unsubscribing
    // throws. The card still has to leave and its request still has to answer.
    it('takes the card down even when the engine throws on unsubscribe', async () => {
        engine = makeEngine({ offThrows: true })
        const outcome = show(engine)

        MapPopup_.hide()
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(outcome).toEqual(['closed'])
    })

    // Failing on the last subscription the wiring makes leaves the unwind with
    // every one of them to drop, the window's `resize` among them.
    it('rejects and unwinds every subscription when wiring the popup fails', async () => {
        const removeListener = vi.spyOn(window, 'removeEventListener')
        const subscribe = engine.engine.on
        engine.engine.on = (event: string, handler: () => void) => {
            if (event === 'click') throw new Error('engine destroyed')
            subscribe(event, handler)
        }

        const outcome = track(MapPopup_.show(request(), engine.engine as never))
        await nextTick()
        await nextTick()

        // Answered exactly once, and with the failure: unwinding the half-built
        // popup neither resolves on top of it nor leaves the request hanging.
        expect(outcome).toHaveLength(1)
        expect(outcome[0]).toBe(WIRING_FAILED)
        expect(popups()).toHaveLength(0)
        for (const event of ['move', 'moveend', 'zoomstart', 'zoomend'])
            expect(engine.listenerCount(event)).toBe(0)
        expect(
            removeListener.mock.calls.filter(([event]) => event === 'resize')
        ).toHaveLength(1)
        removeListener.mockRestore()
    })

    // One slot, many plugins: a hide is a request to empty the slot, and by
    // the time it arrives the slot may hold someone else's popup. Core answers
    // only for the popup the caller opened, so no plugin has to track whether
    // what is on screen is still its own.
    it('retracts only for the caller that opened the popup', async () => {
        const owned = show(engine, {}, 'aoi')

        // Another plugin's hide finds a popup that is not theirs, and a caller
        // with no handle is not a skeleton key.
        expect(MapPopup_.hideForCaller('draw')).toBe(false)
        expect(MapPopup_.hideForCaller()).toBe(false)
        expect(popups()).toHaveLength(1)
        expect(MapPopup_.hideForCaller('aoi')).toBe(true)
        await nextTick()
        // Evicted, but still answered — the opener learns it is gone.
        expect(owned).toEqual(['closed'])

        // "No caller" is an identity of its own on both sides.
        const anonymous = show(engine)
        expect(MapPopup_.hideForCaller('aoi')).toBe(false)
        expect(MapPopup_.hideForCaller()).toBe(true)
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(anonymous).toEqual(['closed'])
        // With nothing open there is nothing to retract for anyone.
        expect(MapPopup_.hideForCaller()).toBe(false)
    })

    // jsdom applies no stylesheet and lays nothing out, so every assertion
    // here reads the markup the sanitizer produced rather than what it renders
    // as: a test that asked what the content looked like would pass on content
    // that had never been filtered at all.
    it('keeps the markup an author needs and strips the rest', () => {
        show(engine, {
            html: '<style>.mmgis-map-popup { contain: none }</style><p style="color: red">A</p><table><tr><td>Cell</td></tr></table><ul><li>One</li></ul><img src="a.png" alt="Crater A">',
        })

        const markup = body()
        // A card is plain DOM in the app's document, so an author's stylesheet
        // would be a stylesheet for the whole page.
        expect(markup).not.toContain('<style')
        expect(markup).not.toContain('contain: none')
        expect(markup).toContain('style="color: red"')
        expect(markup).toContain('<td>Cell</td>')
        expect(markup).toContain('<li>One</li>')
        expect(markup).toContain('alt="Crater A"')
    })

    it('refuses script, handlers, and urls that run something', () => {
        show(engine, {
            html: '<p onclick="alert(1)">Crater A</p><script>alert(2)</script><a href="javascript:alert(3)">go</a><img src=x onerror="alert(4)">',
        })

        const markup = body()
        expect(markup).toContain('Crater A')
        expect(markup).not.toContain('onclick')
        expect(markup).not.toContain('alert')
        expect(markup).not.toContain('javascript:')
    })

    // A link inside a card would navigate the whole app away by default,
    // taking the map, the session, and every other plugin with it.
    it('refuses at the click anything that would navigate in place', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null)
        show(engine, { html: '<a href="https://example.test">go</a>' })

        const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        })
        document.querySelector('a')!.dispatchEvent(click)

        expect(click.defaultPrevented).toBe(true)
        expect(open).toHaveBeenCalledWith(
            'https://example.test',
            '_blank',
            'noopener,noreferrer'
        )
        open.mockRestore()
    })

    it('gives focus back to whatever had it when the popup opened', async () => {
        const opener = document.createElement('button')
        document.body.appendChild(opener)
        opener.focus()

        show(engine)
        // Focus lands on the card rather than a control inside it, so a screen
        // reader reads the card's own name first.
        expect(document.activeElement).toBe(card())

        clickOn(closeButton())
        await nextTick()

        expect(document.activeElement).toBe(opener)
    })

    // A card inside the container would hand the map its own clicks: the
    // engines listen on the container they were given, so a press on a button
    // would read as a press on the map.
    it('puts the card beside the map container rather than inside it', () => {
        const host = document.createElement('div')
        host.appendChild(engine.engine.getContainer())
        document.body.appendChild(host)

        show(engine)

        expect(card().parentElement).toBe(host)
        expect(engine.engine.getContainer().contains(card())).toBe(false)
        expect(host.lastElementChild).toBe(card())
    })
})
