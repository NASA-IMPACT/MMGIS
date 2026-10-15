import React from 'react'
import { describe, test, expect, afterEach, vi } from 'vitest'
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
const labelsCheckbox = () =>
    document.body.querySelector<HTMLInputElement>('.blocks-basemap-panel__labels input')
const basemapPanel = () => document.body.querySelector('.blocks-basemap-panel')

describe('MapControlBar basemap labels', () => {
    test('is a checked checkbox beside the heading when the labels show', async () => {
        const { container, unmount } = await mount(
            <MapControlBar basemapStyles={STYLES} basemapLabelsVisible onToggleBasemapLabels={() => {}} />,
        )
        await openBasemapPopover(container)

        const box = labelsCheckbox()!
        expect(box.checked).toBe(true)
        expect(box.closest('.blocks-basemap-panel__header')).not.toBeNull()
        expect(box.closest('label')!.textContent).toBe('Labels')

        await unmount()
    })

    test('is unchecked when the labels are hidden', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                basemapStyles={STYLES}
                basemapLabelsVisible={false}
                onToggleBasemapLabels={() => {}}
            />,
        )
        await openBasemapPopover(container)
        expect(labelsCheckbox()!.checked).toBe(false)
        await unmount()
    })

    test('is left out when the map cannot toggle labels, and the styles still list', async () => {
        const { container, unmount } = await mount(
            <MapControlBar basemapStyles={STYLES} basemapLabelsVisible={null} onToggleBasemapLabels={() => {}} />,
        )
        await openBasemapPopover(container)
        expect(labelsCheckbox()).toBeNull()
        expect(basemapPanel()!.querySelectorAll('.blocks-basemap-panel__row')).toHaveLength(2)
        await unmount()
    })

    test('reports the new state and keeps the popover open', async () => {
        const toggled: boolean[] = []
        const { container, unmount } = await mount(
            <MapControlBar
                basemapStyles={STYLES}
                basemapLabelsVisible
                onToggleBasemapLabels={(v) => toggled.push(v)}
            />,
        )
        await openBasemapPopover(container)
        await click(labelsCheckbox()!)

        expect(toggled).toEqual([false])
        expect(basemapPanel()).not.toBeNull()

        await unmount()
    })
})

const compassButton = (container: HTMLElement) =>
    container.querySelector<HTMLButtonElement>('.blocks-map-control__btn--compass')
const needle = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('.blocks-map-control__needle')

describe('MapControlBar compass', () => {
    test('is left out when the host supplies no reset handler', async () => {
        const { container, unmount } = await mount(
            <MapControlBar camera={{ bearing: 30, pitch: 10 }} />,
        )

        expect(compassButton(container)).toBeNull()

        await unmount()
    })

    test('sits right after the zoom buttons', async () => {
        const { container, unmount } = await mount(
            <MapControlBar
                onZoomIn={() => {}}
                onZoomOut={() => {}}
                onResetNorth={() => {}}
                endSlot={<div className="spec-end-slot" />}
            />,
        )

        const children = barChildren(container)
        const zoom = slotOf(children, container.querySelector('[title="Zoom in"]')!)
        const compass = slotOf(children, compassButton(container)!)
        const endSlot = slotOf(children, container.querySelector('.spec-end-slot')!)

        expect(compass).toBe(zoom + 1)
        expect(endSlot).toBe(compass + 1)

        await unmount()
    })

    test('draws the needle north-up and flat before the camera is known', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onResetNorth={() => {}} camera={null} />,
        )

        expect(needle(container)!.style.transform).toBe('rotateX(0deg) rotateZ(0deg)')
        expect(compassButton(container)!.title).toBe('Bearing 0°, tilt 0°')

        await unmount()
    })

    // A map turned clockwise by its bearing turns geographic north
    // counter-clockwise on screen, so the needle turns by -bearing.
    test('turns the needle against the bearing and tips it by the pitch', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onResetNorth={() => {}} camera={{ bearing: 45, pitch: 30 }} />,
        )

        expect(needle(container)!.style.transform).toBe('rotateX(30deg) rotateZ(-45deg)')

        await unmount()
    })

    test('follows the camera as it changes', async () => {
        const { container, rerender, unmount } = await mount(
            <MapControlBar onResetNorth={() => {}} camera={{ bearing: 10, pitch: 0 }} />,
        )
        await rerender(
            <MapControlBar onResetNorth={() => {}} camera={{ bearing: -90, pitch: 60 }} />,
        )

        expect(needle(container)!.style.transform).toBe('rotateX(60deg) rotateZ(90deg)')

        await unmount()
    })

    test('shows the bearing as a compass heading and the tilt on hover', async () => {
        const { container, unmount } = await mount(
            <MapControlBar onResetNorth={() => {}} camera={{ bearing: -45.4, pitch: 29.6 }} />,
        )

        const button = compassButton(container)!
        expect(button.title).toBe('Bearing 315°, tilt 30°')
        expect(button.getAttribute('aria-label')).toBe('Reset to north. Bearing 315°, tilt 30°')

        await unmount()
    })

    test('calls the reset handler when clicked', async () => {
        const onResetNorth = vi.fn()
        const { container, unmount } = await mount(
            <MapControlBar onResetNorth={onResetNorth} camera={{ bearing: 20, pitch: 0 }} />,
        )

        await click(compassButton(container)!)

        expect(onResetNorth).toHaveBeenCalledTimes(1)

        await unmount()
    })
})
