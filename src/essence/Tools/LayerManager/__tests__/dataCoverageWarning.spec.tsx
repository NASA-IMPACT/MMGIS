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
        container.querySelectorAll<HTMLElement>(
            '.blocks-layer-legend__coverage-warning',
        ),
    )

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

    // The message is a label, not something to open, so the selected time has
    // to reach it without any interaction.
    test('labels the mark with the selected time', async () => {
        mounted = await mount(
            <LayerManagerPanel
                layers={[layer('Suppressed', true)]}
                selectedTime="2024-10-31T14:00:00Z"
            />,
        )
        const [warning] = warnings(mounted.container)

        expect(warning.getAttribute('title')).toBe(
            'Data not available for Oct 31, 2024 14:00 UTC',
        )
        expect(warning.getAttribute('aria-label')).toBe(
            'Suppressed: Data not available for Oct 31, 2024 14:00 UTC',
        )
    })

    // It offers no action, so it stays out of the tab order — no focus to
    // strand when the layer comes back into range.
    test('takes no focus', async () => {
        mounted = await mount(
            <LayerManagerPanel layers={[layer('Suppressed', true)]} />,
        )
        const [warning] = warnings(mounted.container)

        expect(warning.tagName).toBe('SPAN')
        expect(warning.hasAttribute('tabindex')).toBe(false)

        await mounted.rerender(
            <LayerManagerPanel layers={[layer('Suppressed', false)]} />,
        )
        expect(warnings(mounted.container)).toHaveLength(0)
    })
})
