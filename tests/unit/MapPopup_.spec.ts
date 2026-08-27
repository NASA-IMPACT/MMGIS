import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import MapPopup_, {
    POPUP_SANITIZE_CONFIG,
} from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type {
    MapPopupRequest,
    MapPopupResult,
} from '../../src/essence/Basics/MapPopup_/types'

/**
 * Records anything the service broadcasts — it should never broadcast — and
 * lets a spec fire bus events back. Handlers are snapshotted before dispatch,
 * exactly as mitt does, so a listener unsubscribed mid-emit still receives
 * that emit.
 */
function makeBus() {
    const listeners = new Map<string, Set<(payload?: unknown) => void>>()
    const emitted: string[] = []
    const dispatch = (event: string) => {
        const handlers = listeners.get(event)
        if (handlers) Array.from(handlers).forEach((handler) => handler())
    }
    return {
        emitted,
        listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
        fire: dispatch,
        api: {
            emit: (event: string) => {
                emitted.push(event)
                dispatch(event)
            },
            on: (event: string, handler: (payload?: unknown) => void) => {
                if (!listeners.has(event)) listeners.set(event, new Set())
                listeners.get(event)!.add(handler)
                return () => listeners.get(event)!.delete(handler)
            },
        },
    }
}

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
    bus: ReturnType<typeof makeBus>,
    engine: ReturnType<typeof makeEngine>,
    overrides: Partial<MapPopupRequest> = {},
    owner?: string | null
): string[] {
    window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
    return track(
        MapPopup_.show(request(overrides), engine.engine as never, owner)
    )
}

const INVALID_REQUEST =
    'rejected: [MapPopup] Invalid request: latlng must hold finite lat/lng numbers, and title and html must be strings when given.'
