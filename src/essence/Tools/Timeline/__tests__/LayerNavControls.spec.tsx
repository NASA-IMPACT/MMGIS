import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * A layer row's first/previous/next/last controls: which of them are live,
 * what each one is called, and the instant a press reports.
 *
 * The process timezone is pinned behind UTC so that a control resolving its
 * target in local time would surface here as a wrong instant, rather than
 * passing on a UTC host and failing for a viewer in the Americas.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/New_York'
})

import { LayerNavControls } from '../lib/geo/LayerNavControls/LayerNavControls'
import type { LayerNavigation } from '../lib/utils/layerNavigation'
import type { TimeMode } from '../lib/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

/** A sparse model whose stops close the listed days, as the resolver builds. */
const sparseNav = (...days: string[]): LayerNavigation => {
    const stops = days.map((day) => new Date(`${day}T23:59:59.999Z`))
    return {
        kind: 'sparse',
        stops,
        start: stops[0],
        end: stops[stops.length - 1],
    }
}

const periodicNav = (start: string, end: string): LayerNavigation => ({
    kind: 'periodic',
    start: new Date(start),
    end: new Date(end),
})

const SPARSE = sparseNav('2020-01-02', '2020-03-04', '2020-11-02')

describe('LayerNavControls', () => {
    let container: HTMLElement
    let root: Root
    let committed: Date[]

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        committed = []
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (
        from: string,
        navigation: LayerNavigation = SPARSE,
        displayName = 'MODIS Daily',
        timeMode: TimeMode = 'DAY'
    ) => {
        act(() => {
            root.render(
                <LayerNavControls
                    displayName={displayName}
                    navigation={navigation}
                    from={new Date(from)}
                    timeMode={timeMode}
                    onNavigate={(date) => committed.push(date)}
                />,
            )
        })
    }

    const buttons = () =>
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))

    const labels = () =>
        buttons().map((button) => button.getAttribute('aria-label'))

    const press = (label: string) => {
        const button = buttons().find(
            (candidate) => candidate.getAttribute('aria-label') === label,
        )!
        // Dispatched rather than clicked so that a control disabled in name
        // only — through aria-disabled, say — would still deliver the event
        // and be caught.
        act(() => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
    }

    test('draws the four controls in transport order', () => {
        render('2020-05-01T00:00:00Z')

        expect(labels()).toEqual([
            'MODIS Daily: first date',
            'MODIS Daily: previous date',
            'MODIS Daily: next date',
            'MODIS Daily: last date',
        ])
    })

    test('names its own layer, so rows stay apart in a list of controls', () => {
        // A sidebar of layers puts four identically shaped buttons on every
        // row; only the layer's name tells a listener which row they are on.
        render('2020-05-01T00:00:00Z', SPARSE, 'Sentinel-2 True Color')

        expect(labels()).toEqual([
            'Sentinel-2 True Color: first date',
            'Sentinel-2 True Color: previous date',
            'Sentinel-2 True Color: next date',
            'Sentinel-2 True Color: last date',
        ])
    })

    /**
     * A control with nowhere to go says so with aria-disabled rather than
     * carrying the disabled attribute, so that it keeps focus; see the
     * keyboard test below.
     */
    const inert = () =>
        buttons().map(
            (button) => button.getAttribute('aria-disabled') === 'true',
        )

    test('leaves every control live from between the layer stops', () => {
        render('2020-05-01T00:00:00Z')

        expect(inert()).toEqual([false, false, false, false])
    })

    test('draws a control with nowhere to go inert', () => {
        // Sitting on the first stop, both backward controls and the jump to
        // that same stop lead nowhere.
        render('2020-01-02T23:59:59.999Z')

        expect(inert()).toEqual([true, true, false, false])
    })

    test('goes inert in every direction on a layer holding one instant', () => {
        render('2020-03-04T23:59:59.999Z', sparseNav('2020-03-04'))

        expect(inert()).toEqual([true, true, true, true])
    })

    test('reports the instant the pressed control leads to', () => {
        render('2020-05-01T00:00:00Z')
        press('MODIS Daily: next date')

        expect(committed.map((date) => date.toISOString())).toEqual([
            '2020-11-02T23:59:59.999Z',
        ])
    })

    test('reports each control its own instant', () => {
        render('2020-05-01T00:00:00Z')
        press('MODIS Daily: first date')
        press('MODIS Daily: previous date')
        press('MODIS Daily: last date')

        expect(committed.map((date) => date.toISOString())).toEqual([
            '2020-01-02T23:59:59.999Z',
            '2020-03-04T23:59:59.999Z',
            '2020-11-02T23:59:59.999Z',
        ])
    })

    test('stays silent when a control with nowhere to go is pressed', () => {
        render('2020-11-02T23:59:59.999Z')
        press('MODIS Daily: next date')
        press('MODIS Daily: last date')

        expect(committed).toEqual([])
    })

    test('moves through a periodic layer by the timeline granularity', () => {
        // The distance a press covers is the navigation model's answer, not
        // the row's: the same press moves an hour or a day with the mode.
        render(
            '2020-05-15T12:00:00Z',
            periodicNav('2020-01-01T00:00:00Z', '2020-12-31T00:00:00Z'),
            'MODIS Daily',
            'HOUR',
        )
        press('MODIS Daily: next date')

        render(
            '2020-05-15T12:00:00Z',
            periodicNav('2020-01-01T00:00:00Z', '2020-12-31T00:00:00Z'),
            'MODIS Daily',
            'MONTH',
        )
        press('MODIS Daily: next date')

        expect(committed.map((date) => date.toISOString())).toEqual([
            '2020-05-15T13:00:00.000Z',
            '2020-06-15T12:00:00.000Z',
        ])
    })

    test('keeps a live control reachable by keyboard', () => {
        // The row reveals the controls with opacity so that they stay in the
        // tab order while unrevealed; nothing may take them out of it.
        //
        // This reaches the markup only. No stylesheet is applied here, so a
        // reveal switched to display or visibility -- which would genuinely
        // drop the buttons out of the tab order -- still passes. Only a real
        // browser can hold that half of the guarantee.
        render('2020-05-01T00:00:00Z')
        const next = buttons().find(
            (button) =>
                button.getAttribute('aria-label') === 'MODIS Daily: next date',
        )!

        expect(next.tabIndex).toBe(0)
        next.focus()
        expect(document.activeElement).toBe(next)
    })

    test('keeps the control a viewer walked to the end of a layer with', () => {
        // Pressing "next date" repeatedly reaches the last stop, where that
        // very control has nowhere left to go. A browser blurs an element the
        // moment it gains the disabled attribute, and the row reveals its
        // controls on :focus-within, so disabling the pressed control would
        // drop focus to the document and fade the whole group out from under
        // the viewer. The control states its inertness instead of enforcing
        // it, and stays a focusable element.
        render('2020-03-04T23:59:59.999Z')
        const next = buttons().find(
            (button) =>
                button.getAttribute('aria-label') === 'MODIS Daily: next date',
        )!
        next.focus()

        render('2020-11-02T23:59:59.999Z')

        expect(next.getAttribute('aria-disabled')).toBe('true')
        expect(next.disabled).toBe(false)
        expect(next.tabIndex).toBe(0)
        expect(document.activeElement).toBe(next)
    })
})
