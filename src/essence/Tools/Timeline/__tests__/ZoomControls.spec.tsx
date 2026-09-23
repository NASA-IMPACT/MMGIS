import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

import {
    ZoomControls,
    type ZoomControlsProps,
} from '../lib/geo/ZoomControls/ZoomControls'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const DAY = 86400000

describe('ZoomControls', () => {
    let container: HTMLElement
    let root: Root
    let pressed: string[]
    let slid: number[]

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        pressed = []
        slid = []
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (over: Partial<ZoomControlsProps> = {}) => {
        const props: ZoomControlsProps = {
            sliderValue: 0.5,
            spanMs: 14 * DAY,
            canZoom: true,
            canFit: true,
            autoFit: true,
            onZoomIn: () => pressed.push('in'),
            onZoomOut: () => pressed.push('out'),
            onSliderChange: (v) => slid.push(v),
            onToggleAutoFit: () => pressed.push('toggle'),
            onFitNow: () => pressed.push('fit'),
            ...over,
        }
        act(() => {
            root.render(<ZoomControls {...props} />)
        })
    }

    const byLabel = (label: string) =>
        container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

    const slider = () =>
        container.querySelector<HTMLInputElement>('input[type="range"]')!

    test('reads the visible span aloud rather than the raw slider position', () => {
        render({ spanMs: 14 * DAY })

        expect(slider().getAttribute('aria-valuetext')).toBe('14 days')
    })

    test('disables zooming out at the full window and in at the floor', () => {
        render({ sliderValue: 0 })
        expect(byLabel('Zoom out').disabled).toBe(true)
        expect(byLabel('Zoom in').disabled).toBe(false)

        render({ sliderValue: 1 })
        expect(byLabel('Zoom out').disabled).toBe(false)
        expect(byLabel('Zoom in').disabled).toBe(true)
    })

    test('disables every zoom control when the window has no travel', () => {
        // A degenerate global window leaves one reachable position.
        render({ canZoom: false, sliderValue: 0 })

        expect(byLabel('Zoom out').disabled).toBe(true)
        expect(byLabel('Zoom in').disabled).toBe(true)
        expect(slider().disabled).toBe(true)
    })

    test('states whether auto-fit is armed', () => {
        render({ autoFit: true })
        expect(byLabel('Auto-fit to visible layers').getAttribute('aria-pressed')).toBe('true')

        render({ autoFit: false })
        expect(byLabel('Auto-fit to visible layers').getAttribute('aria-pressed')).toBe('false')
    })

    test('disables the one-shot fit when no layer carries its own bounds', () => {
        // The same condition that makes an automatic refit a no-op.
        render({ canFit: false })

        expect(byLabel('Fit to visible layers').disabled).toBe(true)
    })

    test('delivers one press to each control', () => {
        render()

        for (const label of [
            'Zoom out',
            'Zoom in',
            'Auto-fit to visible layers',
            'Fit to visible layers',
        ])
            act(() => {
                byLabel(label).dispatchEvent(
                    new MouseEvent('click', { bubbles: true }),
                )
            })

        expect(pressed).toEqual(['out', 'in', 'toggle', 'fit'])
    })

    test('reports the position the slider was moved to', () => {
        render()

        // React tracks the last value it wrote to an input, so assigning
        // through the prototype setter is what makes it see the change as a
        // real one.
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!
        act(() => {
            const input = slider()
            setter.call(input, '0.75')
            input.dispatchEvent(new Event('input', { bubbles: true }))
        })

        expect(slid).toEqual([0.75])
    })
})
