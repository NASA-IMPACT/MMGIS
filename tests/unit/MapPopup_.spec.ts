import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type {
    MapPopupRequest,
    MapPopupResult,
} from '../../src/essence/Basics/MapPopup_/types'

/**
 * Stand-in for the active map engine. jsdom lays nothing out, so the container
 * rect is stubbed to a known position and size. Handlers are snapshotted
 * before dispatch, as the engines do, so a handler unsubscribed mid-dispatch
 * still receives that event.
 */
function makeEngine({
    point = { x: 300, y: 200 },
    containerTop = 50,
    containerLeft = 100,
    containerWidth = 800,
    containerHeight = 600,
    offThrows = false,
} = {}) {
    const listeners = new Map<string, Set<() => void>>()
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
        fire: (event: string) => {
            const handlers = listeners.get(event)
            if (handlers) Array.from(handlers).forEach((handler) => handler())
        },
        setPoint: (next: { x: number; y: number }) => {
            projected = next
        },
        engine: {
            on: (event: string, handler: () => void) => {
                if (!listeners.has(event)) listeners.set(event, new Set())
                listeners.get(event)!.add(handler)
            },
            off: (event: string, handler: () => void) => {
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
 * action, a rejection as `rejected: <message>`. Later settlements are absorbed
 * by the promise, so the list holds the first one only. Specs assert it whole,
 * which fails the test when the answer never arrives or when the wrong close
 * path answered first.
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
const OUT_OF_RANGE =
    'rejected: [MapPopup] Invalid request: latlng must hold a lat within ±90.'
const NOTHING_TO_SHOW =
    'rejected: [MapPopup] Invalid request: a popup needs a title or html to show.'

const popups = () => document.querySelectorAll('.mmgis-map-popup')
const card = () => document.querySelector<HTMLElement>('.mmgis-map-popup')!
const title = () =>
    document.querySelector<HTMLElement>('.mmgis-map-popup__title')
const content = () =>
    document.querySelector<HTMLElement>('.mmgis-map-popup__content')
/** The shadow root the plugin's own markup is mounted in. */
const contentRoot = () => content()!.shadowRoot!
/** That markup as the sanitizer and the link walk left it. */
const body = () => contentRoot().innerHTML
/**
 * Everything on the card as text. The plugin's markup sits in a shadow root,
 * which the card's own `textContent` does not reach into.
 */
const cardText = () =>
    card().textContent! + (content() ? contentRoot().textContent : '')
const buttons = () => document.querySelectorAll('.mmgis-map-popup__button')
/** Where MapPopup_ parks a card that has nowhere on screen to be. */
const PARKED = 'translate(-100000px, -100000px)'
/** Give the card a real size; jsdom reports every element as 0x0. */
const sizeCard = (width: number, height: number) => {
    card().getBoundingClientRect = () => ({ width, height }) as DOMRect
}
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The surface of the ResizeObserver the vitest setup file stands in with. */
interface StubResizeObserver {
    callback: () => void
    observed: Set<Element>
}
/**
 * The observer watching `target`, from the registry that stub keeps. jsdom
 * lays nothing out, so a card resizes only when a spec says it does.
 */
const observerFor = (target: Element): StubResizeObserver | undefined =>
    Array.from(
        (
            window.ResizeObserver as unknown as {
                instances: Set<StubResizeObserver>
            }
        ).instances
    ).find((observer) => observer.observed.has(target))

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

        buttons()[0].dispatchEvent(new MouseEvent('click'))
        await nextTick()

        expect(outcome).toEqual(['primary'])
        expect(popups()).toHaveLength(0)
    })

    it('styles a lone secondary action as the primary button', async () => {
        const outcome = show(engine, {
            secondaryAction: { label: 'Cancel' },
        })

        expect(buttons()).toHaveLength(1)
        expect(buttons()[0].className).toContain(
            'mmgis-map-popup__button--primary'
        )

        // It still answers with the slot it was requested in.
        buttons()[0].dispatchEvent(new MouseEvent('click'))
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

    // A heading is the caller's to leave out, and the card looks the way it
    // always has without one. With one, the heading takes the close control's
    // row and speaks for the whole card.
    describe('the title', () => {
        it('renders the title as text rather than as markup', () => {
            show(engine, { title: '<b>Drawn</b> rectangle' })

            // The body is sanitized markup; a title is neither sanitized nor
            // parsed, because it never goes near the html path.
            expect(title()!.textContent).toBe('<b>Drawn</b> rectangle')
            expect(title()!.querySelector('b')).toBeNull()
            expect(card().querySelector('b')).toBeNull()

            // As blank a heading as an empty one: it would take a row of the
            // card and say nothing on it.
            show(engine, { title: '   ', html: '<p>Crater A</p>' })
            expect(title()).toBeNull()
        })

        it('renders a card that is a title and its actions', async () => {
            const outcome = show(engine, {
                title: 'Drawn rectangle',
                html: undefined,
                primaryAction: { label: 'Analyze' },
                secondaryAction: { label: 'Cancel' },
            })

            expect(title()!.textContent).toBe('Drawn rectangle')
            // Nothing was given to show as a body, so there is no body box
            // reserving room under the heading.
            expect(content()).toBeNull()
            expect(
                Array.from(buttons()).map((button) => button.textContent)
            ).toEqual(['Analyze', 'Cancel'])

            buttons()[0].dispatchEvent(new MouseEvent('click'))
            await nextTick()
            expect(outcome).toEqual(['primary'])
        })

        it('rejects a request with neither a title nor html to show', async () => {
    
            const empty = track(
                MapPopup_.show(
                    { latlng: { lat: 45, lng: -120 } } as MapPopupRequest,
                    engine.engine as never
                )
            )
            const blank = track(
                MapPopup_.show(
                    request({ title: '   ', html: '  ' }),
                    engine.engine as never
                )
            )
            // Buttons are not content: there would be nothing on the card to
            // act on.
            const buttonsOnly = track(
                MapPopup_.show(
                    request({
                        html: undefined,
                        primaryAction: { label: 'Analyze' },
                    }),
                    engine.engine as never
                )
            )
            await nextTick()

            expect(empty).toEqual([NOTHING_TO_SHOW])
            expect(blank).toEqual([NOTHING_TO_SHOW])
            expect(buttonsOnly).toEqual([NOTHING_TO_SHOW])
            expect(popups()).toHaveLength(0)
        })
    })

    // A dialog with a generic name tells a screen reader user nothing about
    // which popup they have landed in.
    it('takes its name from the title, falling back to the generic one', () => {
        show(engine, { title: 'Drawn rectangle' })

        expect(card().getAttribute('aria-labelledby')).toBe(title()!.id)
        expect(title()!.id).not.toBe('')
        // The heading is the name, so the generic one would only compete
        // with it.
        expect(card().getAttribute('aria-label')).toBeNull()

        show(engine, { html: '<p>Crater A</p>' })

        expect(card().getAttribute('aria-label')).toBe('Map popup')
        expect(card().getAttribute('aria-labelledby')).toBeNull()
    })

    it('resolves dismiss and closes when the X is pressed', async () => {
        const outcome = show(engine)

        document
            .querySelector('.mmgis-map-popup__close')!
            .dispatchEvent(new MouseEvent('click'))
        await nextTick()

        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
    })

    it('dismisses on a map click once the opening gesture has passed', async () => {
        const outcome = show(engine)
        await nextTick()

        engine.fire('click')
        expect(popups()).toHaveLength(1)

        await nextTick()
        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
    })

    it('ignores the map click that deck.gl emits after the feature click that opened the popup', async () => {
        // deck.gl calls its feature-click handler and then emits the click, so
        // a popup opened from a feature click would otherwise be dismissed by
        // the very click that opened it.
        const outcome = show(engine)
        engine.fire('click')

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(outcome).toEqual([])
    })

    it('keeps a popup opened later in the same gesture as the dismissing click', async () => {
        // Leaflet emits its click before its feature click, so a plugin's
        // replacement popup is shown after the dismissal was scheduled.
        const first = show(engine, { html: '<p>First</p>' })
        await nextTick()

        engine.fire('click')
        const second = show(engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(cardText()).toContain('Second')
        // The replacement closed the first popup, so the pending dismissal
        // finds it already gone.
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
    })

    it('replaces the current popup and resolves the replaced request with closed', async () => {
        const first = show(engine, { html: '<p>First</p>' })
        const second = show(engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(cardText()).toContain('Second')
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

    it('repositions the card on every engine move', () => {
        show(engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')

        engine.setPoint({ x: 210, y: 220 })
        engine.fire('move')

        expect(card().style.transform).toBe('translate(210px, 158px)')
    })

    // deck.gl's comparison panes report a camera only once it settles, so a
    // card following `move` alone would sit still while a pane is dragged.
    it('repositions the card on an engine moveend', () => {
        show(engine)
        sizeCard(200, 100)

        engine.setPoint({ x: 210, y: 220 })
        engine.fire('moveend')

        expect(card().style.transform).toBe('translate(210px, 158px)')
    })

    it('flips below the anchor when the card would clip the viewport top', () => {
        engine = makeEngine({ point: { x: 300, y: 50 }, containerTop: 0 })
        show(engine)
        sizeCard(200, 100)

        engine.fire('move')

        // 50 - 100 - 12 clips the top, so the card sits 12px below the anchor.
        expect(card().style.transform).toBe('translate(300px, 62px)')
    })

    it('keeps a card flipped below a low anchor inside the map', () => {
        engine = makeEngine({ point: { x: 300, y: 200 }, containerTop: 0 })
        show(engine)
        // Taller than the room above its anchor, so it flips below it.
        sizeCard(200, 650)

        engine.fire('move')

        // Left where the flip put it, at 212, the card would end 862px down a
        // 600px map with its actions row out of reach, so both clamps bite and
        // the top one wins, at the 8px margin.
        expect(card().style.transform).toBe('translate(300px, 8px)')
    })

    it('clamps the card to the viewport when its anchor sits near an edge', () => {
        engine = makeEngine({ point: { x: 5, y: 200 }, containerLeft: 0 })
        show(engine)
        sizeCard(200, 100)

        engine.fire('move')

        // Centering on x=5 would push the card off screen, so it stops at the
        // 8px margin.
        expect(card().style.transform).toBe('translate(8px, 138px)')
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

    it('repositions when the card itself resizes, until the popup is hidden', () => {
        // Content that lands late — an image, a lazy fetch — grows the card
        // downwards from a top-left transform, so the card watches its own box
        // rather than waiting for a map event that may never come.
        engine = makeEngine({ point: { x: 300, y: 400 }, containerTop: 0 })
        show(engine)
        sizeCard(200, 100)
        const watched = card()
        const observer = observerFor(watched)
        expect(observer).toBeDefined()

        sizeCard(200, 200)
        observer!.callback()

        // A hundred pixels taller, so its top rises a hundred pixels to keep
        // the same gap above the anchor.
        expect(card().style.transform).toBe('translate(300px, 188px)')

        MapPopup_.hide()

        expect(observerFor(watched)).toBeUndefined()
    })

    it('parks the card once it no longer overlaps the map, and brings it back', () => {
        // The card is drawn clear of its anchor, so an anchor just off the
        // map's left edge still has most of its card over the map, and rides
        // off with the anchor rather than parking against a viewport edge.
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

    it('parks a card that has cleared the map while still on screen', () => {
        // Panels are docked around the map, so the map container is not the
        // window. The card belongs to the map: spanning 40 to 240 it is well
        // inside a 1024px viewport, but the map starts at 300.
        engine = makeEngine({
            point: { x: -160, y: 200 },
            containerLeft: 300,
            containerWidth: 400,
        })
        show(engine)
        sizeCard(200, 100)

        engine.fire('move')

        expect(card().style.transform).toBe(PARKED)
    })

    it('parks the card whenever its anchor cannot be projected', () => {
        // Before the engine has a view, and again once the map is torn down
        // while the popup is open, the projection throws and the card waits,
        // parked, for a move that can place it.
        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the engine has no view yet')
        }
        show(engine)
        expect(card().style.transform).toBe(PARKED)

        engine.engine.latLngToContainerPoint = () => ({ x: 300, y: 200 })
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')

        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the container is gone')
        }
        engine.fire('move')
        expect(card().style.transform).toBe(PARKED)
    })

    it('parks the card while the engine animates a zoom and places it again after', () => {
        // Leaflet emits no move while its zoom animation runs, so the card
        // would otherwise hang at the pre-zoom position and jump at the end.
        show(engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')

        engine.fire('zoomstart')
        expect(card().style.transform).toBe(PARKED)

        engine.fire('zoomend')
        expect(card().style.transform).toBe('translate(300px, 138px)')
    })

    // A card that hides by going invisible is not hidden at all: content is
    // free to set `visibility: visible` on itself and paint straight through
    // the card's hiding, whether the card is mid-zoom, off the map, or waiting
    // for a projection. Parking is a hide content cannot undo, and unlike
    // `display: none` it leaves the card a box for `_reposition` to measure.
    it('parks the card rather than blanking it', () => {
        engine = makeEngine({ point: { x: -400, y: 200 }, containerLeft: 0 })
        show(engine)
        sizeCard(200, 100)

        engine.fire('move')

        expect(card().style.transform).toBe(PARKED)
        expect(card().style.visibility).toBe('')
        // Still a box, so the placement that brings it back has something to
        // measure.
        expect(card().getBoundingClientRect().width).toBe(200)
    })

    it('unsubscribes from the engine and the window when hidden', async () => {
        const removeListener = vi.spyOn(window, 'removeEventListener')
        const outcome = show(engine)
        await nextTick()
        expect(engine.listenerCount('move')).toBe(1)
        expect(engine.listenerCount('moveend')).toBe(1)
        expect(engine.listenerCount('zoomstart')).toBe(1)
        expect(engine.listenerCount('zoomend')).toBe(1)
        expect(engine.listenerCount('click')).toBe(1)

        MapPopup_.hide()
        await nextTick()

        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('moveend')).toBe(0)
        expect(engine.listenerCount('zoomstart')).toBe(0)
        expect(engine.listenerCount('zoomend')).toBe(0)
        expect(engine.listenerCount('click')).toBe(0)
        expect(removeListener).toHaveBeenCalledWith(
            'resize',
            expect.any(Function)
        )
        expect(outcome).toEqual(['closed'])
        removeListener.mockRestore()
    })

    it('never listens for clicks when hidden before the opening task ends', async () => {
        const outcome = show(engine)
        MapPopup_.hide()

        await nextTick()

        expect(engine.listenerCount('click')).toBe(0)
        expect(outcome).toEqual(['closed'])
    })

    it('rejects and leaves nothing mounted when wiring the popup fails', async () => {
        const subscribe = engine.engine.on
        engine.engine.on = (event: string, handler: () => void) => {
            if (event === 'zoomend') throw new Error('engine destroyed')
            subscribe(event, handler)
        }

        const outcome = track(MapPopup_.show(request(), engine.engine as never))
        await nextTick()

        // The failure is the answer: unwinding the half-built popup does not
        // resolve the request on top of it.
        expect(outcome).toEqual([
            'rejected: [MapPopup] Could not show the popup: Error: engine destroyed',
        ])
        expect(popups()).toHaveLength(0)
        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('zoomstart')).toBe(0)
        expect(engine.listenerCount('click')).toBe(0)
    })

    it('still tears down when the engine has already been destroyed', async () => {
        engine = makeEngine({ offThrows: true })
        const outcome = show(engine)

        MapPopup_.hide()
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(engine.listenerCount('click')).toBe(0)
        expect(outcome).toEqual(['closed'])
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
                {
                    latlng: { lat: 1, lng: 2 },
                    html: 42,
                } as unknown as MapPopupRequest,
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

    it('rejects a latitude off the globe', async () => {

        const offGlobe = track(
            MapPopup_.show(
                request({ latlng: { lat: 200, lng: 0 } }),
                engine.engine as never
            )
        )
        await nextTick()

        // Finite, so nothing downstream complains: Mercator clamps it to the
        // pole and opens the popup somewhere the caller never asked for.
        expect(offGlobe).toEqual([OUT_OF_RANGE])
        expect(popups()).toHaveLength(0)
    })

    it('accepts a longitude past the antimeridian', async () => {

        // What a map panned across the antimeridian hands out. It projects to
        // the pixel the caller meant, one world east of the prime copy.
        const outcome = track(
            MapPopup_.show(
                request({ latlng: { lat: 0, lng: 190 } }),
                engine.engine as never
            )
        )
        await nextTick()

        expect(outcome).toEqual([])
        expect(popups()).toHaveLength(1)
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
        expect(cardText()).toContain('Crater A')
        expect(outcome).toEqual([])
    })

    // One slot, many plugins: a hide is a request to empty the slot, and by
    // the time it arrives the slot may hold someone else's popup. Core answers
    // only for the popup the caller opened, so no plugin has to track whether
    // what is on screen is still its own.
    describe('retracting is scoped to whoever opened the popup', () => {
        it("closes the caller's own popup and nobody else's", async () => {
            const outcome = show(engine, {}, 'aoi')

            // Another plugin's hide finds a popup that is not theirs, and a
            // caller with no handle — the console, an embedding page — is not
            // a skeleton key.
            expect(MapPopup_.hideForCaller('draw')).toBe(false)
            expect(MapPopup_.hideForCaller()).toBe(false)
            await nextTick()
            expect(popups()).toHaveLength(1)
            expect(outcome).toEqual([])

            expect(MapPopup_.hideForCaller('aoi')).toBe(true)
            await nextTick()

            expect(popups()).toHaveLength(0)
            // Evicted, but still answered — the opener learns it is gone.
            expect(outcome).toEqual(['closed'])
        })

        it('keeps an anonymous popup and a plugin\'s apart', async () => {
            // "No caller" is a value of its own on both sides.
            const outcome = show(engine)

            expect(MapPopup_.hideForCaller('aoi')).toBe(false)
            await nextTick()
            expect(popups()).toHaveLength(1)
            expect(outcome).toEqual([])

            expect(MapPopup_.hideForCaller()).toBe(true)
            await nextTick()
            expect(popups()).toHaveLength(0)
            expect(outcome).toEqual(['closed'])

            // With nothing open there is nothing to retract for anyone.
            expect(MapPopup_.hideForCaller('aoi')).toBe(false)
            expect(MapPopup_.hideForCaller()).toBe(false)
        })

        // Showing is not retracting: the slot holds one popup, so a new
        // request takes it whoever the last one belonged to. Ownership decides
        // who may retract, never who may open.
        it("lets a plugin's popup replace another plugin's", async () => {
            const first = show(engine, { html: '<p>AOI</p>' }, 'aoi')
            const second = show(engine, { html: '<p>Draw</p>' }, 'draw')
            await nextTick()

            expect(first).toEqual(['closed'])
            expect(second).toEqual([])
            expect(popups()).toHaveLength(1)
            expect(cardText()).toContain('Draw')
            // The replacement is the new owner, and the old one cannot take
            // the slot back.
            expect(MapPopup_.hideForCaller('aoi')).toBe(false)
            expect(MapPopup_.hideForCaller('draw')).toBe(true)
        })
    })

    // What an author may write inside their card, and what the core refuses on
    // the way in. Every assertion here reads the markup the sanitizer produced
    // rather than what it renders as: jsdom applies no stylesheet and lays
    // nothing out, so a test that asked what the content looked like would
    // pass on content that had never been filtered at all.
    describe('what a card is allowed to hold', () => {
        it('mounts the plugin markup in a shadow root of its own', () => {
            show(engine, { html: '<p>Crater A</p>' })

            // Nothing in the card's own tree, so a stylesheet the author
            // writes styles their content and stops there.
            expect(content()!.innerHTML).toBe('')
            expect(contentRoot().mode).toBe('open')
            expect(body()).toContain('<p>Crater A</p>')
        })

        it("keeps a stylesheet the author opens their content with", () => {
            // The parser hoists a stylesheet that opens a document into the
            // head, and the head is not what the sanitizer returns, so without
            // asking for the body the one place an author is most likely to
            // write their stylesheet is the one place it would vanish from.
            show(engine, {
                html: '<style>@keyframes pulse { to { opacity: 0.5 } } .dot:hover { color: red }</style><p class="dot">Crater A</p>',
            })

            expect(body()).toContain('@keyframes pulse')
            expect(body()).toContain('.dot:hover')
        })

        it('renders a form and its controls as inert content', () => {
            // Nothing reads a control back — the contract carries no script,
            // and the card answers with which button was pressed and nothing
            // else — so a field is markup like any other, and a card built
            // around one comes back whole rather than blank.
            show(engine, {
                html: '<form action="https://evil.test"><p>Pick one</p><button>Press me</button><select><option>Only</option></select><input value="x"><textarea>Type</textarea></form><canvas width="10"></canvas>',
            })

            expect(body()).toContain('<form')
            expect(body()).toContain('Pick one')
            expect(body()).toContain('<button')
            expect(body()).toContain('<input')
            expect(body()).toContain('Only')
            expect(body()).toContain('Type')
            expect(body()).toContain('<canvas')
        })

        it('never spills the text of a tag whose contents are not markup', () => {
            // DOMPurify keeps its own list of those tags, and naming a
            // `FORBID_CONTENTS` of our own would replace that list rather than
            // extend it, leaving the raw text of an `xmp` to read as prose.
            show(engine, {
                html: '<p>Crater A</p><xmp>rm -rf /</xmp>',
            })

            expect(body()).toContain('Crater A')
            expect(body()).not.toContain('rm -rf')
        })

        it('refuses what would put content in the top layer', () => {
            // A popover promotes itself above the app's panels, where neither
            // the card's clipping nor its paint containment can follow. It is
            // the one thing DOMPurify passes that a card cannot contain.
            show(engine, {
                html: '<button popovertarget="p">Open</button><div id="p" popover>Top layer</div><p>Crater A</p>',
            })

            expect(body()).not.toContain('popover')
            expect(body()).toContain('Crater A')
        })

        it('refuses what would reach past the card', () => {
            // DOMPurify's defaults answer this one; the assertions are here so
            // an upgrade that stopped answering it is a failure and not a
            // surprise in the field.
            show(engine, {
                html: '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><p>Crater A</p>',
            })

            expect(body()).not.toContain('iframe')
            expect(body()).not.toContain('object')
            expect(body()).not.toContain('embed')
            expect(body()).toContain('Crater A')
        })

        it('refuses script, handlers, and urls that run something', () => {
            show(engine, {
                html: '<p onclick="alert(1)">Crater A</p><script>alert(2)</script><a href="javascript:alert(3)">go</a><img src=x onerror="alert(4)">',
            })

            expect(body()).not.toContain('onclick')
            expect(body()).not.toContain('alert')
            expect(body()).not.toContain('javascript:')
        })

        it('keeps static svg whole and refuses the elements that only animate', () => {
            show(engine, {
                html: '<svg viewBox="0 0 10 10"><title>Rose</title><desc>A compass rose</desc><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><filter id="f"><feFlood flood-color="#fff" flood-opacity="0.5"/><feDropShadow dx="1" dy="1"/><feGaussianBlur stdDeviation="2"/></filter><clipPath id="c"><rect width="4" height="4"/></clipPath></defs><g clip-path="url(#c)"><path d="M0 0 L10 10" vector-effect="non-scaling-stroke" pointer-events="none"/><text dominant-baseline="middle">N</text></g></svg>',
            })

            let markup = body()
            expect(markup).toContain('flood-color="#fff"')
            expect(markup).toContain('vector-effect="non-scaling-stroke"')
            expect(markup).toContain('dominant-baseline="middle"')
            expect(markup).toContain('<title>Rose</title>')
            expect(markup).toContain('stdDeviation="2"')
            expect(markup).toContain('viewBox="0 0 10 10"')

            show(engine, {
                html: '<svg><rect><animate attributeName="x" dur="1s" to="10"/><set attributeName="y" to="4"/></rect></svg>',
            })

            markup = body()
            expect(markup).not.toContain('animate')
            expect(markup).not.toContain('attributeName')
            expect(markup).not.toContain('<set')
        })

        it('keeps the inert markup and the attributes an author needs', () => {
            // Representative rather than exhaustive: what a card may carry is
            // DOMPurify's own curated answer, and this is the part of it the
            // popup's own contract would notice the loss of.
            show(engine, {
                html: '<img src="a.png" alt="Crater A from orbit"><video controls><track kind="captions" srclang="en" label="English" src="c.vtt"></video><p id="a" class="b" data-feature="crater-a" role="note" aria-label="Crater A" style="color: red">A<sub>1</sub> <del>old</del><ins>new</ins></p><math><mfrac><mi>a</mi><mn>2</mn></mfrac></math><table><tr><td colspan="2">Cell</td></tr></table>',
            })

            const markup = body()
            expect(markup).toContain('alt="Crater A from orbit"')
            expect(markup).toContain('kind="captions"')
            expect(markup).toContain('data-feature="crater-a"')
            expect(markup).toContain('aria-label="Crater A"')
            expect(markup).toContain('style="color: red"')
            expect(markup).toContain('<del>old</del>')
            expect(markup).toContain('<mfrac>')
            expect(markup).toContain('colspan="2"')
        })

    })

    // A link inside a card navigates the whole app away by default, taking the
    // map, the session, and every other plugin with it.
    describe('where a link in a card goes', () => {
        const link = () => contentRoot().querySelector('a')!

        it('sends every link that goes anywhere to a tab of its own', () => {
            show(engine, {
                // A target the author asked for is overridden — stripping it
                // would make this worse, the link then navigating in place —
                // and an empty `href` goes out too: it resolves to the document
                // the app is running in, so following one reloads the app.
                html: '<a href="https://example.test/crater" target="_self">Crater A</a><a href="">Reload</a><a href="#details">More</a><p id="details">41.4 m</p>',
            })

            const anchors = contentRoot().querySelectorAll('a')
            expect(anchors[0].getAttribute('target')).toBe('_blank')
            expect(anchors[0].getAttribute('rel')).toBe('noopener noreferrer')
            expect(anchors[1].getAttribute('target')).toBe('_blank')
            expect(anchors[1].getAttribute('rel')).toBe('noopener noreferrer')
            // A bare fragment navigates nothing, so it is left alone. Fragment
            // lookup never enters a shadow tree, so it reaches none of the
            // card's own ids either; the most it can do is name an element of
            // the app, which is inert here.
            expect(anchors[2].getAttribute('target')).toBeNull()
            expect(anchors[2].getAttribute('rel')).toBeNull()
        })

        it('sends an svg link out the same way', () => {
            show(engine, {
                html: '<svg><a xlink:href="https://example.test"><rect width="4" height="4"/></a></svg>',
            })

            expect(link().getAttribute('target')).toBe('_blank')
            expect(link().getAttribute('rel')).toBe('noopener noreferrer')
        })

        // An `<area href>` is a link wearing an image map, and the sanitizer
        // passes `<map>`/`<area>` through.
        it('sends an image map area out the same way', () => {
            show(engine, {
                html: '<img src="a.png" usemap="#m" alt="Crater A"><map name="m"><area shape="rect" coords="0,0,4,4" href="https://example.test" alt="Crater A"></map>',
            })

            const area = contentRoot().querySelector('area')!
            expect(area.getAttribute('target')).toBe('_blank')
            expect(area.getAttribute('rel')).toBe('noopener noreferrer')

            const click = new MouseEvent('click', {
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            area.removeAttribute('target')
            const open = vi
                .spyOn(window, 'open')
                .mockImplementation(() => null)
            area.dispatchEvent(click)

            expect(click.defaultPrevented).toBe(true)
            expect(open).toHaveBeenCalledWith(
                'https://example.test',
                '_blank',
                'noopener,noreferrer'
            )
            open.mockRestore()
        })

        it('refuses at the click anything that would still navigate in place', () => {
            const open = vi
                .spyOn(window, 'open')
                .mockImplementation(() => null)
            show(engine, { html: '<a href="https://example.test">go</a>' })
            // Whatever put it back — a mutation the walk never saw — the click
            // is the last place to catch it.
            link().removeAttribute('target')

            const click = new MouseEvent('click', {
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            link().dispatchEvent(click)

            expect(click.defaultPrevented).toBe(true)
            expect(open).toHaveBeenCalledWith(
                'https://example.test',
                '_blank',
                'noopener,noreferrer'
            )
            open.mockRestore()
        })

        it('refuses a submit outright', () => {
            // A form reaches the card whole, `action` and all, so the guard is
            // what keeps the controls inside it inert rather than dangerous.
            show(engine, {
                html: '<form action="https://evil.test"><input name="q"><button type="submit">Go</button></form>',
            })

            const submit = new Event('submit', {
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            contentRoot().querySelector('form')!.dispatchEvent(submit)

            expect(submit.defaultPrevented).toBe(true)
        })
    })

    // The popup is a dialog: focus moves into it when it opens, stays there
    // while it is open, and goes back where it came from when it closes.
    describe('the card as a dialog', () => {
        /**
         * Where focus really is. The document names the shadow host, and the
         * host names what is focused within it.
         */
        const deepActive = (): Element | null => {
            let active = document.activeElement
            while (active?.shadowRoot?.activeElement) {
                active = active.shadowRoot.activeElement
            }
            return active
        }
        const press = (key: string, shiftKey = false): KeyboardEvent => {
            const event = new KeyboardEvent('keydown', {
                key,
                shiftKey,
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            deepActive()!.dispatchEvent(event)
            return event
        }
        const closeButton = () =>
            document.querySelector<HTMLElement>('.mmgis-map-popup__close')!

        it('names itself as a dialog the keyboard is working in', () => {
            show(engine, { title: 'Drawn rectangle' })

            expect(card().getAttribute('role')).toBe('dialog')
            // No `aria-modal`, which would say the app behind the card is
            // unavailable. Nothing out there is inert and no barrier covers
            // it, so a pointer reaches all of it.
            expect(card().getAttribute('aria-modal')).toBeNull()
            // Focusable, but never a Tab stop of its own.
            expect(card().tabIndex).toBe(-1)
        })

        it('closes on Escape and answers as a dismissal', async () => {
            const outcome = show(engine, { html: '<p>Crater A</p>' })
            // The app closes its own things on Escape too, and the innermost
            // thing open is the one the key was meant for.
            const alsoListening: string[] = []
            const app = () => alsoListening.push('app')
            document.body.addEventListener('keydown', app)

            press('Escape')
            await nextTick()
            document.body.removeEventListener('keydown', app)

            expect(alsoListening).toEqual([])
            expect(popups()).toHaveLength(0)
            expect(outcome).toEqual(['dismiss'])
        })

        it('wraps a Tab at either end of the card, and off the card itself', () => {
            show(engine, {
                html: '<a href="https://example.test">Crater A</a>',
                primaryAction: { label: 'Analyze' },
            })

            // Where focus starts, so this is the first Shift+Tab of every
            // popup a keyboard user opens.
            const offCard = press('Tab', true)
            expect(offCard.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(buttons()[0])

            const forward = press('Tab')
            expect(forward.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())

            const backward = press('Tab', true)
            expect(backward.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(buttons()[0])
        })

        it('counts the plugin own controls among the stops, in their place', () => {
            // Sequential focus navigation moves through a shadow tree as
            // though its contents sat where the host does, so a trap that read
            // the card's light DOM alone would put its last stop ahead of the
            // plugin's links and let a Tab out of the dialog from there.
            show(engine, {
                html: '<a href="https://a.test">One</a><a href="https://b.test">Two</a>',
            })
            const links = Array.from(contentRoot().querySelectorAll('a'))

            closeButton().focus()
            expect(press('Tab').defaultPrevented).toBe(false)

            links[1].focus()
            const tab = press('Tab')

            // The second link is the card's last stop, there being no actions
            // row after it, so the wrap happens there.
            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it("counts the form controls in the plugin's own markup", () => {
            // A card may hold a field, so a trap that named only the chrome's
            // buttons would let a Tab out of the dialog through one.
            show(engine, {
                html: '<input name="q"><textarea name="notes"></textarea><input name="off" disabled>',
            })
            const field = contentRoot().querySelector('input')!
            const notes = contentRoot().querySelector('textarea')!

            field.focus()
            expect(press('Tab').defaultPrevented).toBe(false)

            // The disabled field is no stop, so the textarea is the card's
            // last one and the wrap happens there.
            notes.focus()
            const tab = press('Tab')
            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        // What a Tab reaches, which is not everything the card's focus-stop
        // selector names. jsdom moves no focus of its own for a synthetic Tab,
        // so these pin the trap's own reckoning — which stops it counted, and
        // where it sent focus — and not the browser's answer to the key.
        // Whether focus stays in the card is a real browser's to answer.
        it('passes over the stops a closed disclosure is holding', () => {
            show(engine, {
                html: '<a href="https://a.test">One</a><details><summary>More</summary><a href="https://b.test">Inside</a></details>',
            })
            const summary = contentRoot().querySelector('summary')!

            // The summary is the last stop, the link the disclosure is holding
            // being no stop at all, so the wrap happens on the summary.
            summary.focus()
            const forward = press('Tab')
            expect(forward.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())

            // And the wrap back lands on the summary, never inside it.
            const backward = press('Tab', true)
            expect(backward.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(summary)
        })

        it("passes over the stops the author's own markup has taken out", () => {
            // A card carries its author's own styles, so anything in it can be
            // hidden and stay in the markup — and `-1` is the only negative
            // tabindex the selector can spell, so any other means the same.
            show(engine, {
                html: '<a href="https://a.test">One</a><a href="https://b.test" style="display: none">Gone</a><a href="https://c.test" style="visibility: hidden">Gone too</a><div tabindex="-2">Pointer only</div>',
            })
            const one = contentRoot().querySelector('a')!

            one.focus()
            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it('keeps focus on a card that has nothing to hand it to', () => {
            // A card of nothing but prose still holds the keyboard.
            show(engine, { title: 'Drawn rectangle', html: undefined })
            card().removeChild(closeButton())

            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(card())
        })

        it('gives focus back to whatever had it when the popup opened', async () => {
            const opener = document.createElement('button')
            document.body.appendChild(opener)
            opener.focus()

            const outcome = show(engine, { html: '<p>Crater A</p>' })
            // Focus lands on the card rather than a control inside it, so what
            // a screen reader reads first is the card's own name.
            expect(document.activeElement).toBe(card())
            closeButton().dispatchEvent(new MouseEvent('click'))
            await nextTick()

            expect(document.activeElement).toBe(opener)
            expect(outcome).toEqual(['dismiss'])
        })

        it('gives focus back across a run of popups replacing one another', () => {
            const opener = document.createElement('button')
            document.body.appendChild(opener)
            opener.focus()

            show(engine, { html: '<p>First</p>' })
            show(engine, { html: '<p>Second</p>' })
            MapPopup_.hide()

            expect(document.activeElement).toBe(opener)
        })

        it('leaves a user who moved focus themselves where they went', () => {
            // There is no click barrier over the rest of the app, so a pointer
            // is free to go anywhere while a popup is open.
            const opener = document.createElement('button')
            const elsewhere = document.createElement('button')
            document.body.append(opener, elsewhere)
            opener.focus()

            show(engine, { html: '<p>Crater A</p>' })
            elsewhere.focus()
            MapPopup_.hide()

            expect(document.activeElement).toBe(elsewhere)
        })
    })

    // jsdom loads no stylesheet and lays nothing out, so the mount point and
    // the CSS rules the card depends on to stay usable are pinned directly.
    describe('where the card is mounted', () => {
        /** A stand-in for whatever holds the map: a panel layer's neighbour. */
        const hostTheMap = (): HTMLElement => {
            const host = document.createElement('div')
            host.appendChild(engine.engine.getContainer())
            document.body.appendChild(host)
            return host
        }

        it('puts the card beside the map container rather than inside it', () => {
            const host = hostTheMap()
            show(engine)

            // Beside the map rather than inside it, so a press on the card
            // never reaches the container the engines listen on, and after it,
            // so the card sits last among the map's own siblings while the
            // positioned panel regions still paint over it.
            expect(card().parentElement).toBe(host)
            expect(engine.engine.getContainer().contains(card())).toBe(false)
            expect(host.lastElementChild).toBe(card())
        })

        it('keeps a press on the card out of the map click pipeline', async () => {
            hostTheMap()
            const outcome = show(engine, {
                primaryAction: { label: 'Analyze' },
            })
            const reachedTheMap: string[] = []
            engine.engine
                .getContainer()
                .addEventListener('click', () => reachedTheMap.push('map'))

            buttons()[0].dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            )
            await nextTick()

            // The engines listen on the container they were given, so a press
            // that never reaches it cannot read as a press on the map.
            expect(reachedTheMap).toEqual([])
            expect(outcome).toEqual(['primary'])
        })
    })

    describe('the rules the card cannot be laid out without', () => {
        // Comments go first: they name the very properties the assertions
        // below look for, so a rule would read as carrying one it discusses.
        const css = readFileSync(
            'src/essence/Basics/MapPopup_/MapPopup.css',
            'utf8'
        ).replace(/\/\*[\s\S]*?\*\//g, '')
        /**
         * The declarations of every rule whose selector list holds
         * `selector`, joined — every one of them, so a second rule that
         * undoes the first is read too. A selector no rule carries is an
         * assertion against nothing, so it throws rather than answering with
         * the empty string a renamed class would otherwise pass.
         */
        const declarations = (selector: string): string => {
            const rules = css
                .split('}')
                .filter((block) =>
                    block
                        .split('{')[0]
                        .split(',')
                        .some((one) => one.trim().endsWith(selector))
                )
                .map((block) => block.split('{')[1] ?? '')
            if (rules.length === 0)
                throw new Error(`No rule in MapPopup.css matches ${selector}`)
            return rules.join('\n')
        }

        it('clips the card, caps it at the viewport, and scrolls the overflow', () => {
            expect(declarations('.mmgis-map-popup')).toContain(
                'overflow: hidden'
            )
            expect(declarations('.mmgis-map-popup')).toContain(
                'max-height: calc(100vh'
            )
            expect(declarations('.mmgis-map-popup__content')).toContain(
                'overflow-y: auto'
            )
            // Paint containment lays a plugin's `position: fixed` content out
            // against the card and clips it there, rather than against the
            // viewport it would otherwise cover whole.
            expect(declarations('.mmgis-map-popup')).toContain('contain: paint')
        })

        it('is a positioned box with no stacking level of its own', () => {
            // Positioned, so the card paints over the map without asking for a
            // level. At `z-index: auto`, so anything the app means to paint
            // over the card has to be positioned and carry one itself.
            expect(declarations('.mmgis-map-popup')).toContain(
                'position: fixed'
            )
            expect(declarations('.mmgis-map-popup')).not.toContain('z-index')
        })
    })
})
