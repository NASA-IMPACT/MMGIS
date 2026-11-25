import React from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { MapControlBar } from '../lib/geo/MapControlBar/MapControlBar'
import type { ActionIcon } from '../lib/types'
import { mount, click } from '../../_shared/__tests__/reactHarness'

/**
 * The action button driven from props alone — no host, no `window.mmgisAPI` —
 * asserting on the markup the stylesheet keys off: the button's presence, its
 * classes and its accessible name.
 */

/** The two icon forms the bar draws, already resolved as a host hands them in. */
const MDI_ICON: ActionIcon = { kind: 'mdi', className: 'mdi mdi-chart-box' }
const IMAGE_ICON: ActionIcon = { kind: 'image', src: 'Missions/M/icon.svg' }

const actionButton = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn--action')

const actionLabel = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn-label')

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
        // The bar supplies no wording of its own for a glyph-only button.
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
        // The glyph is aria-hidden, so the fallback name is all a screen reader
        // has to announce the button by.
        const name = button.getAttribute('aria-label')
        expect(name).toBeTruthy()
        expect(button.getAttribute('title')).toBe(name)
        // It is a name, not content.
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
        // The quote that would close the url() is encoded, so the value stays
        // one url and cannot go on to add declarations of its own.
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

/** The basemap popover portals to <body>; open it through the bar's button. */
const STYLES = [{ name: 'Light' }, { name: 'Dark' }]
const openBasemapPopover = async (container: HTMLElement) => {
    const btn = Array.from(container.querySelectorAll('.blocks-map-control__btn')).find((b) =>
        b.getAttribute('title')?.startsWith('Basemap'),
    )!
    await click(btn)
}
/** A group's checkbox, by the name beside it. */
const groupCheckbox = (name: string) =>
    Array.from(document.body.querySelectorAll('.blocks-basemap-panel__group-label'))
        .find((l) => l.textContent === name)
        ?.querySelector('input') ?? null
const basemapPanel = () => document.body.querySelector('.blocks-basemap-panel')

const GROUPS = [
    { id: 'Borders', name: 'Borders', state: 'mixed' as const },
    { id: 'Labels', name: 'Labels', state: 'on' as const },
]

describe('MapControlBar basemap groups', () => {
    test('a group with some layers on shows half-checked', async () => {
        const { container, unmount } = await mount(
            <MapControlBar basemapStyles={STYLES} basemapGroups={GROUPS} onToggleBasemapGroup={() => {}} />,
        )
        await openBasemapPopover(container)
        const borders = groupCheckbox('Borders')!
        expect(borders.indeterminate).toBe(true)
        expect(borders.checked).toBe(false)
        expect(groupCheckbox('Labels')!.checked).toBe(true)
        await unmount()
    })

    test('are left out without groups, and the styles still list', async () => {
        const { container, unmount } = await mount(
            <MapControlBar basemapStyles={STYLES} basemapGroups={[]} onToggleBasemapGroup={() => {}} />,
        )
        await openBasemapPopover(container)
        expect(basemapPanel()!.querySelector('.blocks-basemap-panel__groups')).toBeNull()
        expect(basemapPanel()!.querySelectorAll('.blocks-basemap-panel__row')).toHaveLength(2)
        await unmount()
    })

    test('reports the group and its new state, and keeps the popover open', async () => {
        const toggled: [string, boolean][] = []
        const { container, unmount } = await mount(
            <MapControlBar
                basemapStyles={STYLES}
                basemapGroups={GROUPS}
                onToggleBasemapGroup={(id, v) => toggled.push([id, v])}
            />,
        )
        await openBasemapPopover(container)
        await click(groupCheckbox('Borders')!)
        await click(groupCheckbox('Labels')!)

        // A mixed group turns on; an on group turns off.
        expect(toggled).toEqual([
            ['Borders', true],
            ['Labels', false],
        ])
        expect(basemapPanel()).not.toBeNull()

        await unmount()
    })
    test("lists a parent's children under it, each toggled by its own id", async () => {
        const toggled: [string, boolean][] = []
        const nested = [
            {
                id: 'Borders',
                name: 'Borders',
                state: 'mixed' as const,
                children: [
                    { id: 'Borders/Countries', name: 'Countries', state: 'on' as const },
                    { id: 'Borders/States', name: 'States', state: 'off' as const },
                ],
            },
        ]
        const { container, unmount } = await mount(
            <MapControlBar
                basemapStyles={STYLES}
                basemapGroups={nested}
                onToggleBasemapGroup={(id, v) => toggled.push([id, v])}
            />,
        )
        await openBasemapPopover(container)

        const children = basemapPanel()!.querySelector('.blocks-basemap-panel__children')!
        expect(Array.from(children.querySelectorAll('label')).map((l) => l.textContent)).toEqual([
            'Countries',
            'States',
        ])
        expect(groupCheckbox('Borders')!.indeterminate).toBe(true)

        await click(groupCheckbox('States')!)
        await click(groupCheckbox('Borders')!)
        expect(toggled).toEqual([
            ['Borders/States', true],
            ['Borders', true],
        ])

        await unmount()
    })
})
