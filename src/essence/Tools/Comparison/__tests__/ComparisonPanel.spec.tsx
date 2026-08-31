import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { ComparisonPanel } from '../lib/geo/ComparisonPanel/ComparisonPanel'
import type { ComparisonLayout } from '../lib/types'

/**
 * The panel is the surface a marketplace host embeds, so every case drives it
 * from props alone with no `window.mmgisAPI` present. What is covered here is
 * the layout control: which of the two choices reads as chosen, and that
 * picking one is reported rather than acted on.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const LAYERS = [
    { id: 'co2', title: 'CO₂' },
    { id: 'ch4', title: 'CH₄' },
]

describe('ComparisonPanel layout control', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.restoreAllMocks()
    })

    const render = (
        layout: ComparisonLayout,
        onLayoutChange?: (layout: ComparisonLayout) => void,
    ) => {
        act(() => {
            root.render(
                <ComparisonPanel
                    mode="layers"
                    layout={layout}
                    onLayoutChange={onLayoutChange}
                    layers={LAYERS}
                    leftLayerId="co2"
                    rightLayerId="ch4"
                />,
            )
        })
    }

    const button = (label: string) =>
        container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

    const swipe = () => button('Swipe comparison')
    const sideBySide = () => button('Side-by-side comparison')

    const click = (el: Element) => {
        act(() => {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
    }

    test('offers both layouts, marking the active one', () => {
        render('swipe')
        expect(swipe().getAttribute('aria-pressed')).toBe('true')
        expect(sideBySide().getAttribute('aria-pressed')).toBe('false')
    })

    test('moves the marking with the layout the host reports', () => {
        render('sideBySide')
        expect(swipe().getAttribute('aria-pressed')).toBe('false')
        expect(sideBySide().getAttribute('aria-pressed')).toBe('true')
    })

    // Either layout can be chosen at any time; neither is held shut.
    test('leaves both layouts reachable', () => {
        render('swipe')
        expect(swipe().disabled).toBe(false)
        expect(sideBySide().disabled).toBe(false)
    })

    test('reports the layout the user picks', () => {
        const onLayoutChange = vi.fn()
        render('swipe', onLayoutChange)

        click(sideBySide())
        expect(onLayoutChange).toHaveBeenCalledWith('sideBySide')

        click(swipe())
        expect(onLayoutChange).toHaveBeenLastCalledWith('swipe')
    })

    // The panel reflects the host's state rather than its own: it says what was
    // clicked and waits to be told the layout actually changed.
    test('does not mark a layout as active on its own', () => {
        render('swipe', vi.fn())
        click(sideBySide())
        expect(sideBySide().getAttribute('aria-pressed')).toBe('false')
    })

    test('renders with no layout callback wired', () => {
        render('swipe')
        expect(() => click(sideBySide())).not.toThrow()
        expect((window as { mmgisAPI?: unknown }).mmgisAPI).toBeUndefined()
    })
})

describe('ComparisonPanel dates tab', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.restoreAllMocks()
    })

    const WINDOW_START = new Date('2024-01-01T00:00:00Z')
    const WINDOW_END = new Date('2024-12-31T00:00:00Z')
    const PRIMARY = new Date('2024-10-31T14:30:00Z')
    const COMPARE = new Date('2024-06-15T09:00:00Z')

    const render = (props: Record<string, unknown> = {}) => {
        act(() => {
            root.render(
                <ComparisonPanel
                    mode="dates"
                    timeEnabled
                    layout="swipe"
                    layers={LAYERS}
                    leftLayerId={null}
                    rightLayerId={null}
                    timeWindowStart={WINDOW_START}
                    timeWindowEnd={WINDOW_END}
                    primaryDate={PRIMARY}
                    compareDate={null}
                    {...props}
                />,
            )
        })
    }

    const swap = () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Swap views"]')!

    const datesTab = () =>
        [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) =>
            t.textContent?.includes('Compare dates'),
        )!

    /**
     * Drive one row's picker the way a user does: open it, then choose a day in
     * the calendar. The popover portals to the document, so the calendar is
     * looked up there rather than inside the panel.
     */
    const pickDay = (variant: 'primary' | 'compare', day: number) => {
        const open = container.querySelector<HTMLButtonElement>(
            `.blocks-comparison__date-row--${variant} .date-selector-main-button`,
        )!
        act(() => {
            open.click()
        })
        const cell = [
            ...document.querySelectorAll<HTMLButtonElement>('.day-calendar-cell'),
        ].find((c) => c.textContent === String(day))!
        act(() => {
            cell.click()
        })
    }

    test('shows both date rows instead of the layer dropdowns', () => {
        render()
        expect(container.querySelectorAll('.blocks-comparison__select').length).toBe(0)
        expect(container.querySelector('.blocks-comparison__date-row--primary')).not.toBeNull()
        expect(container.querySelector('.blocks-comparison__date-row--compare')).not.toBeNull()
    })

    /**
     * The invitation is the picker's own wording, so the one thing in the row
     * is the control that acts on it: one tab stop, named by the row's label,
     * and the same box before and after a date lands in it.
     */
    test('invites a second date on the control that accepts one', () => {
        render()
        const row = container.querySelector('.blocks-comparison__date-row--compare')!

        expect(row.querySelector('.blocks-comparison__date-placeholder')).toBeNull()
        const trigger = row.querySelector<HTMLButtonElement>(
            '.date-selector-main-button',
        )!
        expect(trigger.textContent).toBe('Pick a day to compare')
        expect(row.querySelectorAll('button, input, select, [role="button"]').length).toBe(1)
    })

    // The two states share one box, so the row keeps its height as the second
    // date is filled in.
    test('offers the same picker before and after the second date is set', () => {
        const picker = () =>
            container.querySelector(
                '.blocks-comparison__date-row--compare .blocks-comparison__date-selector',
            )

        render()
        expect(picker()).not.toBeNull()

        render({ compareDate: COMPARE })
        expect(picker()).not.toBeNull()
        expect(picker()?.querySelector('.date-text')?.textContent).toBe(
            'Jun 15, 2024, 09:00',
        )
    })

    /**
     * A comparison across dates is reachable only through this row: the second
     * date starts unset and nothing else can set it. A row that offered no
     * picker until it already held a date could never be given one.
     */
    test('reports the first date picked for the second side', () => {
        const onCompareDateChange = vi.fn()
        render({ compareDate: null, onCompareDateChange })

        pickDay('compare', 20)

        expect(onCompareDateChange).toHaveBeenCalledTimes(1)
        const picked = onCompareDateChange.mock.calls[0][0]
        expect(picked).toBeInstanceOf(Date)
        // The calendar opens on the date the first side is reading, so the day
        // picked lands in that month.
        expect(picked.toISOString()).toBe('2024-10-20T14:30:00.000Z')
    })

    // With no date of the host's own to open beside, the window's closing
    // instant stands in, so the row is still pickable.
    test('offers a picker for the second date with no first date to open beside', () => {
        const onCompareDateChange = vi.fn()
        render({ primaryDate: null, compareDate: null, onCompareDateChange })

        pickDay('compare', 5)

        expect(onCompareDateChange.mock.calls[0][0].toISOString()).toBe(
            '2024-12-05T00:00:00.000Z',
        )
    })

    test('swap waits for both dates', () => {
        render()
        expect(swap().disabled).toBe(true)

        // A host that has not sent its own date yet has nothing to move either.
        render({ primaryDate: null, compareDate: COMPARE })
        expect(swap().disabled).toBe(true)

        render({ compareDate: COMPARE })
        expect(swap().disabled).toBe(false)
    })

    test('offers a picker for the date the host is showing', () => {
        render()
        const picker = container.querySelector(
            '.blocks-comparison__date-row--primary .blocks-comparison__date-selector',
        )
        expect(picker).not.toBeNull()
        expect(picker?.querySelector('.date-text')?.textContent).toBe(
            'Oct 31, 2024, 14:30',
        )
    })

    // A picker has nothing to clamp against until the window is read, so a date
    // on its own is not enough to draw one.
    test.each([
        ['opening', { timeWindowStart: null }],
        ['closing', { timeWindowEnd: null }],
    ])('waits for the window\'s %s bound before offering a picker', (_, props) => {
        render(props)
        const row = container.querySelector('.blocks-comparison__date-row--primary')!
        expect(row.querySelector('.blocks-comparison__date-selector')).toBeNull()
        expect(row.querySelector('.blocks-comparison__date-placeholder')).not.toBeNull()
    })

    test('reports a date picked for the first side', () => {
        const onPrimaryDateChange = vi.fn()
        render({ onPrimaryDateChange })

        pickDay('primary', 15)
        expect(onPrimaryDateChange).toHaveBeenCalledTimes(1)
        expect(onPrimaryDateChange.mock.calls[0][0].toISOString()).toBe(
            '2024-10-15T14:30:00.000Z',
        )
    })

    test('reports a date picked for the second side', () => {
        const onCompareDateChange = vi.fn()
        render({ compareDate: COMPARE, onCompareDateChange })

        pickDay('compare', 20)
        expect(onCompareDateChange).toHaveBeenCalledTimes(1)
        expect(onCompareDateChange.mock.calls[0][0].toISOString()).toBe(
            '2024-06-20T09:00:00.000Z',
        )
    })

    test('the dates tab is unavailable when the mission has no time', () => {
        render({ mode: 'layers', timeEnabled: false })
        expect(datesTab().disabled).toBe(true)
        expect(datesTab().title).toBe('This map has no timeline to compare across')
    })

    // A host still reading its timeline knows nothing yet, so the tab says it is
    // waiting rather than claiming the mission has no timeline.
    test('the dates tab reads as waiting while the host is still looking', () => {
        render({ mode: 'layers', timeEnabled: false, timeStatus: 'loading' })
        expect(datesTab().disabled).toBe(true)
        expect(datesTab().title).not.toBe('This map has no timeline to compare across')
        expect(datesTab().title).not.toBe('')
    })

    test('the layers tab still shows its dropdowns', () => {
        render({ mode: 'layers', leftLayerId: 'co2', rightLayerId: 'ch4' })
        expect(container.querySelectorAll('.blocks-comparison__select').length).toBe(2)
    })
})

