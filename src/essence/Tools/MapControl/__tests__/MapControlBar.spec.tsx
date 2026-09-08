import React from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { MapControlBar } from '../lib/geo/MapControlBar/MapControlBar'
import type { ActionIcon } from '../lib/types'
import { mount } from '../../_shared/__tests__/reactHarness'

/**
 * The action button is the one control on the bar whose whole existence is a
 * prop decision, so these cases drive it from props alone — no host, no
 * `window.mmgisAPI` — and assert on the markup a stylesheet keys off: the
 * presence of the button, its modifier classes and its accessible name. Those
 * are the parts a mission author never sees but every mission depends on; the
 * label text and the collapsible modifier both have exactly one definition in
 * the component, and a change to either fails silently on screen.
 */

const DEFAULT_LABEL = 'Analyze area'

/** The two icon forms the bar draws, already resolved as a host hands them in. */
const MDI_ICON: ActionIcon = { kind: 'mdi', className: 'mdi mdi-chart-box' }
const IMAGE_ICON: ActionIcon = { kind: 'image', src: 'Missions/M/icon.svg' }

const actionButton = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn--action')

const actionLabel = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn-label')

/** The glyph inside the action button, whichever form it took. */
const actionIconMark = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn-icon')

/**
 * Stands a ResizeObserver up on the global for the length of a case and
 * records what each instance observes. jsdom ships none, so the component's
 * guarded path is what the rest of the file exercises; these records are how a
 * case can tell whether the bar subscribed the row to resizes at all, which is
 * the one side of the measurement an environment without layout still shows.
 */
const installResizeObserver = () => {
    const records: { target: Element; disconnected: boolean }[] = []

    class StubResizeObserver {
        private record: { target: Element; disconnected: boolean } | null = null

        constructor(_callback: () => void) {}

        observe(target: Element) {
            this.record = { target, disconnected: false }
            records.push(this.record)
        }

        unobserve() {}

        disconnect() {
            if (this.record) this.record.disconnected = true
        }
    }

    const holder = globalThis as unknown as { ResizeObserver?: unknown }
    const original = holder.ResizeObserver
    holder.ResizeObserver = StubResizeObserver

    return {
        records,
        restore: () => {
            if (original === undefined) delete holder.ResizeObserver
            else holder.ResizeObserver = original
        },
    }
}

const barChildren = (container: HTMLElement) =>
    Array.from(container.querySelector('.blocks-map-control__bar')!.children)

/** Position of the bar child that holds `el`, so wrappers don't matter. */
const slotOf = (children: Element[], el: Element) =>
    children.findIndex((child) => child.contains(el))

afterEach(() => {
    document.body.innerHTML = ''
})

