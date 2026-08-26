import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
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
const buttons = () => document.querySelectorAll('.mmgis-map-popup__button')
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
        expect(content()!.innerHTML).toContain('Crater A')
        expect(content()!.innerHTML).not.toContain('script')

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
            expect(content()!.innerHTML).toContain('Crater A')
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

    // The card is a group, and a group with a generic name tells a screen
    // reader user nothing about which popup they have landed in.
    describe('what the card is called', () => {
        it('takes its name from the title when there is one', () => {
            show(bus, engine, { title: 'Drawn rectangle' })

            expect(card().getAttribute('aria-labelledby')).toBe(title()!.id)
            expect(title()!.id).not.toBe('')
            // The heading is the name, so the generic one would only compete
            // with it.
            expect(card().getAttribute('aria-label')).toBeNull()
            expect(card().getAttribute('role')).toBe('group')
        })

        it('falls back to the generic name when there is no title', () => {
            show(bus, engine, { html: '<p>Crater A</p>' })

            expect(card().getAttribute('aria-label')).toBe('Map popup')
            expect(card().getAttribute('aria-labelledby')).toBeNull()
            expect(card().getAttribute('role')).toBe('group')
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
        expect(card().textContent).toContain('Second')
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
        expect(card().textContent).toContain('Second')
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
    })

    it('replaces the current popup and resolves the replaced request with closed', async () => {
        const first = show(bus, engine, { html: '<p>First</p>' })
        const second = show(bus, engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(card().textContent).toContain('Second')
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
        expect(card().style.visibility).toBe('visible')
    })

    it('hides the card once it no longer overlaps the map, and brings it back', () => {
        engine = makeEngine({ point: { x: -20, y: 200 }, containerLeft: 0 })
        show(bus, engine)
        sizeCard(200, 100)
        engine.fire('move')
        expect(card().style.visibility).toBe('visible')

        // Far enough left that the card's right edge clears the map's left.
        engine.setPoint({ x: -140, y: 200 })
        engine.fire('move')
        expect(card().style.visibility).toBe('hidden')

        engine.setPoint({ x: 300, y: 200 })
        engine.fire('move')
        expect(card().style.visibility).toBe('visible')
        expect(card().style.transform).toBe('translate(200px, 138px)')
    })

    it('keeps the card while its anchor sits just below the map', () => {
        engine = makeEngine({ point: { x: 300, y: 610 }, containerTop: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // Anchored 10px under a 600px tall map, the card still lies over it.
        expect(card().style.transform).toBe('translate(300px, 498px)')
        expect(card().style.visibility).toBe('visible')

        engine.setPoint({ x: 300, y: 720 })
        engine.fire('move')

        expect(card().style.visibility).toBe('hidden')
    })

    it('hides a card that has cleared the map while still on screen', () => {
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

        expect(card().style.visibility).toBe('hidden')
    })

    it('clamps a card whose anchor sits exactly on the map edge', () => {
        engine = makeEngine({ point: { x: 0, y: 200 }, containerLeft: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // The anchor is still on the map, so the card is kept whole and on
        // screen, at the 8px margin, exactly as one further in would be.
        expect(card().style.transform).toBe('translate(8px, 138px)')
        expect(card().style.visibility).toBe('visible')
    })

    it('stays hidden until the anchor can be projected', () => {
        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the engine has no view yet')
        }
        show(bus, engine)
        expect(card().style.visibility).toBe('hidden')

        engine.engine.latLngToContainerPoint = () => ({ x: 300, y: 200 })
        engine.fire('move')

        expect(card().style.visibility).toBe('visible')
    })

    it('blanks the card while the engine animates a zoom and places it again after', () => {
        // Leaflet emits no move while its zoom animation runs, so the card
        // would otherwise hang at the pre-zoom position and jump at the end.
        show(bus, engine)
        sizeCard(200, 100)
        expect(card().style.visibility).toBe('visible')

        engine.fire('zoomstart')
        expect(card().style.visibility).toBe('hidden')

        engine.fire('zoomend')
        expect(card().style.visibility).toBe('visible')
        expect(card().style.transform).toBe('translate(300px, 138px)')
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
        expect(card().textContent).toContain('Crater A')
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
            expect(card().textContent).toContain('Draw')
            // The replacement is the new owner, and the old one cannot take
            // the slot back.
            expect(MapPopup_.hideForCaller('aoi')).toBe(false)
            expect(MapPopup_.hideForCaller('draw')).toBe(true)
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

        it('claims no stacking level of its own', () => {
            // The card rises no higher than the map it is mounted beside, so
            // the panels the app lays over the map paint over the card too.
            expect(declarations('.mmgis-map-popup')).not.toContain('z-index')
        })

        it('gives the close control the focus ring the buttons have', () => {
            expect(
                declarations('.mmgis-map-popup__close:focus-visible')
            ).toContain('outline: 3px solid')
        })
    })
})
