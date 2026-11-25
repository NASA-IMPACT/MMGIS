import React from 'react'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { ColorRampPicker } from '../lib/geo/ColorRampPicker/ColorRampPicker'
import { setColormapSource } from '../lib/utils/colormapSource'
import { mount } from '../../_shared/__tests__/reactHarness'

afterEach(() => setColormapSource(null))

/** The gradient a ramp's swatch draws, found by its label. */
const swatchOf = (container: HTMLElement, label: string): string => {
    const row = [...container.querySelectorAll('.blocks-color-ramp-picker__ramp')].find(
        (el) => el.textContent?.trim() === label,
    )
    const swatch = row?.querySelector<HTMLElement>('.blocks-color-ramp-picker__swatch')
    return swatch?.style.background ?? ''
}

describe('ColorRampPicker', () => {
    // Picking a ramp with no reversed form applies it forward, so its swatch
    // has to show it forward too, whatever the toggle says.
    test('previews a ramp with no reversed form forward while Reverse is on', async () => {
        setColormapSource({
            list: async () => ['viridis', 'viridis_r', 'naqfc_pm25'],
            colors: async () => ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'],
        })
        const { container, unmount } = await mount(
            <ColorRampPicker layerId="a" colormap="viridis_r" min={1} max={18} />,
        )

        await vi.waitFor(() => expect(swatchOf(container, 'Naqfc pm25')).not.toBe(''))
        expect(swatchOf(container, 'Viridis')).toMatch(/^linear-gradient\(to right, rgb\(255, 255, 255\)/)
        expect(swatchOf(container, 'Naqfc pm25')).toMatch(/^linear-gradient\(to right, rgb\(0, 0, 0\)/)
        await unmount()
    })
})
