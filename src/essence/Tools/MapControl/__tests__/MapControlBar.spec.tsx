import React from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { MapControlBar } from '../lib/geo/MapControlBar/MapControlBar'
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

const actionButton = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn--action')

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
            <MapControlBar actionLabel="Analyze area" actionIcon="mdi mdi-chart-box" />,
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
                actionIcon="mdi mdi-chart-box mdi-18px"
            />,
        )

        const button = actionButton(container)!
        expect(button.classList.contains('blocks-map-control__btn--collapsible')).toBe(
            true,
        )
        expect(button.querySelector('i')?.className).toBe(
            'mdi mdi-chart-box mdi-18px',
        )

        await unmount()
    })

    test('keeps its label on screen when there is no glyph to fall back to', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onActionClick={() => {}} />,
        )

        const button = actionButton(container)!
        // Without the modifier the stylesheet's hide-the-label rule never
        // applies, so the button can't narrow down to an empty box.
        expect(button.classList.contains('blocks-map-control__btn--collapsible')).toBe(
            false,
        )
        expect(button.querySelector('i')).toBeNull()

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
