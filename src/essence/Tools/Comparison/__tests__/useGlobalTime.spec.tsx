import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { useGlobalTime, type GlobalTime } from '../adapters/useGlobalTime'

/**
 * The panel's binding to the global timeline. What matters is that it waits for
 * core's handlers rather than racing them, follows every later commit without
 * paying for it in bus traffic or churned identities, moves the timeline by the
 * one message core listens for, and never reports "no timeline" for a question
 * it has not yet answered.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const START = '2024-01-01T00:00:00Z'
const END = '2024-12-31T00:00:00Z'
const OPENED_AT = '2024-10-31T14:30:00Z'

/** A `time:changed` as TimeControl emits it: all three instants, every time. */
const changed = (currentTime: string, startTime = START, endTime = END) => ({
    startTime,
    endTime,
    currentTime,
})

describe('useGlobalTime', () => {
    let container: HTMLElement
    let root: Root | null
    let seen: GlobalTime
    let emitted: { event: string; payload?: unknown }[]
    let requested: string[]
    let listeners: Record<string, (p?: unknown) => void>
    let timeEnabled: boolean | null
    let current: string | null
    let hasHandler: (name: string) => boolean
    /** Held open by a case that needs a read still in flight. */
    let releaseWindowReads: (() => void) | null

    const Probe = () => {
        seen = useGlobalTime()
        return null
    }

    /**
     * Mounts the probe against the fixture as the test has left it. Kept out of
     * beforeEach so a case can describe a timeless mission, an older core, or a
     * slow one before the hook takes its first read.
     */
    const renderProbe = async () => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => { root!.render(<Probe />) })
    }

    beforeEach(() => {
        emitted = []
        requested = []
        listeners = {}
        timeEnabled = true
        current = OPENED_AT
        hasHandler = () => true
        releaseWindowReads = null
        root = null
        ;(window as any).mmgisAPI = {
            hasHandler: (name: string) => hasHandler(name),
            request: async (name: string) => {
                requested.push(name)
                if (name === 'time:isEnabled') return timeEnabled
                if (releaseWindowReads) {
                    await new Promise<void>((resolve) => {
                        const prior = releaseWindowReads!
                        releaseWindowReads = () => { prior(); resolve() }
                    })
                }
                if (name === 'time:getStart') return START
                if (name === 'time:getEnd') return END
                if (name === 'time:getCurrent') return current
                return null
            },
            on: (event: string, handler: (p?: unknown) => void) => {
                listeners[event] = handler
                return () => { delete listeners[event] }
            },
            emit: (event: string, payload?: unknown) => {
                emitted.push({ event, payload })
            },
        }
    })

    afterEach(() => {
        if (root) act(() => root!.unmount())
        container?.remove()
        delete (window as any).mmgisAPI
    })

    test('reads the window core is holding', async () => {
        await renderProbe()
        expect(seen.readiness).toBe('ready')
        expect(seen.enabled).toBe(true)
        expect(seen.start?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
        expect(seen.end?.toISOString()).toBe('2024-12-31T00:00:00.000Z')
        expect(seen.current?.toISOString()).toBe('2024-10-31T14:30:00.000Z')
    })

    test('follows a commit made anywhere else', async () => {
        await renderProbe()
        await act(async () => {
            listeners['time:changed']?.(changed('2024-06-15T00:00:00Z'))
        })
        expect(seen.current?.toISOString()).toBe('2024-06-15T00:00:00.000Z')
    })

    test('takes a commit off the event rather than re-reading the bus', async () => {
        await renderProbe()
        requested.length = 0

        await act(async () => {
            listeners['time:changed']?.(changed('2024-06-15T00:00:00Z'))
        })

        // Playback commits several times a second; a re-read here would cost
        // four round-trips per tick for instants the event already carried.
        expect(requested).toEqual([])
        expect(seen.current?.toISOString()).toBe('2024-06-15T00:00:00.000Z')
    })

    test('a commit that changes nothing churns no identities', async () => {
        await renderProbe()
        const before = {
            start: seen.start,
            end: seen.end,
            current: seen.current,
            setCurrent: seen.setCurrent,
        }

        await act(async () => { listeners['time:changed']?.(changed(OPENED_AT)) })

        expect(seen.start).toBe(before.start)
        expect(seen.end).toBe(before.end)
        expect(seen.current).toBe(before.current)
        expect(seen.setCurrent).toBe(before.setCurrent)
    })

    test('a commit that moves only the instant leaves the bounds alone', async () => {
        await renderProbe()
        const before = { start: seen.start, end: seen.end, setCurrent: seen.setCurrent }

        await act(async () => {
            listeners['time:changed']?.(changed('2024-06-15T00:00:00Z'))
        })

        expect(seen.start).toBe(before.start)
        expect(seen.end).toBe(before.end)
        // Consumers key effects on this callback; a stable window must leave it
        // stable or every playback tick invalidates their dependency arrays.
        expect(seen.setCurrent).toBe(before.setCurrent)
    })

    test('moves the timeline without disturbing its bounds', async () => {
        await renderProbe()
        act(() => { seen.setCurrent(new Date('2024-03-01T06:00:00Z')) })
        expect(emitted).toEqual([
            {
                event: 'time:changeRequested',
                payload: {
                    startTime: '2024-01-01T00:00:00.000Z',
                    endTime: '2024-12-31T00:00:00.000Z',
                    currentTime: '2024-03-01T06:00:00.000Z',
                },
            },
        ])
    })

    test('refuses to move a timeline whose window is unknown', async () => {
        timeEnabled = false
        await renderProbe()

        act(() => { seen.setCurrent(new Date('2024-03-01T06:00:00Z')) })

        // Emitting without both bounds would read to core as a request to move
        // the window itself, not just the instant.
        expect(emitted).toEqual([])
    })

    test('reports loading rather than "no timeline" before core answers', async () => {
        hasHandler = () => false
        await renderProbe()

        // The panel disables its dates tab on 'unavailable' with a tooltip
        // saying the mission has no timeline. Saying that about a mission whose
        // TimeControl simply has not registered yet is a false statement.
        expect(seen.readiness).toBe('loading')
        expect(seen.enabled).toBe(false)
    })

    test('reports no timeline for a mission whose time is off', async () => {
        timeEnabled = false
        await renderProbe()

        expect(seen.readiness).toBe('unavailable')
        expect(seen.enabled).toBe(false)
        // A timeless mission has no window to speak of, so the bounds are left
        // unread rather than filled with values that would mean nothing.
        expect(seen.start).toBe(null)
        expect(seen.end).toBe(null)
        expect(seen.current).toBe(null)
    })

    test('reports no timeline when core cannot say whether time is on', async () => {
        // A core old enough to serve the window but not to answer
        // 'time:isEnabled' leaves the question unanswered, not answered yes.
        hasHandler = (name: string) => name !== 'time:isEnabled'
        await renderProbe()

        expect(seen.readiness).toBe('unavailable')
        expect(seen.enabled).toBe(false)
        expect(seen.start).toBe(null)
    })

    test('reports no timeline when the window comes back incomplete', async () => {
        // Time is on, but the timeline is not seeded. Landing 'ready' here
        // would offer a dates tab whose rows have no date to show and whose
        // setCurrent silently does nothing.
        current = null
        await renderProbe()

        expect(seen.readiness).toBe('unavailable')
        expect(seen.enabled).toBe(false)
    })

    test('takes up a timeline that appears after the first read', async () => {
        // The first read finds no timeline. A verdict of 'unavailable' that
        // nothing could lift would keep the dates tab shut for the rest of the
        // session, however complete a window core went on to send.
        timeEnabled = false
        await renderProbe()
        expect(seen.readiness).toBe('unavailable')

        await act(async () => {
            listeners['time:changed']?.(changed('2024-06-15T00:00:00Z'))
        })

        expect(seen.readiness).toBe('ready')
        expect(seen.enabled).toBe(true)
        expect(seen.start?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
        expect(seen.end?.toISOString()).toBe('2024-12-31T00:00:00.000Z')
        expect(seen.current?.toISOString()).toBe('2024-06-15T00:00:00.000Z')
    })

    test('a partial commit leaves the verdict where it stands', async () => {
        timeEnabled = false
        await renderProbe()

        // An event naming only where the timeline moved says nothing about
        // whether there is a window to compare across.
        await act(async () => {
            listeners['time:changed']?.({ currentTime: '2024-06-15T00:00:00Z' })
        })

        expect(seen.readiness).toBe('unavailable')
    })

    test('stops listening once unmounted', async () => {
        await renderProbe()
        expect(listeners['time:changed']).toBeDefined()

        act(() => { root!.unmount() })
        root = null

        // A subscription outliving the component reappears much later as a
        // setState-after-unmount warning with no obvious cause.
        expect(listeners['time:changed']).toBeUndefined()
    })

    test('a read still in flight does not overwrite a pick', async () => {
        releaseWindowReads = () => {}
        await renderProbe()
        // The window read is parked; a commit from elsewhere seeds the bounds,
        // which is what lets the user pick before that read has returned.
        await act(async () => { listeners['time:changed']?.(changed(OPENED_AT)) })

        act(() => { seen.setCurrent(new Date('2024-03-01T06:00:00Z')) })
        expect(seen.current?.toISOString()).toBe('2024-03-01T06:00:00.000Z')

        await act(async () => {
            releaseWindowReads!()
            releaseWindowReads = null
            await Promise.resolve()
        })

        // The parked read is reporting where the timeline sat before the pick.
        expect(seen.current?.toISOString()).toBe('2024-03-01T06:00:00.000Z')
    })
})
