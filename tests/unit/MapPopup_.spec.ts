import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type {
    MapPopupRequest,
    MapPopupResult,
} from '../../src/essence/Basics/MapPopup_/types'

/**
 * Stand-in for the active map engine. jsdom lays nothing out, so the container
 * rect is stubbed to a known position and size.
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
                if (!listeners.has(event)) listeners.set(event, new Set())
                listeners.get(event)!.add(handler)
            },
            off: (event: string, handler: (event?: unknown) => void) => {
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
 * action, a rejection as `rejected: <message>`. The promise absorbs later
 * settlements, so the list holds the first only. Specs assert it whole, which
 * fails when the answer never arrives or the wrong close path answered first.
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

describe('MapPopup_', () => {
    let engine: ReturnType<typeof makeEngine>

    beforeEach(() => {
        engine = makeEngine()
    })

    afterEach(() => {
        MapPopup_.hide()
        document.body.innerHTML = ''
    })

    it('mounts a single popup and sanitizes the html', async () => {
        const outcome = show(engine, {
            html: '<p>Crater A</p><script>window.pwned = true</script>',
        })

        expect(popups()).toHaveLength(1)
        expect(body()).toContain('Crater A')
        expect(body()).not.toContain('script')

        // The request is answered only once the popup closes.
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
        expect(card().querySelector('b')).toBeNull()
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

    it('rejects a request whose fields are not what they claim', async () => {
        const noAnchor = track(
            MapPopup_.show(
                { html: '<p>No anchor</p>' } as MapPopupRequest,
                engine.engine as never
            )
        )
        const badHtml = track(
            MapPopup_.show(
                { latlng: { lat: 1, lng: 2 }, html: 42 } as unknown as MapPopupRequest,
                engine.engine as never
            )
        )
        const badTitle = track(
            MapPopup_.show(
                request({ title: 42 as unknown as string }),
                engine.engine as never
            )
        )
        await nextTick()

        expect(noAnchor).toEqual([INVALID_REQUEST])
        expect(badHtml).toEqual([INVALID_REQUEST])
        expect(badTitle).toEqual([INVALID_REQUEST])
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

    it('closes on Escape and answers as a dismissal', async () => {
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

        // Asking again with nothing open changes nothing.
        MapPopup_.hide()
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(outcome).toEqual(['closed'])
    })

    // deck.gl reports a camera every frame; Leaflet's comparison panes report
    // one only when it settles; a resized window resizes the map with it and
    // moves the anchor to a different pixel. A card has to follow all three.
    it('repositions the card on a move, a moveend and a window resize', () => {
        show(engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')

        engine.setPoint({ x: 210, y: 220 })
        engine.fire('moveend')
        expect(card().style.transform).toBe('translate(210px, 158px)')

        engine.setPoint({ x: 300, y: 300 })
        window.dispatchEvent(new Event('resize'))
        expect(card().style.transform).toBe('translate(300px, 238px)')
    })

    it('flips below the anchor when the card would clip the map top', () => {
        engine = makeEngine({ point: { x: 300, y: 50 }, containerTop: 0 })
        show(engine)
        sizeCard(200, 100)

        engine.fire('move')

        // 50 - 100 - 12 clips the top, so the card sits 12px below the anchor.
        expect(card().style.transform).toBe('translate(300px, 62px)')
    })

    it('caps a card taller than the map so it fits inside the map', () => {
        engine = makeEngine({ point: { x: 300, y: 200 }, containerTop: 0 })
        show(engine)
        // Taller than the room above its anchor, so it flips below, and taller
        // than the 600px map, so uncapped its actions row would end up out of
        // reach under the bottom panel region.
        sizeCard(200, 650)

        engine.fire('move')

        // The map less the 8px margin at each edge, and the card placed at the
        // top margin, so it ends at 592 — inside the map.
        expect(card().style.maxHeight).toBe('584px')
        expect(card().style.transform).toBe('translate(300px, 8px)')
    })

    // The layout lays panels over the map's edges, and those panels are
    // positioned, so a card that spilled past the map would be painted over
    // and its buttons swallowed.
    it('clamps the card to the map, not to the viewport', () => {
        engine = makeEngine({ point: { x: 5, y: 200 }, containerLeft: 300 })
        show(engine)
        sizeCard(200, 100)

        engine.fire('move')

        // Centred on its anchor at 305 the card would start at 205, clear of
        // the viewport but 95px over whatever sits left of the map, so it
        // stops 8px inside the map's own edge.
        expect(card().style.transform).toBe('translate(308px, 138px)')
    })

    // The card is drawn clear of its anchor, so an anchor just off the map's
    // left edge still has most of its card over the map, and rides off with
    // the anchor rather than pinning to a viewport edge.
    it('parks the card once it no longer overlaps the map, and brings it back', () => {
        engine = makeEngine({ point: { x: -20, y: 200 }, containerLeft: 0 })
        show(engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(-120px, 138px)')

        // Far enough left that the card's right edge clears the map's left.
        engine.setPoint({ x: -140, y: 200 })
        engine.fire('move')
        expect(card().style.transform).toBe(PARKED)

        engine.setPoint({ x: 300, y: 200 })
        engine.fire('move')
        expect(card().style.transform).toBe('translate(200px, 138px)')
    })

    // Before the engine has a view the projection throws, and the card waits,
    // parked, for a move that can place it.
    it('parks the card whenever its anchor cannot be projected', () => {
        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the engine has no view yet')
        }
        show(engine)
        expect(card().style.transform).toBe(PARKED)

        engine.engine.latLngToContainerPoint = () => ({ x: 300, y: 200 })
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')
    })

    // Leaflet emits no move while its zoom animation runs, so the card would
    // otherwise hang at the pre-zoom position and jump at the end.
    it('parks the card while the engine animates a zoom and places it again after', () => {
        show(engine)
        sizeCard(200, 100)
        engine.fire('move')

        engine.fire('zoomstart')
        expect(card().style.transform).toBe(PARKED)

        engine.fire('zoomend')
        expect(card().style.transform).toBe('translate(300px, 138px)')
    })

    it('unsubscribes from the engine and the window when hidden', async () => {
        const removeListener = vi.spyOn(window, 'removeEventListener')
        const outcome = show(engine)
        for (const event of ['move', 'moveend', 'zoomstart', 'zoomend', 'click'])
            expect(engine.listenerCount(event)).toBe(1)

        MapPopup_.hide()
        await nextTick()

        for (const event of ['move', 'moveend', 'zoomstart', 'zoomend', 'click'])
            expect(engine.listenerCount(event)).toBe(0)
        expect(removeListener).toHaveBeenCalledWith(
            'resize',
            expect.any(Function)
        )
        expect(outcome).toEqual(['closed'])
        removeListener.mockRestore()
    })

    it('rejects and leaves nothing mounted when wiring the popup fails', async () => {
        const subscribe = engine.engine.on
        engine.engine.on = (event: string, handler: () => void) => {
            if (event === 'zoomend') throw new Error('engine destroyed')
            subscribe(event, handler)
        }

        // The failure is the answer: unwinding the half-built popup does not
        // resolve the request on top of it.
        const outcome = track(MapPopup_.show(request(), engine.engine as never))
        await nextTick()

        expect(outcome).toEqual([
            'rejected: [MapPopup] Could not show the popup: Error: engine destroyed',
        ])
        expect(popups()).toHaveLength(0)
        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('zoomstart')).toBe(0)
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

        const outcome = show(engine)
        // Focus lands on the card rather than a control inside it, so a screen
        // reader reads the card's own name first.
        expect(document.activeElement).toBe(card())

        clickOn(closeButton())
        await nextTick()

        expect(document.activeElement).toBe(opener)
        expect(outcome).toEqual(['dismiss'])
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