describe('MapControlBar action button', () => {
    test('is left out entirely when the host supplies no handler', async () => {
        const { container, unmount } = await mount(
            <MapControlBar actionLabel="Analyze area" actionIcon={MDI_ICON} />,
        )

        // Label and icon alone configure nothing: a mission without a
        // configured action gets a bar with no action button at all.
        expect(actionButton(container)).toBeNull()

        await unmount()
    })

    test('renders once a handler is supplied', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} />,
        )

        expect(actionButton(container)).not.toBeNull()

        await unmount()
    })

    test('falls back to its own label when none is configured', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} />,
        )

        expect(actionButton(container)?.textContent).toBe(DEFAULT_LABEL)

        await unmount()
    })

    test('shows the configured label in place of the default', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionLabel="Run statistics" />,
        )

        expect(actionButton(container)?.textContent).toBe('Run statistics')

        await unmount()
    })

    test('may collapse to a glyph only when it has one', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onActionClick={() => {}}
                actionIcon={MDI_ICON}
            />,
        )

        const button = actionButton(container)!
        expect(button.classList.contains('blocks-map-control__btn--collapsible')).toBe(
            true,
        )
        expect(button.querySelector('i')?.className).toBe(
            'mdi mdi-chart-box blocks-map-control__btn-icon',
        )

        await unmount()
    })

    test('may collapse to an image glyph just as it does to a font one', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={IMAGE_ICON} />,
        )

        // Collapsing turns on the presence of a glyph, not on which form it
        // took — an uploaded file leaves as much behind as an icon-font one.
        expect(
            actionButton(container)?.classList.contains(
                'blocks-map-control__btn--collapsible',
            ),
        ).toBe(true)

        await unmount()
    })

    test('paints an image glyph as a mask so it takes the button color', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={IMAGE_ICON} />,
        )

        const mark = actionIconMark(container) as HTMLElement
        // A mask filled with currentColor, rather than an `img` or inline
        // markup: the glyph reads white on the primary fill and matches the
        // label, and an uploaded SVG is never parsed as a document.
        expect(mark.tagName).toBe('SPAN')
        expect(
            mark.classList.contains('blocks-map-control__btn-icon--image'),
        ).toBe(true)
        expect(mark.style.maskImage).toBe('url("Missions/M/icon.svg")')
        expect(container.querySelector('.blocks-map-control__btn--action img')).toBeNull()

        await unmount()
    })

    test('keeps an image glyph out of any url() it is put inside', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onActionClick={() => {}}
                actionIcon={{ kind: 'image', src: 'a") ; background: red; x("b.svg' }}
            />,
        )

        const mark = actionIconMark(container) as HTMLElement
        // The src sits inside a quoted url() in an inline style. The quote that
        // would close it is encoded, so the value stays one url and cannot go
        // on to add declarations of its own; anything else it holds is inert
        // text inside that url.
        const declaration = mark.style.maskImage
        expect(declaration.startsWith('url("')).toBe(true)
        expect(declaration.endsWith('")')).toBe(true)
        expect(declaration.slice(5, -2)).not.toContain('"')

        await unmount()
    })

    test('gives both glyph forms the same box', async () => {
        const withFont = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={MDI_ICON} />,
        )
        const withImage = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={IMAGE_ICON} />,
        )

        // The collapse measurement sizes the collapsed button up from the
        // glyph alone, so the two forms have to be drawn in one box — which is
        // the shared class, since a mask has no intrinsic size of its own.
        // jsdom applies no stylesheet, so the class is the assertable part.
        expect(
            actionIconMark(withFont.container)?.classList.contains(
                'blocks-map-control__btn-icon',
            ),
        ).toBe(true)
        expect(
            actionIconMark(withImage.container)?.classList.contains(
                'blocks-map-control__btn-icon',
            ),
        ).toBe(true)

        await withFont.unmount()
        await withImage.unmount()
    })

    test('keeps its label on screen when there is no glyph to fall back to', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} />,
        )

        const button = actionButton(container)!
        // The stylesheet's hide-the-label rule asks for both modifiers, so a
        // button missing this one can't narrow down to an empty box whatever
        // the measurement concludes — and the measurement is skipped for it.
        expect(button.classList.contains('blocks-map-control__btn--collapsible')).toBe(
            false,
        )
        expect(button.classList.contains('blocks-map-control__btn--collapsed')).toBe(
            false,
        )
        expect(actionIconMark(container)).toBeNull()

        await unmount()
    })

    test('names itself with the label for readers who never see it', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionLabel="Run statistics" />,
        )

        const button = actionButton(container)!
        // The visible label is hidden at narrow widths, leaving these two as
        // the button's only name — so they carry the label and nothing else.
        expect(button.getAttribute('aria-label')).toBe('Run statistics')
        expect(button.getAttribute('title')).toBe('Run statistics')

        await unmount()
    })

    test('places the end slot after the built-in controls and before itself', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onZoomIn={() => {}}
                onZoomOut={() => {}}
                endSlot={<div className="spec-end-slot" />}
                onActionClick={() => {}}
            />,
        )

        const children = barChildren(container)
        const zoom = slotOf(children, container.querySelector('[title="Zoom in"]')!)
        const endSlot = slotOf(children, container.querySelector('.spec-end-slot')!)
        const action = slotOf(children, actionButton(container)!)

        expect(zoom).toBeGreaterThanOrEqual(0)
        expect(endSlot).toBeGreaterThan(zoom)
        expect(action).toBeGreaterThan(endSlot)

        await unmount()
    })
})

