import React, { act } from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { LayerManagerPanel } from '../lib/geo/LayerManagerPanel/LayerManagerPanel'
import type { Layer } from '../lib/types'
import { mount, type Mounted } from '../../_shared/__tests__/reactHarness'

const layer = (id: string, outOfDataRange?: boolean): Layer => ({
    id,
    title: id,
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
    outOfDataRange,
})

const warnings = (container: HTMLElement) =>
    Array.from(
        container.querySelectorAll<HTMLButtonElement>(
            '.blocks-layer-legend__coverage-warning',
        ),
    )

const popovers = () =>
    document.body.querySelectorAll('.blocks-layer-legend__coverage-popover')

let mounted: Mounted | null = null

afterEach(async () => {
    await mounted?.unmount()
    mounted = null
})

describe('the no-data warning on a layer row', () => {
    test('shows only on a switched-on layer that is out of range', async () => {
        mounted = await mount(
            <LayerManagerPanel
                layers={[
                    layer('Suppressed', true),
                    layer('InRange', false),
                    layer('Unknown'),
                ]}
            />,
        )
        const { container } = mounted
        expect(warnings(container)).toHaveLength(1)
        expect(warnings(container)[0].getAttribute('aria-label')).toBe(
            'Suppressed: Data not available for the selected time',
        )

        const checkbox = container.querySelector<HTMLInputElement>(
            '[data-legend-id="Suppressed"] .blocks-layer-legend__checkbox',
        )!
        await act(async () => checkbox.click())
        expect(warnings(container)).toHaveLength(0)
    })

    test('opens on focus naming the selected time, and closes on Escape', async () => {
        mounted = await mount(
            <LayerManagerPanel
                layers={[layer('Suppressed', true)]}
                selectedTime="2024-10-31T14:00:00Z"
            />,
        )
        const [warning] = warnings(mounted.container)

        await act(async () => warning.focus())
        expect(popovers()).toHaveLength(1)
        expect(popovers()[0].textContent).toBe(
            'Data not available for Oct 31, 2024 14:00 UTC',
        )

        await act(async () => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
            )
        })
        expect(popovers()).toHaveLength(0)
    })

    test('hands focus to the checkbox when the layer comes back into range', async () => {
        mounted = await mount(
            <LayerManagerPanel layers={[layer('Suppressed', true)]} />,
        )
        const [warning] = warnings(mounted.container)
        await act(async () => warning.focus())

        await mounted.rerender(
            <LayerManagerPanel layers={[layer('Suppressed', false)]} />,
        )
        expect(popovers()).toHaveLength(0)
        expect(document.activeElement).toBe(
            mounted.container.querySelector('.blocks-layer-legend__checkbox'),
        )
    })
})
