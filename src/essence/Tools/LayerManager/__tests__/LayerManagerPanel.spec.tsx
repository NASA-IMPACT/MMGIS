import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { LayerManagerPanel } from '../lib/geo/LayerManagerPanel/LayerManagerPanel'
import type { Layer } from '../lib/types'
import { mount, click } from '../../_shared/__tests__/reactHarness'

/**
 * The portability proof for the plugin's UI.
 *
 * Every case mounts the panel with no host present — no `window.mmgisAPI`, no
 * `window.mmgisglobal` — driving it purely from a `Layer[]` and callbacks. The
 * panel is the surface a marketplace host embeds, so anything it needs beyond
 * its props is a dependency that host would have to supply.
 */

const GRADIENT_LAYER: Layer = {
    id: 'Displacement_0123456789abcdef',
    title: 'Displacement',
    description: 'Vertical displacement',
    opacity: 1,
    visible: true,
    type: 'gradient',
    stops: ['#000000', '#ffffff'],
    min: 0,
    max: 10,
    unit: { label: 'm' },
    cog: null,
}

const editableCogLayer = (): Layer => ({
    ...GRADIENT_LAYER,
    id: 'Editable_fedcba9876543210',
    title: 'Editable',
    stops: null,
    cog: {
        isCog: true,
        editable: true,
        colormap: 'viridis',
        min: 0,
        max: 10,
        defaultMin: 0,
        defaultMax: 10,
        defaultColormap: 'viridis',
        units: 'm',
        titilerUrl: null,
        localColormaps: null,
        deckRaster: false,
    },
})

const readOnlyCogLayer = (): Layer => {
    const layer = editableCogLayer()
    return {
        ...layer,
        id: 'ReadOnly_00112233445566',
        title: 'Read only',
        cog: { ...layer.cog!, editable: false },
    }
}

const titlesIn = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.blocks-layer-legend__title')).map(
        (el) => el.textContent,
    )

const rampButtonsIn = (container: HTMLElement) =>
    container.querySelectorAll('[title="Change color ramp"]')

beforeEach(() => {
    // Deleted rather than stubbed, so calling through either one throws.
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    delete (window as { mmgisglobal?: unknown }).mmgisglobal
    global.fetch = vi.fn(async () => {
        throw new Error('the panel must not reach the network to render')
    }) as never
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('LayerManagerPanel without a host', () => {
    test('renders layers from props alone', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel layers={[GRADIENT_LAYER, editableCogLayer()]} />,
        )

        expect(titlesIn(container)).toEqual(['Displacement', 'Editable'])
        expect(container.querySelector('.blocks-layer-legend__unit-label')?.textContent)
            .toBe('m')
        await unmount()
    })

    // The behavioral half of the isolation guarantee. Catching a *read* of a
    // host global takes static analysis, since an optional read of an absent
    // global is silent — libBoundary.spec.js covers that half.
    test('mounts with no host global to read and no network to call', async () => {
        const { unmount } = await mount(
            <LayerManagerPanel layers={[GRADIENT_LAYER, editableCogLayer()]} />,
        )

        expect((window as { mmgisAPI?: unknown }).mmgisAPI).toBeUndefined()
        expect((window as { mmgisglobal?: unknown }).mmgisglobal).toBeUndefined()
        expect(global.fetch).not.toHaveBeenCalled()
        await unmount()
    })

    test('reports visibility changes through its callback', async () => {
        const onVisibilityChange = vi.fn()
        const { container, unmount } = await mount(
            <LayerManagerPanel
                layers={[GRADIENT_LAYER]}
                onVisibilityChange={onVisibilityChange}
            />,
        )

        const checkbox = container.querySelector('.blocks-layer-legend__checkbox')!
        await click(checkbox)

        expect(onVisibilityChange).toHaveBeenCalledWith(GRADIENT_LAYER.id, false)
        await unmount()
    })

    test('offers the ramp control only for a layer whose colormap is editable', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel layers={[editableCogLayer()]} />,
        )
        expect(rampButtonsIn(container)).toHaveLength(1)
        await unmount()

        const readOnly = await mount(
            <LayerManagerPanel layers={[readOnlyCogLayer()]} />,
        )
        expect(rampButtonsIn(readOnly.container)).toHaveLength(0)
        expect(titlesIn(readOnly.container)).toEqual(['Read only'])
        await readOnly.unmount()
    })

    test('shows the caller-supplied empty message with no layers', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel layers={[]} emptyMessage="Nothing to manage." />,
        )

        expect(container.querySelector('.blocks-layer-legend-list__empty')?.textContent)
            .toBe('Nothing to manage.')
        await unmount()
    })

    test('shows a loading state instead of the list while loading', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel layers={[]} loading />,
        )

        expect(container.querySelector('.mmgisLoading')).not.toBeNull()
        expect(container.querySelector('.blocks-layer-legend-list')).toBeNull()
        await unmount()
    })

    test('renders without any callbacks wired', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel layers={[GRADIENT_LAYER]} />,
        )

        const checkbox = container.querySelector('.blocks-layer-legend__checkbox')!
        await expect(click(checkbox)).resolves.toBeUndefined()
        await unmount()
    })
})
