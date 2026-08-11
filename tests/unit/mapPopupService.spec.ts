import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type { MapPopupRequest } from '../../src/essence/Basics/MapPopup_/types'

/** Records what the service broadcasts and lets a spec fire bus events back. */
function makeBus() {
    const listeners = new Map<string, Set<(payload?: unknown) => void>>()
    const emitted: string[] = []
    return {
        emitted,
        listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
        fire: (event: string) => {
            listeners.get(event)?.forEach((handler) => handler())
        },
        api: {
            emit: (event: string) => {
                emitted.push(event)
                listeners.get(event)?.forEach((handler) => handler())
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
 * Stand-in for the active map engine. jsdom gives every element a zero rect,
 * so the container rect is stubbed to a known position.
 */
function makeEngine({
    point = { x: 300, y: 200 },
    containerTop = 50,
    containerLeft = 100,
    offThrows = false,
} = {}) {
    const listeners = new Map<string, Set<() => void>>()
    const container = document.createElement('div')
    container.getBoundingClientRect = () =>
        ({ top: containerTop, left: containerLeft }) as DOMRect
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

    it('does not fire the dismiss event when a button closes the popup', () => {
        show(bus, engine, {
            primaryAction: { label: 'Analyze', event: 'plugin:test:analyze' },
        })

        document
            .querySelector('.mmgis-map-popup__button')!
            .dispatchEvent(new MouseEvent('click'))

        expect(bus.emitted).not.toContain('plugin:test:dismissed')
    })

    it('fires the dismiss event and closes when the X is pressed', () => {
        show(bus, engine)

        document
            .querySelector('.mmgis-map-popup__close')!
            .dispatchEvent(new MouseEvent('click'))

        expect(bus.emitted).toEqual(['plugin:test:dismissed'])
        expect(popups()).toHaveLength(0)
    })

    it('fires the dismiss event and closes on Escape', () => {
        show(bus, engine)

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

        expect(bus.emitted).toEqual(['plugin:test:dismissed'])
        expect(popups()).toHaveLength(0)
    })

    it('dismisses on a map click once the opening click has passed', async () => {
        show(bus, engine)

        bus.fire('map:click')
        expect(popups()).toHaveLength(1)

        await nextTick()
        expect(bus.emitted).toEqual(['plugin:test:dismissed'])
        expect(popups()).toHaveLength(0)
    })

    it('keeps a popup opened by the same map click that would dismiss it', async () => {
        show(bus, engine)
        bus.fire('map:click')
        show(bus, engine)

        await nextTick()
        expect(popups()).toHaveLength(1)
        expect(bus.emitted).toEqual([])
    })

    it('replaces the current popup without firing its dismiss event', () => {
        show(bus, engine, { html: '<p>First</p>' })
        show(bus, engine, { html: '<p>Second</p>' })

        expect(popups()).toHaveLength(1)
        expect(document.querySelector('.mmgis-map-popup')!.textContent).toContain(
            'Second'
        )
        expect(bus.emitted).toEqual([])
    })

    it('is a no-op when hiding with no popup open', () => {
        window.mmgisAPI = bus.api as unknown as Window['mmgisAPI']

        MapPopup_.hide({ fireDismiss: true })

        expect(bus.emitted).toEqual([])
        expect(popups()).toHaveLength(0)
    })

    it('repositions the host on every engine move', () => {
        show(bus, engine)
        const host = document.querySelector<HTMLElement>('.mmgis-map-popup-host')!
        expect(host.style.transform).toBe('translate(400px, 250px)')

        engine.setPoint({ x: 10, y: 20 })
        engine.fire('move')

        expect(host.style.transform).toBe('translate(110px, 70px)')
    })

    it('stays hidden until the anchor can be projected', () => {
        engine.engine.latLngToContainerPoint = () => {
            throw new Error('the engine has no view yet')
        }
        show(bus, engine)
        const host = document.querySelector<HTMLElement>('.mmgis-map-popup-host')!
        expect(host.style.visibility).toBe('hidden')

        engine.engine.latLngToContainerPoint = () => ({ x: 300, y: 200 })
        engine.fire('move')

        expect(host.style.visibility).toBe('visible')
    })

    it('flips below the anchor when the card would clip the viewport top', () => {
        engine = makeEngine({ point: { x: 300, y: 5 }, containerTop: 0 })
        show(bus, engine)

        const host = document.querySelector('.mmgis-map-popup-host')!
        expect(host.classList.contains('mmgis-map-popup-host--below')).toBe(true)
    })

    it('unsubscribes from the engine and the bus when hidden', () => {
        show(bus, engine)
        expect(engine.listenerCount('move')).toBe(1)
        expect(engine.listenerCount('moveend')).toBe(1)
        expect(bus.listenerCount('map:click')).toBe(1)

        MapPopup_.hide()

        expect(engine.listenerCount('move')).toBe(0)
        expect(engine.listenerCount('moveend')).toBe(0)
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