/**
 * Swap is a toggle over which side of the divider each choice draws on, not a
 * reordering of the choices: the rows stay where the user set them and the
 * button's own pressed state is what says the sides are reversed. The panel
 * reflects that state rather than holding it, so every case here drives it from
 * props.
 */
describe('ComparisonPanel swap control', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.restoreAllMocks()
    })

    const render = (props: Record<string, unknown> = {}) => {
        act(() => {
            root.render(
                <ComparisonPanel
                    mode="layers"
                    layout="swipe"
                    layers={LAYERS}
                    leftLayerId="co2"
                    rightLayerId="ch4"
                    {...props}
                />,
            )
        })
    }

    const swap = () =>
        container.querySelector<HTMLButtonElement>(
            '.blocks-comparison__action-btn--swap',
        )!

    const selects = () =>
        [...container.querySelectorAll<HTMLSelectElement>('.blocks-comparison__select')]

    test('reads as unpressed while each side draws the choice beside it', () => {
        render()
        expect(swap().getAttribute('aria-pressed')).toBe('false')
        expect(swap().className).not.toContain('blocks-comparison__action-btn--active')
    })

    test('reads as pressed once the host reports the sides swapped', () => {
        render({ swapped: true })
        expect(swap().getAttribute('aria-pressed')).toBe('true')
        expect(swap().className).toContain('blocks-comparison__action-btn--active')
    })

    // The pressed state is the only thing on screen that says the sides are
    // reversed, so the button has to say it in words too.
    test('names which state it is in', () => {
        render()
        expect(swap().getAttribute('aria-label')).toBe('Swap views')
        expect(swap().title).toBe('Swap views')

        render({ swapped: true })
        expect(swap().getAttribute('aria-label')).toMatch(/swapped/i)
        expect(swap().title).toMatch(/swapped/i)
    })

    // The rows are the user's choices; swapping moves where they draw, so the
    // panel neither reorders them nor marks itself pressed on its own.
    test('reports the click without moving the choices or itself', () => {
        const onSwap = vi.fn()
        render({ onSwap })

        act(() => {
            swap().dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })

        expect(onSwap).toHaveBeenCalledTimes(1)
        expect(selects().map((s) => s.value)).toEqual(['co2', 'ch4'])
        expect(swap().getAttribute('aria-pressed')).toBe('false')
    })
})
