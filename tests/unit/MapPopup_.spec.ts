import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
            listeners.get(event)?.forEach((handler) => handler())
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
    'rejected: [MapPopup] Invalid request: html must be a string and latlng must hold finite lat/lng numbers.'

const popups = () => document.querySelectorAll('.mmgis-map-popup')
const card = () => document.querySelector<HTMLElement>('.mmgis-map-popup')!
const buttons = () => document.querySelectorAll('.mmgis-map-popup__button')
/** Give the card a real size; jsdom reports every element as 0x0. */
const sizeCard = (width: number, height: number) => {
    card().getBoundingClientRect = () => ({ width, height }) as DOMRect
}
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0))

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

    it('mounts a single popup on the body and sanitizes the html', async () => {
        const outcome = show(bus, engine, {
            html: '<p>Crater A</p><script>window.pwned = true</script>',
        })

        expect(popups()).toHaveLength(1)
        const content = document.querySelector('.mmgis-map-popup__content')!
        expect(content.innerHTML).toContain('Crater A')
        expect(content.innerHTML).not.toContain('script')

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

        bus.fire('map:click')
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
        bus.fire('map:click')

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(outcome).toEqual([])
    })

    it('keeps a popup opened later in the same gesture as the dismissing click', async () => {
        // Leaflet emits map:click before map:featureClick, so a plugin's
        // replacement popup is shown after the dismissal was scheduled.
        const first = show(bus, engine, { html: '<p>First</p>' })
        await nextTick()

        bus.fire('map:click')
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
        // open popup is, so its replacement is mounted while the bus is still
        // dispatching to the replaced popup's own listener.
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
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

        bus.fire('map:click')

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
        bus.fire('map:click')
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

    it('clamps the card to the viewport when its anchor sits near an edge', () => {
        engine = makeEngine({ point: { x: 5, y: 200 }, containerLeft: 0 })
        show(bus, engine)
        sizeCard(200, 100)

        engine.fire('move')

        // Centering on x=5 would push the card off screen, so it stops at the
        // 8px margin.
        expect(card().style.transform).toBe('translate(8px, 138px)')
    })

    it('hides the card while its anchor is outside the map container', () => {
        show(bus, engine)
        expect(card().style.visibility).toBe('visible')

        engine.setPoint({ x: -60, y: 200 })
        engine.fire('move')
        expect(card().style.visibility).toBe('hidden')

        engine.setPoint({ x: 300, y: 900 })
        engine.fire('move')
        expect(card().style.visibility).toBe('hidden')

        engine.setPoint({ x: 300, y: 200 })
        engine.fire('move')
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

    it('unsubscribes from the engine, the window and the bus when hidden', async () => {
        const removeListener = vi.spyOn(window, 'removeEventListener')
        const outcome = show(bus, engine)
        await nextTick()
        expect(engine.listenerCount('move')).toBe(1)
        expect(engine.listenerCount('zoomstart')).toBe(1)
        expect(engine.listenerCount('zoomend')).toBe(1)
        expect(bus.listenerCount('map:click')).toBe(1)

        MapPopup_.hide()
        await nextTick()

        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('zoomstart')).toBe(0)
        expect(engine.listenerCount('zoomend')).toBe(0)
        expect(bus.listenerCount('map:click')).toBe(0)
        expect(removeListener).toHaveBeenCalledWith(
            'resize',
            expect.any(Function)
        )
        expect(outcome).toEqual(['closed'])
        removeListener.mockRestore()
    })

    it('never subscribes to the bus when hidden before the opening task ends', async () => {
        const outcome = show(bus, engine)
        MapPopup_.hide()

        await nextTick()

        expect(bus.listenerCount('map:click')).toBe(0)
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
        expect(bus.listenerCount('map:click')).toBe(0)
    })

    it('still tears down when the engine has already been destroyed', async () => {
        engine = makeEngine({ offThrows: true })
        const outcome = show(bus, engine)

        MapPopup_.hide()
        await nextTick()

        expect(popups()).toHaveLength(0)
        expect(bus.listenerCount('map:click')).toBe(0)
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
})
