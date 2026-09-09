import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * A layer row's first/previous/next/last controls: which are live, what each
 * is called, and the instant a press reports.
 *
 * The process timezone is pinned behind UTC, so a control resolving its target
 * locally surfaces as a wrong instant here rather than passing on a UTC host
 * and failing for a viewer in the Americas.
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
    let reported: LayerNavigation[]

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        committed = []
        reported = []
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
                    onNavigate={(date, navigation) => {
                        committed.push(date)
                        reported.push(navigation)
                    }}
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
        // Dispatched rather than clicked: a control disabled in name only,
        // through aria-disabled, still delivers the event.
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
        // Every row carries the same four buttons; only the layer's name
        // tells a listener which row they are on.
        render('2020-05-01T00:00:00Z', SPARSE, 'Sentinel-2 True Color')

        expect(labels()).toEqual([
            'Sentinel-2 True Color: first date',
            'Sentinel-2 True Color: previous date',
            'Sentinel-2 True Color: next date',
            'Sentinel-2 True Color: last date',
        ])
    })

    /**
     * A control with nowhere to go carries aria-disabled rather than the
     * disabled attribute, so it keeps focus; see the keyboard test below.
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

    test('reports the model beside the instant, so a window knows what it opens onto', () => {
        render('2020-05-01T00:00:00Z')
        press('MODIS Daily: next date')

        expect(reported).toEqual([SPARSE])
    })

    test('stays silent when a control with nowhere to go is pressed', () => {
        render('2020-11-02T23:59:59.999Z')
        press('MODIS Daily: next date')
        press('MODIS Daily: last date')

        expect(committed).toEqual([])
    })

    test('moves through a periodic layer by the timeline granularity', () => {
        // The distance is the model's answer, not the row's: the same press
        // moves an hour or a day with the mode.
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
        // The controls are revealed with opacity, so they stay in the tab
        // order while unrevealed. This reaches the markup only: with no
        // stylesheet applied, a reveal switched to display or visibility would
        // still pass here. Only a real browser holds that half.
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
        // Pressing "next date" to the last stop leaves that control with
        // nowhere to go. A browser blurs an element the moment it gains the
        // disabled attribute, and the row reveals on :focus-within, so
        // disabling it would fade the group out from under the viewer.
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
