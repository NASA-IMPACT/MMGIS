import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import MapPopup_ from '../../src/essence/Basics/MapPopup_/MapPopup_'
import type {
    MapPopupRequest,
    MapPopupResult,
} from '../../src/essence/Basics/MapPopup_/types'

/**
 * Stand-in for the active map engine: one card at a time, mounted in a
 * container that is in the document so focus can land.
 */
function makeEngine({ showThrows = false, hideThrows = false } = {}) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const shows: Array<{
        latlng: { lat: number; lng: number }
        element: HTMLElement
    }> = []
    let reportClose: (() => void) | undefined

    return {
        shows,
        /** The map library closing the card of its own accord. */
        libraryClose: () => reportClose?.(),
        engine: {
            showPopup(
                latlng: { lat: number; lng: number },
                element: HTMLElement,
                onClose?: () => void
            ) {
                if (showThrows) throw new Error('engine destroyed')
                shows.push({ latlng, element })
                reportClose = onClose
                container.innerHTML = ''
                container.appendChild(element)
            },
            hidePopup() {
                if (hideThrows) throw new Error('engine destroyed')
                reportClose = undefined
                container.innerHTML = ''
            },
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
 * Record how a request settles, as its action or `rejected: <message>`. The
 * list is the count of answers the caller saw, so a request never answered
 * reads as empty and one answered twice would read as two entries.
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
    overrides: Partial<MapPopupRequest> = {}
): string[] {
    return track(MapPopup_.show(request(overrides), engine.engine as never))
}

const INVALID_REQUEST =
    'rejected: [MapPopup] Invalid request: latlng must hold finite lat/lng numbers, and title and html must be strings when given.'
const NOTHING_TO_SHOW =
    'rejected: [MapPopup] Invalid request: a popup needs a title or html to show.'
const WIRING_FAILED =
    'rejected: [MapPopup] Could not show the popup: Error: engine destroyed'

const cards = () => document.querySelectorAll('.mmgis-popup-card')
const card = () => document.querySelector<HTMLElement>('.mmgis-popup-card')!
const title = () => document.querySelector<HTMLElement>('.mmgis-popup-title')!
const body = () =>
    document.querySelector<HTMLElement>('.mmgis-popup-body')!.innerHTML
const buttons = () =>
    document.querySelectorAll<HTMLButtonElement>('.mmgis-popup-button')
const clickOn = (element: Element) =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
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

    it('places one card and leaves its request pending until it closes', async () => {
        const outcome = show(engine)

        expect(cards()).toHaveLength(1)
        expect(engine.shows).toHaveLength(1)
        expect(engine.shows[0].latlng).toEqual({ lat: 45, lng: -120 })

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
        expect(cards()).toHaveLength(0)
    })

    it('styles a lone secondary action as the primary button', async () => {
        const outcome = show(engine, { secondaryAction: { label: 'Cancel' } })

        expect(buttons()).toHaveLength(1)
        expect(buttons()[0].className).toContain('mmgis-popup-button--primary')

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
        // One warning per action dropped.
        expect(warn).toHaveBeenCalledTimes(2)
        warn.mockRestore()
    })

    // A title is neither sanitized nor parsed: it never goes near the html
    // path, so markup in one arrives as the characters it was written with.
    it('renders the title as text rather than as markup', () => {
        show(engine, { title: '<b>Drawn</b> rectangle' })

        expect(title().textContent).toBe('<b>Drawn</b> rectangle')
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
        expect(cards()).toHaveLength(0)
    })

    it.each([
        ['no anchor', { html: '<p>No anchor</p>' }],
        [
            'an anchor that is not finite',
            { latlng: { lat: NaN, lng: -120 }, html: '<p>No anchor</p>' },
        ],
        [
            'an html that is not a string',
            { latlng: { lat: 1, lng: 2 }, html: 42 },
        ],
        [
            'a title that is not a string',
            { latlng: { lat: 1, lng: 2 }, title: 42 },
        ],
    ])(
        'rejects a later request with %s and leaves the open card alone',
        async (_case, invalid) => {
            const outcome = show(engine, { html: '<p>Crater A</p>' })

            const rejected = track(
                MapPopup_.show(invalid as never, engine.engine as never)
            )
            await nextTick()

            expect(rejected).toEqual([INVALID_REQUEST])
            expect(cards()).toHaveLength(1)
            expect(card().textContent).toContain('Crater A')
            expect(outcome).toEqual([])
        }
    )

    it('resolves dismiss when the map library closes the card', async () => {
        const outcome = show(engine)

        engine.libraryClose()
        await nextTick()

        expect(outcome).toEqual(['dismiss'])
        expect(cards()).toHaveLength(0)

        // Nothing is left to retract, so a later hide adds no second answer.
        MapPopup_.hide()
        await nextTick()
        expect(outcome).toEqual(['dismiss'])
    })

    it('replaces the current card and resolves the replaced request with closed', async () => {
        const first = show(engine, { html: '<p>First</p>' })
        const second = show(engine, { html: '<p>Second</p>' })

        await nextTick()
        expect(cards()).toHaveLength(1)
        expect(card().textContent).toContain('Second')
        // Closed, never dismissed: the user did not wave the first card away.
        expect(first).toEqual(['closed'])
        expect(second).toEqual([])
    })

    it('retracts the card for map:hidePopup, resolving its request with closed', async () => {
        const outcome = show(engine)

        // What the map:hidePopup provider calls.
        MapPopup_.hide()
        await nextTick()

        expect(cards()).toHaveLength(0)
        expect(outcome).toEqual(['closed'])
    })

    // A hide can run after the engine has been destroyed, when taking the card
    // off it throws. The request still has to answer, exactly once.
    it('answers the request even when the engine throws while retracting', async () => {
        engine = makeEngine({ hideThrows: true })
        const outcome = show(engine)

        expect(() => MapPopup_.hide()).not.toThrow()
        await nextTick()

        expect(outcome).toEqual(['closed'])

        // The record went with it, so the next request has nothing to replace
        // and cannot answer this one a second time.
        show(makeEngine())
        await nextTick()
        expect(outcome).toEqual(['closed'])
    })

    it('rejects and leaves nothing open when the card cannot be placed', async () => {
        const outcome = track(
            MapPopup_.show(
                request(),
                makeEngine({ showThrows: true }).engine as never
            )
        )
        await nextTick()

        // Answered exactly once, and with the failure: unwinding the half-open
        // popup neither resolves on top of it nor leaves the request hanging.
        expect(outcome).toEqual([WIRING_FAILED])
        expect(cards()).toHaveLength(0)
    })

    // Leaflet's popup empties its content node and re-appends the card on
    // open, which blurs anything focused beforehand: focusing only once the
    // engine has the card is what makes the focus stick.
    it('focuses the first action button once the engine has placed the card', () => {
        show(engine, {
            primaryAction: { label: 'Analyze' },
            secondaryAction: { label: 'Cancel' },
        })

        expect(document.activeElement).toBe(buttons()[0])
    })

    it('keeps the markup an author needs and strips the rest', () => {
        show(engine, {
            html: '<style>.mmgis-popup-card { display: none }</style><p style="color: red" onclick="alert(1)">A</p><table><tr><td>Cell</td></tr></table><ul><li>One</li></ul><img src="a.png" alt="Crater A"><script>alert(2)</script><a href="javascript:alert(3)">go</a>',
        })

        const markup = body()
        expect(markup).toContain('style="color: red"')
        expect(markup).toContain('<td>Cell</td>')
        expect(markup).toContain('<li>One</li>')
        expect(markup).toContain('alt="Crater A"')
        // A card is plain DOM in the app's document, so an author's stylesheet
        // would be a stylesheet for the whole page.
        expect(markup).not.toContain('<style')
        expect(markup).not.toContain('display: none')
        expect(markup).not.toContain('onclick')
        expect(markup).not.toContain('alert')
        expect(markup).not.toContain('javascript:')
    })
})
