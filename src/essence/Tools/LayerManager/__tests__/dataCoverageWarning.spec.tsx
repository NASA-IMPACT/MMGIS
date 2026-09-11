import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { LayerManagerPanel } from '../lib/geo/LayerManagerPanel/LayerManagerPanel'
import type { DataCoverage, Layer } from '../lib/types'
import { COVERAGE_POPOVER_CLOSE_DELAY_MS as CLOSE_DELAY } from '../lib/utils/constants'
import { mount as mountOnce, type Mounted } from '../../_shared/__tests__/reactHarness'

/**
 * The warning a row carries while its layer has no data at the time being
 * asked for. Mounted with no host present, like the rest of the panel's specs:
 * the row is handed the coverage it shows and a callback for reading it
 * afresh, and everything below is driven through those alone.
 */

const utc = (...parts: [number, number, number, number?, number?]) =>
    Date.UTC(...parts)

/**
 * Every panel still mounted, unmounted after each case. A case unmounts its
 * own at its end, which a failing assertion skips; a panel left behind keeps
 * its document-level Escape and press listeners acting on the cases after it.
 */
const mounted = new Set<Mounted>()

const mount = async (ui: React.ReactElement): Promise<Mounted> => {
    const handle = await mountOnce(ui)
    const tracked: Mounted = {
        ...handle,
        unmount: async () => {
            if (!mounted.delete(tracked)) return
            await handle.unmount()
        },
    }
    mounted.add(tracked)
    return tracked
}

const unmountAll = async () => {
    for (const handle of [...mounted]) await handle.unmount()
}

const ROW_WINDOW = { start: utc(2020, 3, 1), end: utc(2020, 3, 2) }

const outOfRange = (window = ROW_WINDOW): DataCoverage => ({
    outOfDataRange: true,
    kind: 'sparse',
    spans: [
        {
            start: utc(2020, 2, 4),
            end: utc(2020, 2, 5) - 1,
            at: utc(2020, 2, 4),
            unit: 'day',
        },
    ],
    requestedWindow: window,
})

const inRange = (): DataCoverage => ({
    ...outOfRange(),
    outOfDataRange: false,
})

const layer = (id: string, dataCoverage?: DataCoverage | null): Layer => ({
    id,
    title: id,
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
    dataCoverage,
})

const warningsIn = (container: HTMLElement) =>
    Array.from(
        container.querySelectorAll<HTMLButtonElement>(
            '.blocks-layer-legend__coverage-warning',
        ),
    )

const rowOf = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`[data-legend-id="${id}"]`)!

const popovers = () =>
    Array.from(
        document.body.querySelectorAll<HTMLElement>(
            '.blocks-layer-legend__coverage-popover',
        ),
    )

/**
 * A pointer event as React sees it. jsdom has no PointerEvent to construct,
 * so the type carries it and `pointerType` is set by hand.
 */
const pointer = (
    el: Element,
    type: string,
    pointerType: 'mouse' | 'touch' = 'mouse',
) => {
    const event = new MouseEvent(type, {
        bubbles: true,
        relatedTarget: document.body,
    })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    el.dispatchEvent(event)
}

const hover = async (el: Element) => {
    await act(async () => {
        pointer(el, 'pointerover')
    })
}

/** The pointer leaves; whatever it opened closes only after the delay. */
const unhover = async (el: Element) => {
    await act(async () => {
        pointer(el, 'pointerout')
    })
}

const elapse = async (ms: number) => {
    await act(async () => {
        vi.advanceTimersByTime(ms)
    })
}

/** Leave, and wait out the delay. */
const leave = async (el: Element) => {
    await unhover(el)
    await elapse(CLOSE_DELAY)
}

/**
 * A click from a mouse or a tap carries its click count; one from Enter or
 * Space on a focused button carries none.
 */
const clickEvent = (detail: number) =>
    new MouseEvent('click', { bubbles: true, detail })

