import { useCallback, useEffect, useRef, useState } from 'react'
import {
    mmgisOn,
    mmgisEmit,
    mmgisIsTimeEnabled,
    mmgisGetTimeStart,
    mmgisGetTimeEnd,
    mmgisGetTimeCurrent,
} from '../../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../../_shared/adapters/useMMGISHandlerReady'

/**
 * How far the hook has got with core: 'loading' until the first read resolves,
 * 'unavailable' when the mission has no timeline or the read failed, 'ready'
 * once a usable window is in hand. Consumers must render 'loading' distinctly
 * from 'unavailable' — telling a user their mission has no timeline while the
 * answer is still in flight is a false statement, not a placeholder.
 */
export type TimeReadiness = 'loading' | 'ready' | 'unavailable'

/** The global timeline as the panel reads and moves it. */
export type GlobalTime = {
    /** Whether a usable timeline is in hand; false while still loading. */
    enabled: boolean
    /** Whether the window has been read yet, and how it turned out. */
    readiness: TimeReadiness
    /** The window's opening instant, or null until read. */
    start: Date | null
    /** The window's closing instant, or null until read. */
    end: Date | null
    /** Where the timeline currently sits, or null until read. */
    current: Date | null
    /** Move the timeline, leaving the window's bounds as they are. */
    setCurrent: (date: Date) => void
}

/** The three instants core puts on every `time:changed`. */
type TimePayload = {
    startTime?: string
    endTime?: string
    currentTime?: string
}

const toDate = (iso: string | null | undefined): Date | null => {
    if (!iso) return null
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Keeps the previous Date when the instant is unchanged, so a repeated value
 * does not hand consumers a fresh object that invalidates their memoisation.
 */
const preserveIdentity = (prev: Date | null, next: Date | null): Date | null => {
    if (prev && next && prev.getTime() === next.getTime()) return prev
    return next
}

/**
 * The global timeline, kept in step with core in both directions.
 *
 * TimeControl registers its handlers during mission load, after this tool can
 * mount, so the first read waits on `time:getCurrent` appearing rather than
 * racing it. That read is the only one that goes over the bus: `time:changed`
 * carries all three instants, so later updates come off the payload instead of
 * re-requesting them — playback commits several times a second and re-reading
 * would cost four round-trips and a render per tick.
 *
 * Updates run through preserveIdentity, so an event that repeats the current
 * value changes no identity and the tree does not re-render. That is also why
 * this plugin needs no echo guard: its own commit comes back as an event
 * carrying the value already in state, which lands as a no-op. A scrubber drag
 * would still need the guard TimelineAdapter carries; discrete picks do not.
 */
export const useGlobalTime = (): GlobalTime => {
    const [readiness, setReadiness] = useState<TimeReadiness>('loading')
    const [start, setStart] = useState<Date | null>(null)
    const [end, setEnd] = useState<Date | null>(null)
    const [current, setCurrentState] = useState<Date | null>(null)

    // Results from a read that is no longer the newest intent — because a later
    // read started, or the user committed a pick while it was in flight — are
    // dropped rather than allowed to overwrite fresher state.
    const generationRef = useRef(0)
    const mountedRef = useRef(true)
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const readWindow = useCallback(async () => {
        const generation = ++generationRef.current
        const isCurrent = () =>
            mountedRef.current && generation === generationRef.current
        try {
            const isEnabled = await mmgisIsTimeEnabled()
            if (!isCurrent()) return
            if (isEnabled !== true) {
                setReadiness('unavailable')
                return
            }

            const [startIso, endIso, currentIso] = await Promise.all([
                mmgisGetTimeStart(),
                mmgisGetTimeEnd(),
                mmgisGetTimeCurrent(),
            ])
            if (!isCurrent()) return

            const nextStart = toDate(startIso)
            const nextEnd = toDate(endIso)
            const nextCurrent = toDate(currentIso)
            // A window missing any of its three instants cannot be compared
            // across, so it counts as no timeline rather than a partial one.
            if (!nextStart || !nextEnd || !nextCurrent) {
                setReadiness('unavailable')
                return
            }

            setStart((prev) => preserveIdentity(prev, nextStart))
            setEnd((prev) => preserveIdentity(prev, nextEnd))
            setCurrentState((prev) => preserveIdentity(prev, nextCurrent))
            setReadiness('ready')
        } catch (err) {
            console.warn('[Comparison] failed to read the global time', err)
            if (isCurrent()) setReadiness('unavailable')
        }
    }, [])

    useMMGISHandlerReady('time:getCurrent', readWindow)

    useEffect(() => {
        return mmgisOn('time:changed', (payload?: unknown) => {
            const data = payload as TimePayload | undefined
            // Core always sends all three instants; an event without them says
            // nothing about where the timeline moved, so state is left alone
            // rather than being cleared or re-read.
            if (!data) return
            const nextStart = toDate(data.startTime)
            const nextEnd = toDate(data.endTime)
            const nextCurrent = toDate(data.currentTime)
            if (nextStart) setStart((prev) => preserveIdentity(prev, nextStart))
            if (nextEnd) setEnd((prev) => preserveIdentity(prev, nextEnd))
            if (nextCurrent)
                setCurrentState((prev) => preserveIdentity(prev, nextCurrent))
            // An event carrying a whole window answers the question the first
            // read was asking, so a hook that read before core had a timeline
            // is not left reporting 'unavailable' for one that has since
            // arrived. Readiness only ever rises here: a partial event says
            // nothing about the window and leaves the verdict as it stands.
            if (nextStart && nextEnd && nextCurrent) setReadiness('ready')
        })
    }, [])

    const setCurrent = useCallback(
        (date: Date) => {
            // Without both bounds the emit would send an incomplete window,
            // which core reads as a request to move them.
            if (!start || !end) return
            // The pick is the newest intent: any read still in flight would be
            // reporting where the timeline was before it.
            generationRef.current += 1
            setCurrentState((prev) => preserveIdentity(prev, date))
            mmgisEmit('time:changeRequested', {
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                currentTime: date.toISOString(),
            })
        },
        [start, end],
    )

    return {
        enabled: readiness === 'ready',
        readiness,
        start,
        end,
        current,
        setCurrent,
    }
}
