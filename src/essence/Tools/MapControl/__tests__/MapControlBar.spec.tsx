import React from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { MapControlBar } from '../lib/geo/MapControlBar/MapControlBar'
import type { ActionIcon } from '../lib/types'
import { mount } from '../../_shared/__tests__/reactHarness'

/**
 * The action button is the one control on the bar whose whole existence is a
 * prop decision, so these cases drive it from props alone — no host, no
 * `window.mmgisAPI` — and assert on the markup a stylesheet keys off: the
 * presence of the button, the classes it carries and its accessible name. Those
 * are the parts a mission author never sees but every mission depends on, and
 * they have exactly one definition apiece in the component.
 */

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

    test('draws the glyph ahead of the label when configured with both', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onActionClick={() => {}}
                actionLabel="Run statistics"
                actionIcon={MDI_ICON}
            />,
        )

        const button = actionButton(container)!
        // Source order is the drawn order: the glyph leads the text.
        expect(button.firstElementChild).toBe(actionIconMark(container))
        expect(actionLabel(container)?.textContent).toBe('Run statistics')
        expect(button.getAttribute('aria-label')).toBe('Run statistics')
        expect(button.getAttribute('title')).toBe('Run statistics')

        await unmount()
    })

    test('draws the glyph alone when configured without a label', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={MDI_ICON} />,
        )

        const button = actionButton(container)!
        expect(actionIconMark(container)).not.toBeNull()
        // No label element and no text: the bar supplies no wording of its own
        // for a button the host configured as a glyph.
        expect(actionLabel(container)).toBeNull()
        expect(button.textContent).toBe('')
        expect(button.querySelector('i')?.className).toBe(
            'mdi mdi-chart-box blocks-map-control__btn-icon',
        )

        await unmount()
    })

    test('sizes a glyph-only button like the other icon buttons', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={MDI_ICON} />,
        )

        // The wide slot exists to give a label room, so a button without one
        // stays square instead of stretching across the row.
        const button = actionButton(container)!
        expect(button.className).toContain('blocks-map-control__btn--action-glyph')
        expect(button.parentElement?.className).not.toContain(
            'blocks-map-control__group--wide',
        )

        await unmount()
    })

    test('names a glyph-only button, since its glyph carries no text', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionIcon={MDI_ICON} />,
        )

        const button = actionButton(container)!
        // Nothing inside the button is readable — the glyph is aria-hidden —
        // so the fallback name is all a screen reader has to announce it by.
        const name = button.getAttribute('aria-label')
        expect(name).toBeTruthy()
        expect(button.getAttribute('title')).toBe(name)
        // It is a name, not content: it never reaches the markup as text.
        expect(button.textContent).toBe('')

        await unmount()
    })

    test('draws the label alone when configured without a glyph', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} actionLabel="Run statistics" />,
        )

        const button = actionButton(container)!
        expect(actionIconMark(container)).toBeNull()
        expect(actionLabel(container)?.textContent).toBe('Run statistics')
        expect(button.getAttribute('aria-label')).toBe('Run statistics')
        expect(button.getAttribute('title')).toBe('Run statistics')

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