/** A mouse click on an element that does not take focus from it. */
const click = async (el: Element) => {
    await act(async () => {
        el.dispatchEvent(clickEvent(1))
    })
}

/** Enter or Space on the focused icon. */
const pressEnter = async (el: Element) => {
    await act(async () => {
        el.dispatchEvent(clickEvent(0))
    })
}

/**
 * A press on the popover's text, with what a browser does unless told not
 * to: focus the nearest focusable element around it.
 */
const pressText = async (popover: HTMLElement) => {
    const text = popover.firstElementChild ?? popover
    let down!: MouseEvent
    await act(async () => {
        down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        text.dispatchEvent(down)
        if (!down.defaultPrevented) {
            text.closest<HTMLElement>('[tabindex]')?.focus()
        }
        text.dispatchEvent(clickEvent(1))
    })
    return down
}

/**
 * A tap: touch pointer events, focus, then the click they produce. Each step
 * is its own browser event, so each one's updates land before the next.
 */
const tap = async (el: HTMLElement) => {
    const steps = [
        () => pointer(el, 'pointerover', 'touch'),
        () => pointer(el, 'pointerdown', 'touch'),
        () => el.focus(),
        () => el.dispatchEvent(clickEvent(1)),
        () => pointer(el, 'pointerout', 'touch'),
    ]
    for (const step of steps) {
        await act(async () => {
            step()
        })
    }
}

/** A press anywhere outside the icon and its popover. */
const pressElsewhere = async () => {
    await act(async () => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
}

const pressEscape = async () => {
    await act(async () => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        )
    })
}

/** A promise whose settling the test controls. */
const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

beforeEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    delete (window as { mmgisglobal?: unknown }).mmgisglobal
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(async () => {
    await unmountAll()
    vi.useRealTimers()
    vi.restoreAllMocks()
    // Unmounting takes each panel's portals with it; anything still here
    // escaped React and would be counted by the next case.
    for (const el of popovers()) el.remove()
})

