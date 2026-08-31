import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'

/**
 * MMGIS stores every instant in UTC, so the picker must read and write UTC no
 * matter where the viewer sits.
 *
 * The process timezone is pinned to America/Los_Angeles, which sits behind UTC
 * all year, and is set inside a hoisted block so it lands before the component
 * and moment are imported. Without that pin these cases inherit whatever zone
 * the machine runs in: on a UTC host — the default for most CI images and
 * containers — local and UTC formatting are identical, and a picker that
 * handled dates entirely in local time would pass anyway. Under this zone such
 * a regression surfaces as a wrong day or a shifted clock.
 */
vi.hoisted(() => {
    process.env.TZ = 'America/Los_Angeles'
})

import { DateSelector } from '../lib/geo/DateSelector/DateSelector'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const START = new Date('2024-01-01T00:00:00Z')
const END = new Date('2024-12-31T23:59:00Z')

describe('DateSelector timezone', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (selected: Date, timeMode: 'DAY' | 'HOUR') => {
        act(() => {
            root.render(
                <DateSelector
                    selectedDate={selected}
                    startTime={START}
                    endTime={END}
                    timeMode={timeMode}
                    onDateChange={() => {}}
                />,
            )
        })
    }

    const dateText = () =>
        container.querySelector('.date-text')?.textContent

    test('HOUR mode shows the UTC clock, not the local one', () => {
        render(new Date('2024-10-31T14:30:00Z'), 'HOUR')
        expect(dateText()).toBe('Oct 31, 2024, 14:30')
    })

    test('DAY mode shows the UTC day, not the local one', () => {
        // 02:00Z on Jan 1 is still Dec 31 in America/Los_Angeles.
        render(new Date('2024-01-01T02:00:00Z'), 'DAY')
        expect(dateText()).toBe('Jan 1, 2024')
    })
})

describe('DateSelector compare affordance', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (onCompareClick?: () => void) => {
        act(() => {
            root.render(
                <DateSelector
                    selectedDate={new Date('2024-10-31T14:30:00Z')}
                    startTime={START}
                    endTime={END}
                    timeMode="HOUR"
                    onDateChange={() => {}}
                    onCompareClick={onCompareClick}
                />,
            )
        })
    }

    const compareButton = () =>
        container.querySelector<HTMLButtonElement>('.compare-date-button')

    test('stays hidden when no handler is supplied', () => {
        render()
        expect(compareButton()).toBeNull()
        expect(container.querySelector('.date-selector-divider')).toBeNull()
    })

    test('appears and reports clicks when a handler is supplied', () => {
        let clicks = 0
        render(() => { clicks += 1 })
        const button = compareButton()
        expect(button).not.toBeNull()
        act(() => { button!.click() })
        expect(clicks).toBe(1)
    })
})

/**
 * The display cases above only prove the read path. These drive the popover and
 * assert on the instant handed back, closing parse -> range clamp -> emit, where
 * a local-zone slip would otherwise be invisible: nothing on screen changes, the
 * timeline just moves to the wrong instant.
 */
describe('DateSelector round trip', () => {
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

    const render = (selected: Date, start = START, end = END) => {
        act(() => {
            root.render(
                <DateSelector
                    selectedDate={selected}
                    startTime={start}
                    endTime={end}
                    timeMode="HOUR"
                    onDateChange={(date) => committed.push(date)}
                />,
            )
        })
    }

    // FloatingPopover portals to document.body, so the popover's controls are
    // outside the render container.
    const openPopover = () => {
        act(() => {
            container
                .querySelector<HTMLButtonElement>('.date-selector-main-button')!
                .click()
        })
    }

    const timeInput = () =>
        document.body.querySelector<HTMLInputElement>('input[type="time"]')!

    const dayCell = (label: string) =>
        Array.from(
            document.body.querySelectorAll<HTMLButtonElement>(
                '.day-calendar-grid .day-calendar-cell',
            ),
        ).find((cell) => cell.textContent === label)!

    // React tracks the last value it wrote to an input, so assigning through the
    // prototype setter is what makes it see the change as a real one.
    const typeInto = (input: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        )!.set!
        act(() => {
            setter.call(input, value)
            input.dispatchEvent(new Event('input', { bubbles: true }))
        })
    }

    test('a typed time commits that clock reading in UTC', () => {
        render(new Date('2024-10-31T14:30:00Z'))
        openPopover()
        typeInto(timeInput(), '09:15')
        expect(committed).toHaveLength(1)
        expect(committed[0].toISOString()).toBe('2024-10-31T09:15:00.000Z')
    })

    test('a picked day keeps the UTC clock and moves only the date', () => {
        render(new Date('2024-10-31T14:30:00Z'))
        openPopover()
        act(() => dayCell('15').click())
        expect(committed).toHaveLength(1)
        expect(committed[0].toISOString()).toBe('2024-10-15T14:30:00.000Z')
    })

    test('the highlighted day is the UTC day, not the local one', () => {
        // 02:00Z on Oct 16 is still Oct 15 in America/Los_Angeles.
        render(new Date('2024-10-16T02:00:00Z'))
        openPopover()
        const selected = document.body.querySelector(
            '.day-calendar-cell--selected',
        )
        expect(selected?.textContent).toBe('16')
    })

    test('a time before the range start clamps to the start instant', () => {
        // A range opening mid-day leaves the first day partly covered, so an
        // earlier clock reading on it snaps forward instead of being refused.
        const start = new Date('2024-03-10T12:00:00Z')
        render(new Date('2024-03-10T18:00:00Z'), start)
        openPopover()
        typeInto(timeInput(), '08:00')
        expect(committed).toHaveLength(1)
        expect(committed[0].toISOString()).toBe(start.toISOString())
    })
})

/**
 * The embedder here is controlled the way a real one is: it owns
 * `selectedDate`, feeds every pick back, and goes on passing the same
 * placeholder — which is what makes the wording's disappearance the
 * component's own doing.
 */
describe('DateSelector placeholder', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (placeholder?: string) => {
        let selected = new Date('2024-10-31T00:00:00Z')
        const draw = () => {
            root.render(
                <DateSelector
                    selectedDate={selected}
                    startTime={START}
                    endTime={END}
                    timeMode="DAY"
                    placeholder={placeholder}
                    onDateChange={(date) => {
                        selected = date
                        draw()
                    }}
                />,
            )
        }
        act(draw)
    }

    const dateText = () => container.querySelector('.date-text')?.textContent

    const pickDay = (label: string) => {
        act(() => {
            container
                .querySelector<HTMLButtonElement>('.date-selector-main-button')!
                .click()
        })
        // The popover portals to document.body.
        act(() => {
            Array.from(
                document.body.querySelectorAll<HTMLButtonElement>(
                    '.day-calendar-grid .day-calendar-cell',
                ),
            )
                .find((cell) => cell.textContent === label)!
                .click()
        })
    }

    test('stands in for the date the component was seeded with', () => {
        render('Select date')
        expect(dateText()).toBe('Select date')
    })

    test('gives way to the date once the user picks one', () => {
        render('Select date')
        pickDay('15')
        expect(dateText()).toBe('Oct 15, 2024')
    })

    test('an empty placeholder is no placeholder, not a blank button', () => {
        render('')
        expect(dateText()).toBe('Oct 31, 2024')
    })

    test('the date shows when no placeholder is given', () => {
        render()
        expect(dateText()).toBe('Oct 31, 2024')
    })
})