/**
 * The bar decides between the label and a bare glyph by laying the row out
 * both ways and comparing how many lines each takes. jsdom runs no layout —
 * every rect it reports reads as zero — so both passes count the row as a
 * single line, the counts tie, and the decision lands on the expanded side
 * every time. That leaves one branch reachable here, and these cases cover
 * what survives without layout: the markup the decision writes, the parts that
 * hold whichever way it goes, and whether the row is measured at all.
 *
 * The other branch — the row that has width for the glyph but not the label —
 * needs real line boxes and belongs to a browser, not to this file. Faking
 * rects to force it would assert on the fake.
 */
describe('MapControlBar action button collapse', () => {
    test('keeps the label in the markup alongside the glyph', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onActionClick={() => {}}
                actionLabel="Run statistics"
                actionIcon={MDI_ICON}
            />,
        )

        // The label element is never rendered away — the stylesheet is what
        // hides it — so the text is on the button whether or not it is drawn.
        expect(actionLabel(container)?.textContent).toBe('Run statistics')
        expect(actionButton(container)?.getAttribute('aria-label')).toBe(
            'Run statistics',
        )

        await unmount()
    })

    test('leaves the glyph-only class off a row that has room for the label', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onActionClick={() => {}}
                actionIcon={MDI_ICON}
            />,
        )

        // Both passes tie at one line, so the label costs the row nothing.
        expect(
            actionButton(container)?.classList.contains(
                'blocks-map-control__btn--collapsed',
            ),
        ).toBe(false)

        await unmount()
    })

    test('measures the row only for a button with a glyph to fall back to', async () => {
        const observer = installResizeObserver()
        try {
            const withIcon = await mount(
                <MapControlBar
                    onActionClick={() => {}}
                    actionIcon={MDI_ICON}
                />,
            )
            expect(observer.records).toHaveLength(1)
            expect(observer.records[0].target).toBe(
                withIcon.container.querySelector('.blocks-map-control__bar'),
            )
            await withIcon.unmount()

            // Nothing to collapse to, so the row is never sized up: the button
            // keeps its label at every width and there is no answer to take.
            const withoutIcon = await mount(<MapControlBar onActionClick={() => {}} />)
            expect(observer.records).toHaveLength(1)
            await withoutIcon.unmount()
        } finally {
            observer.restore()
        }
    })

    test('stops watching the row once it goes away', async () => {
        const observer = installResizeObserver()
        try {
            const { unmount } = await mount(
                <MapControlBar
                    onActionClick={() => {}}
                    actionIcon={MDI_ICON}
                />,
            )
            expect(observer.records[0].disconnected).toBe(false)

            await unmount()
            expect(observer.records[0].disconnected).toBe(true)
        } finally {
            observer.restore()
        }
    })

    test('renders where the environment supplies no ResizeObserver', async () => {
        // jsdom is such an environment, so this is the state the file's other
        // cases run in; asserted outright because the button has to draw with
        // its label wherever the bar cannot subscribe to resizes.
        expect(typeof (globalThis as unknown as { ResizeObserver?: unknown })
            .ResizeObserver).toBe('undefined')

        const { container, unmount } = await mount(
            <MapControlBar
                onActionClick={() => {}}
                actionLabel="Run statistics"
                actionIcon={MDI_ICON}
            />,
        )

        expect(actionLabel(container)?.textContent).toBe('Run statistics')

        await unmount()
    })
})