describe('the no-data warning on a layer row', () => {
    test('appears only on a row whose layer is out of its data range', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel
                layers={[
                    layer('Suppressed', outOfRange()),
                    layer('InRange', inRange()),
                    layer('NoRecord', null),
                    layer('NoField'),
                    layer('Unconstrained', {
                        outOfDataRange: false,
                        kind: null,
                        spans: null,
                        requestedWindow: ROW_WINDOW,
                    }),
                ]}
            />,
        )

        const warnings = warningsIn(container)
        expect(warnings).toHaveLength(1)
        expect(rowOf(container, 'Suppressed').contains(warnings[0])).toBe(true)
        await unmount()
    })

    // Nothing about the row changes besides the icon: no dimming class, the
    // checkbox as it was, every control where it was.
    test('leaves the rest of the row as it is', async () => {
        const plain = await mount(
            <LayerManagerPanel layers={[layer('Row', inRange())]} />,
        )
        const plainRow = rowOf(plain.container, 'Row')
        const plainClass = plainRow.className
        const plainButtons = plainRow.querySelectorAll('button').length
        await plain.unmount()

        const flagged = await mount(
            <LayerManagerPanel layers={[layer('Row', outOfRange())]} />,
        )
        const flaggedRow = rowOf(flagged.container, 'Row')
        const checkbox = flaggedRow.querySelector<HTMLInputElement>(
            '.blocks-layer-legend__checkbox',
        )!
        expect(flaggedRow.className).toBe(plainClass)
        expect(checkbox.checked).toBe(true)
        expect(checkbox.disabled).toBe(false)
        expect(flaggedRow.querySelectorAll('button')).toHaveLength(plainButtons + 1)
        await flagged.unmount()
    })

    describe('for assistive technology', () => {
        test('is a focusable button named for its layer', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[
                        layer('Sea ice', outOfRange()),
                        layer('Snow cover', outOfRange()),
                    ]}
                />,
            )

            const [first, second] = warningsIn(container)
            expect(first.tagName).toBe('BUTTON')
            expect(first.getAttribute('type')).toBe('button')
            expect(first.tabIndex).toBe(0)
            expect(first.getAttribute('aria-label')).toBe(
                'No data at this time for Sea ice',
            )
            expect(second.getAttribute('aria-label')).toBe(
                'No data at this time for Snow cover',
            )
            await unmount()
        })

        // Read once, as focus lands, so the description is in place before
        // anything opens and its reference never changes.
        test('carries its explanation before it opens, under one reference', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)
            const describedBy = warning.getAttribute('aria-describedby')
            expect(describedBy).toBeTruthy()

            const description = document.getElementById(describedBy!)!
            expect(description).not.toBeNull()
            expect(popovers()).toHaveLength(0)
            expect(description.textContent).toContain('Data available on 2020-03-04')
            expect(description.textContent).toContain('Requested 2020-04-02')
            // Hidden outright rather than visually, so browse mode doesn't
            // read the explanation a second time after the button.
            expect(description.hidden).toBe(true)

            await act(async () => {
                warning.focus()
            })
            expect(popovers()).toHaveLength(1)
            expect(warning.getAttribute('aria-describedby')).toBe(describedBy)
            expect(popovers()[0].contains(description)).toBe(false)
            await unmount()
        })

        test('adds the instant to the explanation once the host has named it', async () => {
            const answer = deferred<DataCoverage | null>()
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={() => answer.promise}
                />,
            )
            const [warning] = warningsIn(container)
            const description = document.getElementById(
                warning.getAttribute('aria-describedby')!,
            )!
            expect(description.textContent).toContain('Data available on 2020-03-04')
            expect(description.textContent).not.toContain('Requested')

            await act(async () => {
                warning.focus()
            })
            await act(async () => {
                answer.resolve(
                    outOfRange({ start: utc(2020, 6, 1), end: utc(2020, 6, 2) }),
                )
            })
            expect(description.textContent).toContain('Requested 2020-07-02')
            await unmount()
        })
    })

    describe('opening and closing', () => {
        test('opens on hover with the three lines', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            expect(popovers()).toHaveLength(0)

            await hover(warningsIn(container)[0])
            const [popover] = popovers()
            expect(popover).toBeDefined()
            expect(popover.textContent).toContain('No data at this time')
            expect(popover.textContent).toContain('Requested 2020-04-02')
            expect(popover.textContent).toContain('Data available on 2020-03-04')
            await unmount()
        })

        test('closes a moment after the pointer leaves', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await hover(warning)
            await unhover(warning)
            expect(popovers()).toHaveLength(1)
            await elapse(CLOSE_DELAY - 1)
            expect(popovers()).toHaveLength(1)
            await elapse(1)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        // The popover sits a few pixels off its icon. Crossing that gap and
        // resting on the popover keeps it open, so its text can be read and
        // magnified under the pointer.
        test('stays open while the pointer crosses to the popover and rests on it', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await hover(warning)
            await unhover(warning)
            await elapse(CLOSE_DELAY - 1)
            const [popover] = popovers()
            await hover(popover)
            await elapse(CLOSE_DELAY * 10)
            expect(popovers()).toHaveLength(1)

            // And back to the icon without closing on the way.
            await unhover(popover)
            await elapse(CLOSE_DELAY - 1)
            await hover(warning)
            await elapse(CLOSE_DELAY * 10)
            expect(popovers()).toHaveLength(1)

            await leave(warning)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        test('leaves nothing waiting to fire once unmounted', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)
            await hover(warning)
            await unhover(warning)

            await unmount()
            expect(vi.getTimerCount()).toBe(0)
            expect(popovers()).toHaveLength(0)
        })

        test('opens on keyboard focus without taking focus, and closes on blur', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await act(async () => {
                warning.focus()
            })
            expect(popovers()).toHaveLength(1)
            expect(document.activeElement).toBe(warning)

            await act(async () => {
                warning.blur()
            })
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        test('closes on Escape while still hovered or focused', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await act(async () => {
                warning.focus()
            })
            await hover(warning)
            expect(popovers()).toHaveLength(1)

            await pressEscape()
            expect(popovers()).toHaveLength(0)
            expect(document.activeElement).toBe(warning)

            // Pointing at it again brings it back.
            await leave(warning)
            await hover(warning)
            expect(popovers()).toHaveLength(1)
            await unmount()
        })

        // A mouse click holds the popover open until the next click closes it.
        test('stays open from a click until the next one', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await click(warning)
            expect(popovers()).toHaveLength(1)
            await click(warning)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        // Focus has opened it already, so the first Enter closes it rather
        // than doing nothing visible. The next one holds it open like a click.
        test('Enter and Space close what focus opened, and open what they closed', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await act(async () => {
                warning.focus()
            })
            expect(popovers()).toHaveLength(1)
            await pressEnter(warning)
            expect(popovers()).toHaveLength(0)
            await pressEnter(warning)
            expect(popovers()).toHaveLength(1)
            await pressEnter(warning)
            expect(popovers()).toHaveLength(0)
            await pressEnter(warning)
            expect(popovers()).toHaveLength(1)
            await pressEscape()
            expect(popovers()).toHaveLength(0)

            // Tabbing away puts a popover held open by Enter away too.
            await pressEnter(warning)
            expect(popovers()).toHaveLength(1)
            await act(async () => {
                warning.blur()
            })
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        // A mouse always hovers before it clicks, and a browser that focuses
        // a clicked button does so before the click lands, so the click lands
        // on an open popover. It keeps the text being read on screen.
        test('a click after hovering keeps it open once the pointer moves away', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await hover(warning)
            await act(async () => {
                warning.focus()
            })
            await click(warning)
            expect(popovers()).toHaveLength(1)
            await leave(warning)
            expect(popovers()).toHaveLength(1)

            await click(warning)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        // Focus stays on the icon, as the popover holds nothing to operate. A
        // popover that took focus would hand it back to the icon as it
        // closed, and the icon taking focus opens it again.
        describe('pressing the popover leaves focus on the icon', () => {
            test('a clicked-open popover stays open, with focus where it was', async () => {
                const { container, unmount } = await mount(
                    <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
                )
                const [warning] = warningsIn(container)

                await act(async () => {
                    warning.focus()
                })
                await click(warning)
                const [popover] = popovers()
                const down = await pressText(popover)
                expect(down.defaultPrevented).toBe(true)
                expect(document.activeElement).toBe(warning)

                await leave(warning)
                expect(popovers()).toEqual([popover])
                await unmount()
            })

            test('Escape after pressing it closes it at once', async () => {
                const { container, unmount } = await mount(
                    <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
                )
                const [warning] = warningsIn(container)

                await click(warning)
                await pressText(popovers()[0])
                await pressEscape()
                expect(popovers()).toHaveLength(0)
                await elapse(CLOSE_DELAY * 10)
                expect(popovers()).toHaveLength(0)
                await unmount()
            })

            test('moving away after pressing it closes it for good', async () => {
                const { container, unmount } = await mount(
                    <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
                )
                const [warning] = warningsIn(container)

                await hover(warning)
                await unhover(warning)
                const [popover] = popovers()
                await hover(popover)
                await pressText(popover)
                await leave(popover)
                expect(popovers()).toHaveLength(0)
                await elapse(CLOSE_DELAY * 10)
                expect(popovers()).toHaveLength(0)
                await unmount()
            })
        })

        // Every way of closing it closes it for good: nothing left over from
        // the pointer, a click or focus holds it open once it is next opened.
        describe('closing leaves nothing to hold it open later', () => {
            test('Escape after a click', async () => {
                const { container, unmount } = await mount(
                    <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
                )
                const [warning] = warningsIn(container)

                await click(warning)
                await pressEscape()
                expect(popovers()).toHaveLength(0)

                await hover(warning)
                expect(popovers()).toHaveLength(1)
                await leave(warning)
                expect(popovers()).toHaveLength(0)
                await unmount()
            })

            // Where a click doesn't focus the button — Safari, and Firefox on
            // macOS — no blur follows to release the click's hold.
            test('a press elsewhere after a click that did not focus the icon', async () => {
                const { container, unmount } = await mount(
                    <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
                )
                const [warning] = warningsIn(container)

                await hover(warning)
                await act(async () => {
                    pointer(warning, 'pointerdown')
                })
                await click(warning)
                expect(document.activeElement).not.toBe(warning)
                await leave(warning)
                expect(popovers()).toHaveLength(1)

                await pressElsewhere()
                expect(popovers()).toHaveLength(0)

                for (let i = 0; i < 2; i++) {
                    await hover(warning)
                    expect(popovers()).toHaveLength(1)
                    await leave(warning)
                    expect(popovers()).toHaveLength(0)
                }
                await unmount()
            })

            // The popover goes without the pointer ever leaving it.
            test('Escape with the pointer resting on the popover', async () => {
                const { container, unmount } = await mount(
                    <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
                )
                const [warning] = warningsIn(container)

                await hover(warning)
                await unhover(warning)
                await hover(popovers()[0])
                await pressEscape()
                expect(popovers()).toHaveLength(0)
                await elapse(CLOSE_DELAY * 10)
                expect(popovers()).toHaveLength(0)

                await act(async () => {
                    warning.focus()
                })
                expect(popovers()).toHaveLength(1)
                await act(async () => {
                    warning.blur()
                })
                expect(popovers()).toHaveLength(0)
                await unmount()
            })
        })

        // A press that is dragged off the icon never becomes a click.
        test('keyboard focus opens it after a press that was dragged away', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await hover(warning)
            await act(async () => {
                pointer(warning, 'pointerdown')
            })
            await leave(warning)
            await act(async () => {
                pointer(document.body, 'pointerup')
            })
            expect(popovers()).toHaveLength(0)

            await act(async () => {
                warning.focus()
            })
            expect(popovers()).toHaveLength(1)
            await unmount()
        })

        // A tap focuses the button and clicks it in one gesture.
        test('opens on a tap and closes on the next', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel layers={[layer('Suppressed', outOfRange())]} />,
            )
            const [warning] = warningsIn(container)

            await tap(warning)
            expect(popovers()).toHaveLength(1)
            await elapse(CLOSE_DELAY * 10)
            expect(popovers()).toHaveLength(1)

            await tap(warning)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })
    })

    describe('reading the coverage when it opens', () => {
        // The row's record is only replaced when the verdict or coverage
        // changes; the window it was asking for has moved on since. What the
        // popover names is what the host says as it opens.
        test('names the instant the host reports on opening, not the row’s', async () => {
            const fresh = outOfRange({
                start: utc(2020, 5, 9),
                end: utc(2020, 5, 10, 14),
            })
            const getDataCoverage = vi.fn(async () => fresh)
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={getDataCoverage}
                />,
            )

            await hover(warningsIn(container)[0])

            expect(getDataCoverage).toHaveBeenCalledWith('Suppressed')
            const [popover] = popovers()
            expect(popover.textContent).toContain('Requested 2020-06-10 14:00 UTC')
            expect(popover.textContent).not.toContain('2020-04-02')
            await unmount()
        })

        test('holds the instant back until the host answers', async () => {
            const answer = deferred<DataCoverage | null>()
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={() => answer.promise}
                />,
            )

            await hover(warningsIn(container)[0])
            const [popover] = popovers()
            expect(popover.textContent).toContain('No data at this time')
            expect(popover.textContent).toContain('Data available on 2020-03-04')
            expect(popover.textContent).not.toContain('Requested')

            await act(async () => {
                answer.resolve(
                    outOfRange({ start: utc(2020, 6, 1), end: utc(2020, 6, 2) }),
                )
            })
            expect(popovers()[0].textContent).toContain('Requested 2020-07-02')
            await unmount()
        })

        test('asks again on every opening', async () => {
            let end = utc(2020, 5, 10)
            const getDataCoverage = vi.fn(async () =>
                outOfRange({ start: end - 1, end }),
            )
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={getDataCoverage}
                />,
            )
            const [warning] = warningsIn(container)

            await hover(warning)
            expect(popovers()[0].textContent).toContain('Requested 2020-06-10')
            await leave(warning)

            end = utc(2020, 5, 11)
            await hover(warning)
            expect(popovers()[0].textContent).toContain('Requested 2020-06-11')
            expect(getDataCoverage).toHaveBeenCalledTimes(2)
            await unmount()
        })

        // Each opening's answer belongs to that opening alone: one that
        // arrives after its popover closed, or after a later opening's, is
        // never shown.
        test('shows only the answer to the current opening, whatever order they settle in', async () => {
            const answers = [
                deferred<DataCoverage | null>(),
                deferred<DataCoverage | null>(),
                deferred<DataCoverage | null>(),
            ]
            let asked = 0
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={() => answers[asked++].promise}
                />,
            )
            const [warning] = warningsIn(container)
            const answerFor = (day: number) =>
                outOfRange({ start: utc(2020, 6, day - 1), end: utc(2020, 6, day) })

            // First opening, closed before its answer arrives.
            await hover(warning)
            await leave(warning)
            await act(async () => {
                answers[0].resolve(answerFor(1))
            })

            // Second opening, closed with its answer still outstanding, then
            // a third.
            await hover(warning)
            expect(popovers()[0].textContent).not.toContain('Requested')
            await leave(warning)
            await hover(warning)
            expect(asked).toBe(3)

            // The third answers first, then the second, late.
            await act(async () => {
                answers[2].resolve(answerFor(3))
            })
            expect(popovers()[0].textContent).toContain('Requested 2020-07-03')
            await act(async () => {
                answers[1].resolve(answerFor(2))
            })
            expect(popovers()[0].textContent).toContain('Requested 2020-07-03')
            expect(popovers()[0].textContent).not.toContain('2020-07-02')
            expect(popovers()[0].textContent).not.toContain('2020-07-01')
            await unmount()
        })

        test('leaves the instant out when the host cannot answer', async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={async () => {
                        throw new Error('bus down')
                    }}
                />,
            )

            await hover(warningsIn(container)[0])
            const [popover] = popovers()
            expect(popover.textContent).toContain('Data available on 2020-03-04')
            expect(popover.textContent).not.toContain('Requested')
            await unmount()
        })

        test("keeps the row's coverage when the host's answer has none to word", async () => {
            const { container, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('Suppressed', outOfRange())]}
                    getDataCoverage={async () => ({
                        outOfDataRange: false,
                        kind: null,
                        spans: null,
                        requestedWindow: {
                            start: utc(2020, 6, 1),
                            end: utc(2020, 6, 2),
                        },
                    })}
                />,
            )

            await hover(warningsIn(container)[0])
            const [popover] = popovers()
            expect(popover.textContent).toContain('No data at this time')
            expect(popover.textContent).toContain('Data available on 2020-03-04')
            // The row's instant is stale, so it is not the one shown.
            expect(popover.textContent).not.toContain('2020-04-02')
            await unmount()
        })
    })

    describe('across refreshes of the list', () => {
        test('re-rendering, reordering and adding rows leaves one popover', async () => {
            const { container, rerender, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('A', outOfRange()), layer('B', outOfRange())]}
                />,
            )
            await hover(warningsIn(container)[0])
            expect(popovers()).toHaveLength(1)

            // Fresh objects for the same rows, as every refresh hands over.
            await rerender(
                <LayerManagerPanel
                    layers={[layer('A', outOfRange()), layer('B', outOfRange())]}
                />,
            )
            expect(popovers()).toHaveLength(1)

            await rerender(
                <LayerManagerPanel
                    layers={[
                        layer('C', outOfRange()),
                        layer('B', outOfRange()),
                        layer('A', outOfRange()),
                    ]}
                />,
            )
            expect(popovers()).toHaveLength(1)
            expect(warningsIn(container)).toHaveLength(3)

            await leave(
                rowOf(container, 'A').querySelector(
                    '.blocks-layer-legend__coverage-warning',
                )!,
            )
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        test('a row coming back into range takes its popover with it', async () => {
            const { container, rerender, unmount } = await mount(
                <LayerManagerPanel layers={[layer('A', outOfRange())]} />,
            )
            await hover(warningsIn(container)[0])
            expect(popovers()).toHaveLength(1)

            await rerender(<LayerManagerPanel layers={[layer('A', inRange())]} />)
            expect(warningsIn(container)).toHaveLength(0)
            expect(popovers()).toHaveLength(0)

            // Out of range again: the icon returns, closed.
            await rerender(<LayerManagerPanel layers={[layer('A', outOfRange())]} />)
            expect(warningsIn(container)).toHaveLength(1)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        // The icon goes with the warning; focus on it would otherwise fall
        // to the page, losing a keyboard user's place in the list.
        test("a row coming back into range hands the icon's focus to its checkbox", async () => {
            const { container, rerender, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('A', outOfRange()), layer('B', outOfRange())]}
                />,
            )
            const warning = rowOf(container, 'A').querySelector<HTMLElement>(
                '.blocks-layer-legend__coverage-warning',
            )!
            await act(async () => {
                warning.focus()
            })

            await rerender(
                <LayerManagerPanel
                    layers={[layer('A', inRange()), layer('B', outOfRange())]}
                />,
            )
            expect(document.activeElement).toBe(
                rowOf(container, 'A').querySelector('.blocks-layer-legend__checkbox'),
            )
            expect(popovers()).toHaveLength(0)
            await unmount()
        })

        test('focus elsewhere stays put when a row comes back into range', async () => {
            const { container, rerender, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('A', outOfRange()), layer('B', outOfRange())]}
                />,
            )
            const warningOf = (id: string) =>
                rowOf(container, id).querySelector<HTMLElement>(
                    '.blocks-layer-legend__coverage-warning',
                )!

            // Focus that has already moved on from A's icon, to B's.
            await act(async () => {
                warningOf('A').focus()
            })
            await act(async () => {
                warningOf('B').focus()
            })

            await rerender(
                <LayerManagerPanel
                    layers={[layer('A', inRange()), layer('B', outOfRange())]}
                />,
            )
            expect(document.activeElement).toBe(warningOf('B'))
            await unmount()
        })

        test('a row leaving the list takes its popover with it', async () => {
            const { container, rerender, unmount } = await mount(
                <LayerManagerPanel
                    layers={[layer('A', outOfRange()), layer('B', inRange())]}
                />,
            )
            await hover(warningsIn(container)[0])
            expect(popovers()).toHaveLength(1)

            await rerender(<LayerManagerPanel layers={[layer('B', inRange())]} />)
            expect(popovers()).toHaveLength(0)
            await unmount()
        })
    })

    test('unmounting the panel removes its popovers', async () => {
        const { container, unmount } = await mount(
            <LayerManagerPanel layers={[layer('A', outOfRange())]} />,
        )
        await hover(warningsIn(container)[0])
        expect(popovers()).toHaveLength(1)

        await unmount()
        expect(popovers()).toHaveLength(0)
    })
})