const OUT_OF_RANGE =
    'rejected: [MapPopup] Invalid request: latlng must hold a lat within ±90 and a lng within ±180.'
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
    let bus: ReturnType<typeof makeBus>
    let engine: ReturnType<typeof makeEngine>

    beforeEach(() => {
        bus = makeBus()
        engine = makeEngine()
    })

    afterEach(() => {
        MapPopup_.hide()
        document.body.innerHTML = ''
        delete window.mmgisAPI
    })

    it('mounts a single popup and sanitizes the html', async () => {
        const outcome = show(bus, engine, {
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
        const outcome = show(bus, engine, {
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
        expect(bus.emitted).toEqual([])
    })

    it('resolves with the secondary action on its click', async () => {
        const outcome = show(bus, engine, {
            secondaryAction: { label: 'Cancel' },
            primaryAction: { label: 'Analyze' },
        })

        buttons()[1].dispatchEvent(new MouseEvent('click'))
        await nextTick()

        expect(outcome).toEqual(['secondary'])
        expect(popups()).toHaveLength(0)
        expect(bus.emitted).toEqual([])
    })

    it('styles a lone secondary action as the primary button', async () => {
        const outcome = show(bus, engine, {
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
        show(bus, engine, {
            primaryAction: {} as never,
            secondaryAction: { label: '' },
        })

        expect(buttons()).toHaveLength(0)
    })

    it('drops an action whose label is nothing but whitespace', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        // A button with spaces on it is as blank as one with nothing on it.
        show(bus, engine, { primaryAction: { label: '   ' } })

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
            show(bus, engine, { title: '<b>Drawn</b> rectangle' })

            // The body is sanitized markup; a title is neither sanitized nor
            // parsed, because it never goes near the html path.
            expect(title()!.textContent).toBe('<b>Drawn</b> rectangle')
            expect(title()!.querySelector('b')).toBeNull()
            expect(card().querySelector('b')).toBeNull()
        })

        it('keeps the title out of the box the body scrolls in', () => {
            show(bus, engine, {
                title: 'Drawn rectangle',
                html: `<p>${'Every measurement of it. '.repeat(200)}</p>`,
            })

            // The body overflows its own box, which is the only thing that
            // scrolls, so a heading outside it stays put as the body slides
            // underneath — the actions row keeps its place the same way.
            expect(content()!.contains(title())).toBe(false)
            expect(Array.from(card().children)).toEqual([
                document.querySelector('.mmgis-map-popup__close'),
                title(),
                content(),
            ])
        })

        it('renders a card that is a title and its actions', async () => {
            const outcome = show(bus, engine, {
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

        it('renders a title with no actions at all', () => {
            show(bus, engine, { title: 'Drawn rectangle', html: undefined })

            expect(title()!.textContent).toBe('Drawn rectangle')
            expect(buttons()).toHaveLength(0)
            expect(popups()).toHaveLength(1)
        })

        it('renders a card with a body and no title as it always has', () => {
            show(bus, engine, { html: '<p>Crater A</p>' })

            expect(title()).toBeNull()
            expect(body()).toContain('Crater A')
            expect(card().firstElementChild).toBe(
                document.querySelector('.mmgis-map-popup__close')
            )
        })

        it('reads a title of nothing but whitespace as no title', () => {
            // As blank a heading as an empty one: it would take a row of the
            // card and say nothing on it.
            show(bus, engine, { title: '   ', html: '<p>Crater A</p>' })

            expect(title()).toBeNull()
        })

        it('rejects a request with neither a title nor html to show', async () => {
            window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

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

        it('rejects a title that is not a string', async () => {
            window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

            const outcome = track(
                MapPopup_.show(
                    request({ title: 42 as unknown as string }),
                    engine.engine as never
                )
            )
            await nextTick()

            expect(outcome).toEqual([INVALID_REQUEST])
            expect(popups()).toHaveLength(0)
        })
    })

    // A dialog with a generic name tells a screen reader user nothing about
    // which popup they have landed in.
    describe('what the card is called', () => {
        it('takes its name from the title when there is one', () => {
            show(bus, engine, { title: 'Drawn rectangle' })

            expect(card().getAttribute('aria-labelledby')).toBe(title()!.id)
            expect(title()!.id).not.toBe('')
            // The heading is the name, so the generic one would only compete
            // with it.
            expect(card().getAttribute('aria-label')).toBeNull()
            expect(card().getAttribute('role')).toBe('dialog')
        })

        it('falls back to the generic name when there is no title', () => {
            show(bus, engine, { html: '<p>Crater A</p>' })

            expect(card().getAttribute('aria-label')).toBe('Map popup')
            expect(card().getAttribute('aria-labelledby')).toBeNull()
            expect(card().getAttribute('role')).toBe('dialog')
        })

        it('never names a card after the heading of the one before it', () => {
            show(bus, engine, { title: 'First' })
            const first = title()!.id
            show(bus, engine, { title: 'Second' })

            expect(title()!.id).not.toBe(first)
            expect(card().getAttribute('aria-labelledby')).toBe(title()!.id)
        })
    })

    it('resolves dismiss and closes when the X is pressed', async () => {
        const outcome = show(bus, engine)

        document
            .querySelector('.mmgis-map-popup__close')!
            .dispatchEvent(new MouseEvent('click'))
        await nextTick()

        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
        expect(bus.emitted).toEqual([])
    })

    it('dismisses on a map click once the opening gesture has passed', async () => {
        const outcome = show(bus, engine)
        await nextTick()

        engine.fire('click')
        expect(popups()).toHaveLength(1)

        await nextTick()
        expect(outcome).toEqual(['dismiss'])
        expect(popups()).toHaveLength(0)
        expect(bus.emitted).toEqual([])
    })

    it('ignores the map click that deck.gl emits after the feature click that opened the popup', async () => {
        // deck.gl calls its feature-click handler and then emits the click, so
        // a popup opened from a feature click would otherwise be dismissed by
        // the very click that opened it.
        const outcome = show(bus, engine)
        engine.fire('click')

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(outcome).toEqual([])
    })

    it('keeps a popup opened later in the same gesture as the dismissing click', async () => {
        // Leaflet emits its click before its feature click, so a plugin's
        // replacement popup is shown after the dismissal was scheduled.
        const first = show(bus, engine, { html: '<p>First</p>' })
        await nextTick()

        engine.fire('click')
        const second = show(bus, engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(cardText()).toContain('Second')
        // The replacement closed the first popup, so the pending dismissal
        // finds it already gone.
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
    })

    it('never lets a replaced popup dismiss its replacement', async () => {
        // A plugin that opens popups from map:click is subscribed before the
        // open popup is, so its replacement is mounted while the engine is
        // still dispatching the click to the replaced popup's own listener.
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
        // The bus event the plugin listens for is the engine's click, re-emitted
        // by Map_ from a subscription taken when the map was built.
        engine.engine.on('click', () => bus.api.emit('map:click'))
        let second: string[] = []
        bus.api.on('map:click', () => {
            second = track(
                MapPopup_.show(
                    request({ html: '<p>Second</p>' }),
                    engine.engine as never
                )
            )
        })
        const first = show(bus, engine, { html: '<p>First</p>' })
        await nextTick()

        engine.fire('click')

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(cardText()).toContain('Second')
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
    })

    it('replaces the current popup and resolves the replaced request with closed', async () => {
        const first = show(bus, engine, { html: '<p>First</p>' })
        const second = show(bus, engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(cardText()).toContain('Second')
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
        expect(bus.emitted).toEqual([])
    })

    it('retracts the popup for map:hidePopup, resolving its request with closed', async () => {
        const outcome = show(bus, engine)

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

    it('settles a request once however often its popup is closed', async () => {
        const outcome = show(bus, engine)
        await nextTick()

        // The user clicks away, and the map is torn down shortly after.
        engine.fire('click')
        await nextTick()
        MapPopup_.hide()
        await nextTick()

        expect(outcome).toEqual(['dismiss'])
    })

    it('is a no-op when hiding with no popup open', () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

        MapPopup_.hide({ action: 'dismiss' })

        expect(bus.emitted).toEqual([])
        expect(popups()).toHaveLength(0)
    })

    it('repositions the card on every engine move', () => {
        show(bus, engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')

        engine.setPoint({ x: 10, y: 220 })
        engine.fire('move')

        expect(card().style.transform).toBe('translate(10px, 158px)')
    })

    it('flips below the anchor when the card would clip the viewport top', () => {
        engine = makeEngine({ point: { x: 300, y: 50 }, containerTop: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // 50 - 100 - 12 clips the top, so the card sits 12px below the anchor.
        expect(card().style.transform).toBe('translate(300px, 62px)')
    })

    it('keeps a card flipped below a low anchor inside the viewport', () => {
        engine = makeEngine({ point: { x: 300, y: 200 }, containerTop: 0 })
        show(bus, engine)
        // Taller than the room above its anchor, so it flips below it.
        sizeCard(200, 650)

        engine.fire('move')

        // Left where the flip put it, at 212, the card would end 862px down a
        // 768px viewport with its actions row past the fold — and nothing
        // scrolls to them — so it stops at the 8px margin instead.
        expect(card().style.transform).toBe('translate(300px, 110px)')
    })

    it('clamps the card to the viewport when its anchor sits near an edge', () => {
        engine = makeEngine({ point: { x: 5, y: 200 }, containerLeft: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // Centering on x=5 would push the card off screen, so it stops at the
        // 8px margin.
        expect(card().style.transform).toBe('translate(8px, 138px)')
    })

    it('repositions the card when the window resizes', () => {
        // A resized window moves the map's own container, so the projected
        // anchor lands somewhere new without the engine emitting anything.
        show(bus, engine)
        sizeCard(200, 100)
        engine.setPoint({ x: 10, y: 220 })

        window.dispatchEvent(new Event('resize'))

        expect(card().style.transform).toBe('translate(10px, 158px)')
    })

    it('repositions the card when the card itself resizes', () => {
        // Content that lands late — an image, a lazy fetch — grows the card
        // downwards from a top-left transform, so the card watches its own box
        // rather than waiting for a map event that may never come.
        show(bus, engine)
        sizeCard(200, 100)
        const observer = observerFor(card())
        expect(observer).toBeDefined()

        sizeCard(200, 200)
        observer!.callback()

        expect(card().style.transform).toBe('translate(300px, 38px)')
    })

    it('stops watching the card when the popup is hidden', () => {
        show(bus, engine)
        const watched = card()
        expect(observerFor(watched)).toBeDefined()

        MapPopup_.hide()

        expect(observerFor(watched)).toBeUndefined()
    })

    it('keeps the card on screen once its anchor has left the map', () => {
        // The card is drawn clear of its anchor, so an anchor just off the
        // map's left edge still has most of its card over the map.
        engine = makeEngine({ point: { x: -20, y: 200 }, containerLeft: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // No longer held to the 8px viewport margin, the card rides off with
        // the anchor: centred on -20, its left edge lands past the window.
        expect(card().style.transform).toBe('translate(-120px, 138px)')
    })

    it('parks the card once it no longer overlaps the map, and brings it back', () => {
        engine = makeEngine({ point: { x: -20, y: 200 }, containerLeft: 0 })
        show(bus, engine)
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

    it('keeps the card while its anchor sits just below the map', () => {
        engine = makeEngine({ point: { x: 300, y: 610 }, containerTop: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // Anchored 10px under a 600px tall map, the card still lies over it.
        expect(card().style.transform).toBe('translate(300px, 498px)')

        engine.setPoint({ x: 300, y: 720 })
        engine.fire('move')

        expect(card().style.transform).toBe(PARKED)
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
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        expect(card().style.transform).toBe(PARKED)
    })

    it('clamps a card whose anchor sits exactly on the map edge', () => {
        engine = makeEngine({ point: { x: 0, y: 200 }, containerLeft: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // The anchor is still on the map, so the card is kept whole and on
        // screen, at the 8px margin, exactly as one further in would be.
        expect(card().style.transform).toBe('translate(8px, 138px)')
    })

    it('stays parked until the anchor can be projected', () => {
        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the engine has no view yet')
        }
        show(bus, engine)
        expect(card().style.transform).toBe(PARKED)

        engine.engine.latLngToContainerPoint = () => ({ x: 300, y: 200 })
        sizeCard(200, 100)
        engine.fire('move')

        expect(card().style.transform).toBe('translate(300px, 138px)')
    })

    it('parks a card whose anchor stops being projectable', () => {
        // The map is torn down while the popup is open, so the projection
        // that placed the card a moment ago now throws.
        show(bus, engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.transform).toBe('translate(300px, 138px)')

        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the container is gone')
        }
        engine.fire('move')

        expect(card().style.transform).toBe(PARKED)
        expect(card().style.visibility).toBe('')
    })

    it('parks the card while the engine animates a zoom and places it again after', () => {
        // Leaflet emits no move while its zoom animation runs, so the card
        // would otherwise hang at the pre-zoom position and jump at the end.
        show(bus, engine)
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
        show(bus, engine)
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
        const outcome = show(bus, engine)
        await nextTick()
        expect(engine.listenerCount('move')).toBe(1)
        expect(engine.listenerCount('zoomstart')).toBe(1)
        expect(engine.listenerCount('zoomend')).toBe(1)
        expect(engine.listenerCount('click')).toBe(1)

        MapPopup_.hide()
        await nextTick()

        expect(engine.listenerCount('move')).toBe(0)
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
        const outcome = show(bus, engine)
        MapPopup_.hide()

        await nextTick()

        expect(engine.listenerCount('click')).toBe(0)
        expect(outcome).toEqual(['closed'])
    })

    it('rejects and leaves nothing mounted when wiring the popup fails', async () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
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
        const outcome = show(bus, engine)

        MapPopup_.hide()
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(engine.listenerCount('click')).toBe(0)
        expect(outcome).toEqual(['closed'])
    })

    it('rejects a request without a valid latlng or html', async () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

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
        await nextTick()

        expect(noAnchor).toEqual([INVALID_REQUEST])
        expect(badHtml).toEqual([INVALID_REQUEST])
        expect(popups()).toHaveLength(0)
    })

    it('rejects an anchor outside the geographic range', async () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

        const offGlobe = track(
            MapPopup_.show(
                request({ latlng: { lat: 200, lng: 0 } }),
                engine.engine as never
            )
        )
        const offMeridian = track(
            MapPopup_.show(
                request({ latlng: { lat: 0, lng: -181 } }),
                engine.engine as never
            )
        )
        await nextTick()

        // Both are finite, so nothing downstream complains: the projection
        // clamps them and opens the popup somewhere the caller never asked for.
        expect(offGlobe).toEqual([OUT_OF_RANGE])
        expect(offMeridian).toEqual([OUT_OF_RANGE])
        expect(popups()).toHaveLength(0)
    })

    it('leaves an open popup alone when a later request is invalid', async () => {
        const outcome = show(bus, engine, { html: '<p>Crater A</p>' })

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
        it("closes the caller's own popup and says so", async () => {
            const outcome = show(bus, engine, {}, 'aoi')

            expect(MapPopup_.hideForCaller('aoi')).toBe(true)
            await nextTick()

            expect(popups()).toHaveLength(0)
            // Evicted, but still answered — the opener learns it is gone.
            expect(outcome).toEqual(['closed'])
        })

        it("leaves another plugin's popup alone", async () => {
            const outcome = show(bus, engine, {}, 'aoi')

            expect(MapPopup_.hideForCaller('draw')).toBe(false)
            await nextTick()

            expect(popups()).toHaveLength(1)
            expect(outcome).toEqual([])
        })

        // A caller with no handle — the console, an embedding page — is not a
        // skeleton key. "No caller" is a value of its own on both sides.
        it("does not let an anonymous hide reach a plugin's popup", async () => {
            const outcome = show(bus, engine, {}, 'aoi')

            expect(MapPopup_.hideForCaller()).toBe(false)
            await nextTick()

            expect(popups()).toHaveLength(1)
            expect(outcome).toEqual([])
        })

        it('does not let a plugin hide an anonymous popup', async () => {
            const outcome = show(bus, engine)

            expect(MapPopup_.hideForCaller('aoi')).toBe(false)
            await nextTick()

            expect(popups()).toHaveLength(1)
            expect(outcome).toEqual([])
        })

        it('lets an anonymous hide close an anonymous popup', async () => {
            const outcome = show(bus, engine)

            expect(MapPopup_.hideForCaller()).toBe(true)
            await nextTick()

            expect(popups()).toHaveLength(0)
            expect(outcome).toEqual(['closed'])
        })

        it('reports that nothing was retracted when no popup is open', () => {
            expect(MapPopup_.hideForCaller('aoi')).toBe(false)
            expect(MapPopup_.hideForCaller()).toBe(false)
        })

        // Showing is not retracting: the slot holds one popup, so a new
        // request takes it whoever the last one belonged to. Ownership decides
        // who may retract, never who may open.
        it("lets a plugin's popup replace another plugin's", async () => {
            const first = show(bus, engine, { html: '<p>AOI</p>' }, 'aoi')
            const second = show(bus, engine, { html: '<p>Draw</p>' }, 'draw')
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
            show(bus, engine, { html: '<p>Crater A</p>' })

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
            show(bus, engine, {
                html: '<style>@keyframes pulse { to { opacity: 0.5 } } .dot:hover { color: red }</style><p class="dot">Crater A</p>',
            })

            expect(body()).toContain('@keyframes pulse')
            expect(body()).toContain('.dot:hover')
        })

        it('keeps a stylesheet nested inside svg, where it reaches nothing', () => {
            // `style` is on the allow-list, and the allow-list is the whole of
            // the decision: DOMPurify keeps the element wherever it is
            // written, nested in an `<svg>` as readily as at the top of the
            // card, and drops it from both at once when the allow-list stops
            // naming it. The shadow root is what makes it safe to keep.
            show(bus, engine, {
                html: '<svg><style>.mmgis-map-popup { contain: none }</style></svg>',
            })

            expect(body()).toContain('<style>')
            expect(document.querySelector('.mmgis-map-popup style')).toBeNull()
        })

        it('refuses form controls and takes their labels with them', () => {
            show(bus, engine, {
                html: '<p>Pick one</p><button>Press me</button><select><option>Only</option></select><input value="x"><textarea>Type</textarea>',
            })

            expect(body()).toContain('Pick one')
            expect(body()).not.toContain('Press me')
            expect(body()).not.toContain('Only')
            expect(body()).not.toContain('Type')
            expect(body()).not.toContain('<button')
            expect(body()).not.toContain('<input')
        })

        it('keeps the prose of an author who wrapped their card in a form', () => {
            // The tags whose contents go with them are leaves. Name a
            // container and DOMPurify takes the container's children too, so
            // this card would come back blank with nothing to explain it.
            show(bus, engine, {
                html: '<form><p>Crater A</p></form>',
            })

            expect(body()).toContain('Crater A')
            expect(body()).not.toContain('<form')
        })

        it('never spills the text of a tag whose contents are not markup', () => {
            // DOMPurify keeps its own list of those tags, and a config that
            // named its additions outright would replace that list rather than
            // extend it, leaving the raw text of an `xmp` to read as prose.
            show(bus, engine, {
                html: '<p>Crater A</p><xmp>rm -rf /</xmp>',
            })

            expect(body()).toContain('Crater A')
            expect(body()).not.toContain('rm -rf')
        })

        it('refuses what would reach past the card', () => {
            show(bus, engine, {
                html: '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x"><canvas width="10"></canvas><p popover>Crater A</p>',
            })

            expect(body()).not.toContain('iframe')
            expect(body()).not.toContain('object')
            expect(body()).not.toContain('embed')
            // A canvas paints only from script, and the contract has no script
            // to offer, so it would only ever come back blank.
            expect(body()).not.toContain('canvas')
            // The top layer is out of reach of the card's clipping.
            expect(body()).not.toContain('popover')
            expect(body()).toContain('Crater A')
        })

        it('refuses script, handlers, and urls that run something', () => {
            show(bus, engine, {
                html: '<p onclick="alert(1)">Crater A</p><script>alert(2)</script><a href="javascript:alert(3)">go</a><img src=x onerror="alert(4)">',
            })

            expect(body()).not.toContain('onclick')
            expect(body()).not.toContain('alert')
            expect(body()).not.toContain('javascript:')
        })

        it('keeps static svg whole, filter primitives included', () => {
            show(bus, engine, {
                html: '<svg viewBox="0 0 10 10"><title>Rose</title><desc>A compass rose</desc><defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient><filter id="f"><feFlood flood-color="#fff" flood-opacity="0.5"/><feDropShadow dx="1" dy="1"/><feGaussianBlur stdDeviation="2"/></filter><clipPath id="c"><rect width="4" height="4"/></clipPath></defs><g clip-path="url(#c)"><path d="M0 0 L10 10" vector-effect="non-scaling-stroke" pointer-events="none"/><text dominant-baseline="middle">N</text></g></svg>',
            })

            const markup = body()
            // `flood-color` is the one a hand-written list drops, and four of
            // the filter primitives render nothing without it.
            expect(markup).toContain('flood-color="#fff"')
            expect(markup).toContain('vector-effect="non-scaling-stroke"')
            expect(markup).toContain('dominant-baseline="middle"')
            expect(markup).toContain('pointer-events="none"')
            expect(markup).toContain('<title>Rose</title>')
            expect(markup).toContain('A compass rose')
            expect(markup).toContain('stdDeviation="2"')
            expect(markup).toContain('viewBox="0 0 10 10"')
        })

        it('refuses the svg elements that only animate, and the pair that needs one another', () => {
            show(bus, engine, {
                html: '<svg><rect><animate attributeName="x" dur="1s" to="10"/><set attributeName="y" to="4"/></rect><symbol id="s"><circle r="2"/></symbol><use href="https://evil.test/x.svg#a"/></svg>',
            })

            const markup = body()
            expect(markup).not.toContain('animate')
            expect(markup).not.toContain('attributeName')
            expect(markup).not.toContain('<set')
            // A symbol paints nothing without a use to place it, so neither
            // one is worth the reach the other would need.
            expect(markup).not.toContain('symbol')
            expect(markup).not.toContain('<use')
        })

        it('keeps the attributes whose absence would garble the content', () => {
            show(bus, engine, {
                html: '<img src="a.png" alt="Crater A from orbit"><video controls poster="p.jpg"><track kind="captions" srclang="en" label="English" src="c.vtt"></video><blockquote cite="https://example.test"><p>Quoted</p></blockquote><time datetime="2026-01-01">New Year</time><table><tr><td colspan="2" rowspan="3">Cell</td></tr></table>',
            })

            const markup = body()
            expect(markup).toContain('alt="Crater A from orbit"')
            expect(markup).toContain('kind="captions"')
            expect(markup).toContain('srclang="en"')
            expect(markup).toContain('label="English"')
            expect(markup).toContain('cite="https://example.test"')
            expect(markup).toContain('datetime="2026-01-01"')
            expect(markup).toContain('colspan="2"')
            expect(markup).toContain('rowspan="3"')
        })

        it('keeps the only disclosure widget that needs no script', () => {
            show(bus, engine, {
                html: '<details open><summary>Measurements</summary><p>41.4 m</p></details>',
            })

            expect(body()).toContain('<details open="">')
            expect(body()).toContain('<summary>Measurements</summary>')
        })

        it('keeps inert markup that would otherwise run its own text together', () => {
            show(bus, engine, {
                html: '<p>A<sub>1</sub><wbr>B <del>old</del><ins>new</ins> <bdi>עברית</bdi><hr><ruby>漢<rt>kan</rt></ruby><progress value="3" max="10"></progress><meter value="4" min="0" max="10"></meter></p><math><mfrac><mi>a</mi><mn>2</mn></mfrac></math>',
            })

            const markup = body()
            expect(markup).toContain('<wbr>')
            expect(markup).toContain('<del>old</del>')
            expect(markup).toContain('<ins>new</ins>')
            expect(markup).toContain('<bdi>')
            expect(markup).toContain('<hr>')
            expect(markup).toContain('<rt>kan</rt>')
            expect(markup).toContain('<progress value="3" max="10">')
            expect(markup).toContain('<meter')
            expect(markup).toContain('<mfrac>')
        })

        it('keeps the hooks an author styles and scripts nothing with', () => {
            show(bus, engine, {
                html: '<p id="a" class="b" data-feature="crater-a" role="note" aria-label="Crater A" style="color: red">Crater A</p>',
            })

            const markup = body()
            expect(markup).toContain('id="a"')
            expect(markup).toContain('class="b"')
            expect(markup).toContain('data-feature="crater-a"')
            expect(markup).toContain('role="note"')
            expect(markup).toContain('aria-label="Crater A"')
            expect(markup).toContain('style="color: red"')
        })

        it('holds its svg attributes to the ones DOMPurify curates', () => {
            // Written out by hand, this list loses `flood-color` and four
            // filter primitives quietly stop rendering. Derived from the
            // installed library instead, and pinned here so an upgrade that
            // moves the set fails loudly rather than silently.
            const attrs = readFileSync(
                'node_modules/dompurify/src/attrs.ts',
                'utf8'
            )
            const curated = (name: string): string[] =>
                attrs
                    .match(
                        new RegExp(
                            `export const ${name} = freeze\\(\\[([\\s\\S]*?)\\]`
                        )
                    )![1]
                    .split(',')
                    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
                    .filter(Boolean)
            // The SMIL timing attributes go: none of the elements that read
            // them is a tag a card may hold.
            const smil = [
                'accumulate',
                'additive',
                'attributename',
                'attributetype',
                'begin',
                'by',
                'dur',
                'end',
                'keypoints',
                'keysplines',
                'keytimes',
                'max',
                'min',
                'origin',
                'repeatcount',
                'repeatdur',
                'restart',
            ]
            const expected = curated('svg')
                .filter((attr) => !smil.includes(attr))
                .concat('dominant-baseline', 'pointer-events', 'vector-effect')

            const allowed = new Set(POPUP_SANITIZE_CONFIG.ALLOWED_ATTR)
            expect(expected.filter((attr) => !allowed.has(attr))).toEqual([])
            expect(curated('mathMl').filter((attr) => !allowed.has(attr))).toEqual([])
            expect(curated('xml').filter((attr) => !allowed.has(attr))).toEqual([])
            // The subtraction is real: an attribute only SMIL reads is gone,
            // save the two `<meter>` and `<progress>` need for themselves.
            expect(allowed.has('attributename')).toBe(false)
            expect(allowed.has('repeatcount')).toBe(false)
            expect(allowed.has('keytimes')).toBe(false)
        })
    })

    // A link inside a card navigates the whole app away by default, taking the
    // map, the session, and every other plugin with it.
    describe('where a link in a card goes', () => {
        const link = () => contentRoot().querySelector('a')!

        it('sends a link that goes anywhere to a tab of its own', () => {
            show(bus, engine, {
                html: '<a href="https://example.test/crater">Crater A</a>',
            })

            expect(link().getAttribute('target')).toBe('_blank')
            expect(link().getAttribute('rel')).toBe('noopener noreferrer')
        })

        it('overrides a target the author asked for', () => {
            // Stripping the target would make this worse, not better: the link
            // would then navigate in place.
            show(bus, engine, {
                html: '<a href="https://example.test" target="_self">Crater A</a>',
            })

            expect(link().getAttribute('target')).toBe('_blank')
        })

        it('leaves a jump within the content alone', () => {
            // A bare fragment resolves inside the shadow root, so it reaches
            // neither the app's ids nor anywhere off the page.
            show(bus, engine, {
                html: '<a href="#details">More</a><p id="details">41.4 m</p>',
            })

            expect(link().getAttribute('target')).toBeNull()
            expect(link().getAttribute('rel')).toBeNull()
        })

        it('sends a link with nothing in its href out too', () => {
            // An empty `href` resolves to the document the app is running in,
            // so following one reloads the app the card opened over.
            show(bus, engine, { html: '<a href="">Reload</a>' })

            expect(link().getAttribute('target')).toBe('_blank')
            expect(link().getAttribute('rel')).toBe('noopener noreferrer')
        })

        it('sends an svg link out the same way', () => {
            show(bus, engine, {
                html: '<svg><a xlink:href="https://example.test"><rect width="4" height="4"/></a></svg>',
            })

            expect(link().getAttribute('target')).toBe('_blank')
            expect(link().getAttribute('rel')).toBe('noopener noreferrer')
        })

        it('refuses at the click anything that would still navigate in place', () => {
            const open = vi
                .spyOn(window, 'open')
                .mockImplementation(() => null)
            show(bus, engine, { html: '<a href="https://example.test">go</a>' })
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

        it('refuses at the click a link with nothing in its href', () => {
            const open = vi
                .spyOn(window, 'open')
                .mockImplementation(() => null)
            show(bus, engine, { html: '<a href="">Reload</a>' })
            link().removeAttribute('target')

            const click = new MouseEvent('click', {
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            link().dispatchEvent(click)

            expect(click.defaultPrevented).toBe(true)
            open.mockRestore()
        })

        it('lets a jump within the content through', () => {
            const open = vi
                .spyOn(window, 'open')
                .mockImplementation(() => null)
            show(bus, engine, { html: '<a href="#details">More</a>' })

            const click = new MouseEvent('click', {
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            link().dispatchEvent(click)

            expect(click.defaultPrevented).toBe(false)
            expect(open).not.toHaveBeenCalled()
            open.mockRestore()
        })

        it('refuses a submit outright', () => {
            // The sanitizer leaves no form standing, so nothing should ever
            // raise one. This is what happens if something does.
            show(bus, engine, { html: '<p>Crater A</p>' })

            const submit = new Event('submit', {
                bubbles: true,
                composed: true,
                cancelable: true,
            })
            contentRoot().querySelector('p')!.dispatchEvent(submit)

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
            show(bus, engine, { title: 'Drawn rectangle' })

            expect(card().getAttribute('role')).toBe('dialog')
            // No `aria-modal`, which would say the app behind the card is
            // unavailable. Nothing out there is inert and no barrier covers
            // it, so a pointer reaches all of it.
            expect(card().getAttribute('aria-modal')).toBeNull()
            // Focusable, but never a Tab stop of its own.
            expect(card().tabIndex).toBe(-1)
        })

        it('moves focus onto the card, which announces it by name', () => {
            const opener = document.createElement('button')
            document.body.appendChild(opener)
            opener.focus()

            show(bus, engine, { title: 'Drawn rectangle' })

            // The card rather than a control inside it, so what is read first
            // is the card's own name and not "Close, button".
            expect(document.activeElement).toBe(card())
        })

        it('closes on Escape and answers as a dismissal', async () => {
            const outcome = show(bus, engine, { html: '<p>Crater A</p>' })
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

        it('wraps a Tab from the last stop back to the first', () => {
            show(bus, engine, {
                html: '<a href="https://example.test">Crater A</a>',
                primaryAction: { label: 'Analyze' },
            })
            ;(buttons()[0] as HTMLElement).focus()

            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it('wraps a Shift+Tab from the first stop round to the last', () => {
            show(bus, engine, {
                html: '<a href="https://example.test">Crater A</a>',
                primaryAction: { label: 'Analyze' },
            })
            closeButton().focus()

            const tab = press('Tab', true)

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(buttons()[0])
        })

        it('wraps a Shift+Tab off the card itself round to the last stop', () => {
            // Where focus starts, so this is the first Shift+Tab of every
            // popup a keyboard user opens.
            show(bus, engine, {
                html: '<p>Crater A</p>',
                primaryAction: { label: 'Analyze' },
            })

            const tab = press('Tab', true)

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(buttons()[0])
        })

        it('counts the plugin own controls among the stops, in their place', () => {
            // Sequential focus navigation moves through a shadow tree as
            // though its contents sat where the host does, so a trap that read
            // the card's light DOM alone would put its last stop ahead of the
            // plugin's links and let a Tab out of the dialog from there.
            show(bus, engine, {
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

        // What a Tab reaches, which is not everything the card's focus-stop
        // selector names. jsdom moves no focus of its own for a synthetic Tab,
        // so these pin the trap's own reckoning — which stops it counted, and
        // where it sent focus — and not the browser's answer to the key.
        // Whether focus stays in the card is a real browser's to answer.
        it('passes over a stop a closed disclosure is holding', () => {
            show(bus, engine, {
                html: '<a href="https://a.test">One</a><details><summary>More</summary><a href="https://b.test">Inside</a></details>',
            })
            const summary = contentRoot().querySelector('summary')!

            summary.focus()
            const tab = press('Tab')

            // The summary is the last stop, the link the disclosure is holding
            // being no stop at all, so the wrap happens on the summary.
            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it('wraps back onto a stop rather than into a closed disclosure', () => {
            show(bus, engine, {
                html: '<a href="https://a.test">One</a><details><summary>More</summary><a href="https://b.test">Inside</a></details>',
            })
            const summary = contentRoot().querySelector('summary')!

            closeButton().focus()
            const tab = press('Tab', true)

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(summary)
        })

        it("passes over a stop the author's styles have taken off the page", () => {
            // A card carries its author's own styles, so anything in it can be
            // hidden and stay in the markup.
            show(bus, engine, {
                html: '<a href="https://a.test">One</a><a href="https://b.test" style="display: none">Gone</a>',
            })
            const one = contentRoot().querySelector('a')!

            one.focus()
            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it("passes over a stop the author's styles have made invisible", () => {
            show(bus, engine, {
                html: '<a href="https://a.test">One</a><a href="https://b.test" style="visibility: hidden">Gone</a>',
            })
            const one = contentRoot().querySelector('a')!

            one.focus()
            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it('passes over a stop a negative tabindex has taken out', () => {
            // `-1` is the only value the selector can spell; every other
            // negative one means the same thing.
            show(bus, engine, {
                html: '<a href="https://a.test">One</a><div tabindex="-2">Reachable by pointer only</div>',
            })
            const one = contentRoot().querySelector('a')!

            one.focus()
            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(closeButton())
        })

        it('keeps focus on a card that has nothing to hand it to', () => {
            // A card of nothing but prose still holds the keyboard.
            show(bus, engine, { title: 'Drawn rectangle', html: undefined })
            card().removeChild(closeButton())

            const tab = press('Tab')

            expect(tab.defaultPrevented).toBe(true)
            expect(deepActive()).toBe(card())
        })

        it('gives focus back to whatever had it when the popup opened', async () => {
            const opener = document.createElement('button')
            document.body.appendChild(opener)
            opener.focus()

            const outcome = show(bus, engine, { html: '<p>Crater A</p>' })
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

            show(bus, engine, { html: '<p>First</p>' })
            show(bus, engine, { html: '<p>Second</p>' })
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

            show(bus, engine, { html: '<p>Crater A</p>' })
            elsewhere.focus()
            MapPopup_.hide()

            expect(document.activeElement).toBe(elsewhere)
        })

        it('does not reach for an opener that has since left the document', () => {
            const opener = document.createElement('button')
            document.body.appendChild(opener)
            opener.focus()

            show(bus, engine, { html: '<p>Crater A</p>' })
            opener.remove()
            MapPopup_.hide()

            expect(popups()).toHaveLength(0)
        })
    })

    // jsdom loads no stylesheet and lays nothing out, so the rules the card
    // depends on to stay usable are pinned by reading them. Each guards
    // something the DOM cannot be asked about here: the card is placed by a
    // transform, which makes it the containing block for absolutely positioned
    // content, and MMGIS resets the user agent's focus ring globally.
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
            show(bus, engine)

            // Beside the map and after it, which is what paints the card over
            // the map without claiming a stacking level the app's panels
            // would then have to beat.
            expect(card().parentElement).toBe(host)
            expect(engine.engine.getContainer().contains(card())).toBe(false)
            expect(host.lastElementChild).toBe(card())
        })

        it('keeps a press on the card out of the map click pipeline', async () => {
            hostTheMap()
            const outcome = show(bus, engine, {
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

        it('falls back to the body for a map container with no parent', () => {
            show(bus, engine)

            expect(card().parentElement).toBe(document.body)
        })
    })

    describe('the rules the card cannot be laid out without', () => {
        const css = readFileSync(
            'src/essence/Basics/MapPopup_/MapPopup.css',
            'utf8'
        )
        /** The declarations of the rule whose selector list holds `selector`. */
        const declarations = (selector: string): string => {
            const rule = css
                .split('}')
                .find((block) =>
                    block
                        .split('{')[0]
                        .split(',')
                        .some((one) => one.trim().endsWith(selector))
                )
            return rule?.split('{')[1] ?? ''
        }

        it('clips content that would otherwise paint outside the card', () => {
            expect(declarations('.mmgis-map-popup')).toContain(
                'overflow: hidden'
            )
        })

        it('caps the card at the viewport and scrolls the overflow', () => {
            expect(declarations('.mmgis-map-popup')).toContain(
                'max-height: calc(100vh'
            )
            expect(declarations('.mmgis-map-popup__content')).toContain(
                'overflow-y: auto'
            )
        })

        it('keeps a heading clear of the close control it shares a row with', () => {
            expect(declarations('.mmgis-map-popup__title')).toContain(
                'padding-right: var(--theme-spacing-3'
            )
            // The body under a heading is clear of the control already, so it
            // hands that room back.
            expect(
                declarations(
                    '.mmgis-map-popup__title + .mmgis-map-popup__content'
                )
            ).toContain('padding-right: 0')
        })

        it('scrolls the body without taking the heading with it', () => {
            expect(declarations('.mmgis-map-popup__title')).not.toContain(
                'overflow-y'
            )
        })

        it('holds content that positions itself out of the flow', () => {
            // Paint containment lays a plugin's `position: fixed` content out
            // against the card and clips it there, rather than against the
            // viewport it would otherwise cover whole.
            expect(declarations('.mmgis-map-popup')).toContain('contain: paint')
        })

        it('claims a stacking context but no level of its own', () => {
            // Containment makes the card a stacking context, but at
            // `z-index: auto` it still paints where tree order puts it, so the
            // panels the app lays over the map paint over the card too.
            expect(declarations('.mmgis-map-popup')).not.toContain('z-index')
        })

        it('gives the close control the focus ring the buttons have', () => {
            expect(
                declarations('.mmgis-map-popup__close:focus-visible')
            ).toContain('outline: 3px solid')
        })
    })
})
