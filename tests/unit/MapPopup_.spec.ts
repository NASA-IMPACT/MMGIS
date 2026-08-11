import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type { MapPopupRequest } from '../../src/essence/Basics/MapPopup_/types'

/**
 * Records what the service broadcasts and lets a spec fire bus events back.
 * Handlers are snapshotted before dispatch, exactly as mitt does, so a
 * listener unsubscribed mid-emit still receives that emit.
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
        dismissEvent: 'plugin:test:dismissed',
        ...overrides,
    }
}

function show(
    bus: ReturnType<typeof makeBus>,
    engine: ReturnType<typeof makeEngine>,
    overrides: Partial<MapPopupRequest> = {}
): boolean {
    window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
    return MapPopup_.show(request(overrides), engine.engine as never)
}

const popups = () => document.querySelectorAll('.mmgis-map-popup')
const card = () => document.querySelector<HTMLElement>('.mmgis-map-popup')!
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

    it('mounts a single popup on the body and sanitizes the html', () => {
        expect(
            show(bus, engine, {
                html: '<p>Crater A</p><script>window.pwned = true</script>',
            })
        ).toBe(true)

        expect(popups()).toHaveLength(1)
        const content = document.querySelector('.mmgis-map-popup__content')!
        expect(content.innerHTML).toContain('Crater A')
        expect(content.innerHTML).not.toContain('script')
    })

    it('renders both actions and broadcasts the primary event on click', () => {
        show(bus, engine, {
            secondaryAction: { label: 'Cancel', event: 'plugin:test:cancel' },
            primaryAction: { label: 'Analyze', event: 'plugin:test:analyze' },
        })

        const buttons = document.querySelectorAll('.mmgis-map-popup__button')
        expect(
            Array.from(buttons).map((button) => button.textContent)
        ).toEqual(['Cancel', 'Analyze'])

        buttons[1].dispatchEvent(new MouseEvent('click'))
        expect(bus.emitted).toEqual(['plugin:test:analyze'])
        expect(popups()).toHaveLength(0)
    })

    it('drops an action whose label or event is unusable', () => {
        show(bus, engine, {
            primaryAction: { label: 'Analyze' } as never,
            secondaryAction: { label: '', event: 'plugin:test:cancel' },
        })

        expect(
            document.querySelectorAll('.mmgis-map-popup__button')
        ).toHaveLength(0)
    })

    it('fires the dismiss event and closes when the X is pressed', () => {
        show(bus, engine)

        document
            .querySelector('.mmgis-map-popup__close')!
            .dispatchEvent(new MouseEvent('click'))

        expect(bus.emitted).toEqual(['plugin:test:dismissed'])
        expect(popups()).toHaveLength(0)
    })

    it('dismisses on a map click once the opening gesture has passed', async () => {
        show(bus, engine)
        await nextTick()

        bus.fire('map:click')
        expect(popups()).toHaveLength(1)

        await nextTick()
        expect(bus.emitted).toEqual(['plugin:test:dismissed'])
        expect(popups()).toHaveLength(0)
    })

    it('ignores the map click that deck.gl emits after the feature click that opened the popup', async () => {
        // deck.gl calls its feature-click handler and then emits the click, so
        // a popup opened from a feature click would otherwise be dismissed by
        // the very click that opened it.
        show(bus, engine)
        bus.fire('map:click')

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(bus.emitted).toEqual([])
    })

    it('keeps a popup opened later in the same gesture as the dismissing click', async () => {
        // Leaflet emits map:click before map:featureClick, so a plugin's
        // replacement popup is shown after the dismissal was scheduled.
        show(bus, engine, { html: '<p>First</p>' })
        await nextTick()

        bus.fire('map:click')
        show(bus, engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(card().textContent).toContain('Second')
        expect(bus.emitted).toEqual([])
    })

    it('never lets a replaced popup dismiss its replacement', async () => {
        // A plugin that opens popups from map:click is subscribed before the
        // open popup is, so its replacement is mounted while the bus is still
        // dispatching to the replaced popup's own listener.
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
        bus.api.on('map:click', () => {
            MapPopup_.show(
                request({ html: '<p>Second</p>' }),
                engine.engine as never
            )
        })
        show(bus, engine, { html: '<p>First</p>' })
        await nextTick()

        bus.fire('map:click')

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(card().textContent).toContain('Second')
        expect(bus.emitted).toEqual([])
    })

    it('replaces the current popup without firing its dismiss event', () => {
        show(bus, engine, { html: '<p>First</p>' })
        show(bus, engine, { html: '<p>Second</p>' })

        expect(popups()).toHaveLength(1)
        expect(card().textContent).toContain('Second')
        expect(bus.emitted).toEqual([])
    })

    it('retracts the popup for map:hidePopup without firing its dismiss event', () => {
        show(bus, engine)

        // What the map:hidePopup provider calls.
        MapPopup_.hide()

        expect(popups()).toHaveLength(0)
        expect(bus.emitted).toEqual([])

        // Asking again with nothing open changes nothing.
        MapPopup_.hide()

        expect(popups()).toHaveLength(0)
        expect(bus.emitted).toEqual([])
    })

    it('is a no-op when hiding with no popup open', () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

        MapPopup_.hide({ fireDismiss: true })

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
        show(bus, engine)
        await nextTick()
        expect(engine.listenerCount('move')).toBe(1)
        expect(engine.listenerCount('zoomstart')).toBe(1)
        expect(engine.listenerCount('zoomend')).toBe(1)
        expect(bus.listenerCount('map:click')).toBe(1)

        MapPopup_.hide()

        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('zoomstart')).toBe(0)
        expect(engine.listenerCount('zoomend')).toBe(0)
        expect(bus.listenerCount('map:click')).toBe(0)
        expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function))
        removeListener.mockRestore()
    })

    it('never subscribes to the bus when hidden before the opening task ends', async () => {
        show(bus, engine)
        MapPopup_.hide()

        await nextTick()

        expect(bus.listenerCount('map:click')).toBe(0)
    })

    it('leaves nothing subscribed or mounted when wiring the popup fails', () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']
        const subscribe = engine.engine.on
        engine.engine.on = (event: string, handler: () => void) => {
            if (event === 'zoomend') throw new Error('engine destroyed')
            subscribe(event, handler)
        }

        expect(MapPopup_.show(request(), engine.engine as never)).toBe(false)

        expect(popups()).toHaveLength(0)
        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('zoomstart')).toBe(0)
        expect(bus.listenerCount('map:click')).toBe(0)
    })

    it('still tears down when the engine has already been destroyed', () => {
        engine = makeEngine({ offThrows: true })
        show(bus, engine)

        MapPopup_.hide()

        expect(popups()).toHaveLength(0)
        expect(bus.listenerCount('map:click')).toBe(0)
    })

    it('rejects a request without a valid latlng or html', () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

        expect(
            MapPopup_.show(
                { html: '<p>No anchor</p>' } as MapPopupRequest,
                engine.engine as never
            )
        ).toBe(false)
        expect(
            MapPopup_.show(
                { latlng: { lat: 1, lng: 2 }, html: 42 } as unknown as MapPopupRequest,
                engine.engine as never
            )
        ).toBe(false)

        expect(popups()).toHaveLength(0)
    })
})
