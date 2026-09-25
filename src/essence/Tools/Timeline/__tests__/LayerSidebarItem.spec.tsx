import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * One sidebar row: which controls it carries, and where a press is delivered.
 *
 * The process timezone is pinned behind UTC, as in every spec in this plugin.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import { LayerSidebarItem } from '../lib/geo/LayerSidebarItem/LayerSidebarItem'
import type { LayerNavigation } from '../lib/utils/layerNavigation'
import type { LayerTimeData } from '../lib/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const START = new Date('2020-01-01T00:00:00Z')
const END = new Date('2020-12-31T23:59:59.999Z')
const CURRENT = new Date('2020-05-01T00:00:00Z')

const periodicNav = (): LayerNavigation => ({
    kind: 'periodic',
    start: START,
    end: END,
    hasOwnStart: true,
    hasOwnEnd: true,
})

const layer = (
    name: string,
    navigation?: LayerNavigation | null
): LayerTimeData => ({
    name,
    displayName: name,
    timeRanges: [{ start: START, end: END }],
    color: '#00b3c8',
    navigation,
})

/** A layer that declares bounds of its own, and so gets the full set of controls. */
const SEA_ICE = layer('Sea Ice', periodicNav())

describe('LayerSidebarItem', () => {
    let container: HTMLElement
    let root: Root
    let fitted: LayerTimeData[]

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        fitted = []
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (target: LayerTimeData) => {
        act(() => {
            root.render(
                <LayerSidebarItem
                    layer={target}
                    height={20}
                    currentTime={CURRENT}
                    timeMode="DAY"
                    onNavigate={() => {}}
                    onFit={(l) => fitted.push(l)}
                />
            )
        })
    }

    const magnifier = () =>
        container.querySelector<HTMLButtonElement>('.layer-fit-btn')

    test('gives a layer that declares its own bounds a magnifier', () => {
        render(SEA_ICE)

        expect(magnifier()).not.toBeNull()
        expect(magnifier()!.getAttribute('aria-label')).toBe(
            'Sea Ice: fit to this layer'
        )
    })

    test('leaves a layer with no bounds of its own showing only the dot', () => {
        // The condition is exactly "this layer declares bounds of its own", so
        // the control never appears where fitting would frame the global window
        // and do nothing.
        render(layer('Basemap'))

        expect(magnifier()).toBeNull()
        expect(container.querySelector('.layer-color-dot')).not.toBeNull()
    })

    test('reaches the keyboard as a real button', () => {
        render(SEA_ICE)

        const button = magnifier()!
        expect(button.tagName).toBe('BUTTON')
        expect(button.getAttribute('type')).toBe('button')
        expect(button.hasAttribute('disabled')).toBe(false)

        // Exercised rather than inferred from the tag: a button with a
        // negative tabIndex is still a real, enabled button, yet Tab skips it,
        // which is exactly what a control revealed on focus must never be.
        expect(button.tabIndex).toBe(0)
        button.focus()
        expect(document.activeElement).toBe(button)
    })

    test('hands its own layer to the fit callback', () => {
        render(SEA_ICE)

        act(() => {
            magnifier()!.dispatchEvent(
                new MouseEvent('click', { bubbles: true })
            )
        })

        expect(fitted).toEqual([SEA_ICE])
    })

    test('keeps the row the height it is given', () => {
        render(SEA_ICE)

        const row = container.querySelector<HTMLElement>('.layer-item')!
        expect(row.style.height).toBe('20px')
    })

    test('carries the four navigation controls for a layer with bounds', () => {
        render(SEA_ICE)

        const labels = Array.from(
            container.querySelectorAll<HTMLButtonElement>('.layer-nav-btn')
        ).map((button) => button.getAttribute('aria-label'))

        expect(labels).toEqual([
            'Sea Ice: first date',
            'Sea Ice: previous date',
            'Sea Ice: next date',
            'Sea Ice: last date',
        ])
    })
})
