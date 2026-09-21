import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FloatingPopover } from './lib/FloatingPopover'
import {
    mmgisRequest,
    mmgisOn,
    mmgisEmit,
    mmgisGetLayerConfigs,
    mmgisGetVisibleLayers,
    mmgisIsTimeEnabled,
    mmgisGetTimeStart,
    mmgisGetTimeEnd,
    mmgisGetTimeCurrent,
    type LayerConfig,
    mmgisGetTemporalExtents,
} from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    TimelineView,
    TimeModeControl,
    DateSelector,
    PlaybackControls,
    PlaybackSpeedControl,
    ZoomControls,
    getNextPlaybackSpeed,
    TIME_MODE_ORDER,
    type TimeMode,
    type LayerTimeData
} from './lib'
import {
    stepTime,
    clampDate,
    resolveLayerTimeRanges,
} from './lib/utils/timeUtils'
import { resolveLayerNavigation, revealStart } from './lib/utils/layerNavigation'
import type { LayerNavigation } from './lib/utils/layerNavigation'
import { useTimelineZoom } from './lib/hooks/useTimelineZoom'
import type { ViewWindow } from './lib/utils/zoomWindow'
import './Timeline.css'

/** The wire shape of both 'time:changeRequested' and 'time:changed'. */
interface TimePayload {
    startTime: string
    endTime: string
    currentTime: string
}

/**
 * 'loading' until core answers; 'unavailable' when the mission has no time
 * enabled, which leaves nothing meaningful to scrub.
 */
type Readiness = 'loading' | 'ready' | 'unavailable'

const sameInstant = (a: Date, b: Date): boolean => a.getTime() === b.getTime()

/** Keeps the previous Date when the instant is unchanged, so effects keyed on
 *  it don't re-run on every echo from core. */
const preserveIdentity = (prev: Date, next: Date): Date =>
    sameInstant(prev, next) ? prev : next

export const TimelineAdapter: React.FC = () => {
    const [startTime, setStartTime] = useState<Date>(() => {
        const d = new Date()
        d.setDate(d.getDate() - 30)
        return d
    })
    const [endTime, setEndTime] = useState<Date>(new Date())
    const [currentTime, setCurrentTime] = useState<Date>(() => {
        const d = new Date()
        d.setDate(d.getDate() - 15)
        return d
    })
    const [timeMode, setTimeMode] = useState<TimeMode>('DAY')
    const [shownTimeModes, setShownTimeModes] = useState<TimeMode[]>(TIME_MODE_ORDER)
    const [layers, setLayers] = useState<LayerTimeData[]>([])
    const [readiness, setReadiness] = useState<Readiness>('loading')

    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
    const [allowPlayback, setAllowPlayback] = useState(true)
    const [layerVisibilityVersion, setLayerVisibilityVersion] = useState(0)
    const [layersApiReady, setLayersApiReady] = useState(false)
    const [showInfoPopup, setShowInfoPopup] = useState(false)
    // Collapsed hides the layer list / scrubber area, leaving just the header
    const [isCollapsed, setIsCollapsed] = useState(false)
    /**
     * The dashboard's display granularity, written exactly once, when the
     * tool vars answer, and null until then. Zoom's floor and its auto-fit
     * signature both follow it, and never the runtime `timeMode` control:
     * that control is playback-and-navigation, and a floor that moved when a
     * playback button was pressed would permit a 24-hour view of a
     * twenty-year mission without the axis having changed at all.
     *
     * Null holds the timeline on its loading state and keeps layers from
     * being fetched, so the first fit can only ever run at the configured
     * floor; a fit at a provisional floor redone at the real one would be a
     * visible jump on any dashboard not configured for days.
     */
    const [configuredGranularity, setConfiguredGranularity] =
        useState<TimeMode | null>(null)
    const infoButtonRef = useRef<HTMLButtonElement>(null)

    // Mirror the committed window so emit/step callbacks keep a stable identity
    // and don't re-arm the playback interval on every tick.
    const startTimeRef = useRef(startTime)
    const endTimeRef = useRef(endTime)
    const currentTimeRef = useRef(currentTime)
    useEffect(() => {
        startTimeRef.current = startTime
    }, [startTime])
    useEffect(() => {
        endTimeRef.current = endTime
    }, [endTime])
    useEffect(() => {
        currentTimeRef.current = currentTime
    }, [currentTime])

    // The last payload this plugin asked core to commit. Core broadcasts every
    // commit back on 'time:changed', including this one; matching it here keeps
    // the echo from fighting an in-flight drag or playback tick.
    const lastRequestedRef = useRef<TimePayload | null>(null)

    /**
     * Asks core to commit an instant, within the window given, and moves local
     * state onto the same payload. All three fields are set here, not just the
     * instant: core's echo of this commit is the one 'time:changed' skips, so
     * a window emitted without being set locally would be lost on the way back.
     */
    const requestTime = useCallback((start: Date, end: Date, next: Date) => {
        setStartTime((prev) => preserveIdentity(prev, start))
        setEndTime((prev) => preserveIdentity(prev, end))
        setCurrentTime((prev) => preserveIdentity(prev, next))
        const payload: TimePayload = {
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            currentTime: next.toISOString(),
        }
        lastRequestedRef.current = payload
        mmgisEmit('time:changeRequested', payload)
    }, [])

    /** Moves the scrubber and asks core to commit the same instant. */
    const commitTime = useCallback(
        (next: Date) => {
            requestTime(startTimeRef.current, endTimeRef.current, next)
        },
        [requestTime]
    )

    /**
     * Commits the instant a layer row's controls lead to, widening the window
     * to reach it. A layer's data need not sit inside the window on screen, so
     * the target is committed as given rather than clamped back in.
     *
     * The window opens to `revealStart` rather than to the target: a sparse
     * target is a day's last instant, and a window starting there would meet
     * the trailing edge of that day's bar and leave the whole of it off the
     * left of the chart. Forwards needs no such allowance, since a bar ends on
     * the instant its day does.
     */
    const handleLayerNavigate = useCallback(
        (target: Date, navigation: LayerNavigation) => {
            const reach = revealStart(navigation, target)
            const start =
                reach < startTimeRef.current ? reach : startTimeRef.current
            const end = target > endTimeRef.current ? target : endTimeRef.current
            requestTime(start, end, target)
        },
        [requestTime]
    )

    /**
     * Opens the global window to the span a fit needs, leaving the scrubber
     * where it is. Widening only adds reachable instants, so the current time
     * never needs reclamping on this path.
     */
    const handleBoundsWiden = useCallback(
        (start: Date, end: Date) => {
            requestTime(start, end, currentTimeRef.current)
        },
        [requestTime]
    )

    const bounds = useMemo<ViewWindow>(
        () => ({ start: startTime, end: endTime }),
        [startTime, endTime]
    )

    const zoom = useTimelineZoom({
        bounds,
        layers,
        currentTime,
        // The floor stood in for here is inert: while the granularity is
        // unsettled no layer reaches the hook, so nothing is fitted, and the
        // loading state is shown, so no control reads it. It only decides
        // how the placeholder view is clamped, and that view is reopened
        // onto the whole window once core has answered.
        granularity: configuredGranularity ?? 'DAY',
        onBoundsWiden: handleBoundsWiden,
    })

    // The hook seeds its view from the first bounds it sees, and those are
    // the placeholder held until core answers; clamping that placeholder into
    // the seeded window would leave a month-wide view at its end. Once core
    // has answered, the view opens onto the whole window. Layers are fetched
    // only from this point on, so no fit runs against the placeholder.
    //
    // Keyed on readiness alone, deliberately. `setView`'s identity follows
    // the zoom floor, which follows the configured granularity, and the tool
    // vars carrying that granularity are registered later in boot than the
    // time handlers, so they typically land after the seed. Listed here,
    // `setView` would re-run this and throw a view the user may already have
    // zoomed back open to the full window when the tool vars arrive.
    useEffect(() => {
        if (readiness !== 'ready') return
        zoom.setView({ start: startTimeRef.current, end: endTimeRef.current })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readiness])

    /**
     * Settles the granularity on the mode given, or on the fallback where the
     * configuration named none. The first value written is the one kept, so
     * whichever path out of the tool vars arrives first decides, and a later
     * one cannot move a floor the view has already been fitted at.
     */
    const settleGranularity = useCallback((mode: TimeMode = 'DAY') => {
        setConfiguredGranularity((held) => held ?? mode)
    }, [])

    // Tool variables from the mission config. 'tool:getVars' is registered by
    // Layers_.fina() during mission load, after this tool mounts.
    const fetchVars = useCallback(async () => {
        try {
            const vars = await mmgisRequest<{
                allowPlayback?: boolean
                defaultTimeMode?: string
                shownTimeModes?: string[]
            }>('tool:getVars', 'timeline')
            if (!vars) {
                settleGranularity()
                return
            }

            if (typeof vars.allowPlayback === 'boolean') {
                setAllowPlayback(vars.allowPlayback)
            }

            // Which mode buttons to show (canonical order, empty = all)
            let effectiveModes = TIME_MODE_ORDER
            if (Array.isArray(vars.shownTimeModes)) {
                const requested = vars.shownTimeModes.map((m) => String(m).toUpperCase())
                const normalized = TIME_MODE_ORDER.filter((m) => requested.includes(m))
                if (normalized.length > 0) effectiveModes = normalized
            }
            setShownTimeModes(effectiveModes)

            // Initial mode: the configured default when valid, else 'DAY',
            // then clamped to a shown mode.
            const requestedDefault = vars.defaultTimeMode?.toUpperCase()
            let mode: TimeMode =
                requestedDefault === 'YEAR' ||
                requestedDefault === 'MONTH' ||
                requestedDefault === 'DAY' ||
                requestedDefault === 'HOUR'
                    ? (requestedDefault as TimeMode)
                    : 'DAY'
            if (!effectiveModes.includes(mode)) mode = effectiveModes[0]
            setTimeMode(mode)
            // The same validated mode, held apart from the runtime control so
            // a later press of that control cannot move the zoom floor.
            settleGranularity(mode)
        } catch (err) {
            console.warn('[Timeline] Failed to fetch tool vars:', err)
            // Tool vars that cannot be read leave the default granularity,
            // rather than a timeline that never leaves its loading state.
            settleGranularity()
        }
    }, [settleGranularity])
    // The timeline renders nothing until the granularity settles, so the
    // handler never appearing has to settle it too. 'tool:getVars' comes from
    // Layers_.fina() and the time handlers from TimeControl, so a mission
    // whose layers fail to load answers for the window and never for the
    // configuration — which without this leaves the loading state up for good.
    useMMGISHandlerReady('tool:getVars', fetchVars, {
        onTimeout: settleGranularity,
    })

    // Stop playback if it becomes disabled via config
    useEffect(() => {
        if (!allowPlayback && isPlaying) setIsPlaying(false)
    }, [allowPlayback, isPlaying])

    // Subscribe to layer visibility changes
    useEffect(() => {
        return mmgisOn('layer:visibilityChange', () => {
            setLayerVisibilityVersion((v) => v + 1)
        })
    }, [])

    const markLayersApiReady = useCallback(() => setLayersApiReady(true), [])
    useMMGISHandlerReady('layers:getAllConfigs', markLayersApiReady)

    // Layers wait for the seeded window and the settled granularity. Fetched
    // before the window, they would carry the placeholder as their fallback
    // bounds, and auto-fit would frame them against it, committing a window
    // derived from the placeholder to core. Fetched before the granularity,
    // they would be fitted at a provisional floor and refitted at the real
    // one. Core registers the tool vars and the layer configs together, so
    // the second wait costs nothing the first did not.
    useEffect(() => {
        if (
            !layersApiReady ||
            readiness !== 'ready' ||
            configuredGranularity === null
        )
            return
        let cancelled = false

        const fetchLayers = async () => {
            const [configs, visibleLayers, extents] = await Promise.all([
                mmgisGetLayerConfigs(),
                mmgisGetVisibleLayers(),
                mmgisGetTemporalExtents(),
            ])
            if (cancelled || !configs) return

            const newLayers: LayerTimeData[] = []

            Object.keys(configs).forEach((layerName) => {
                const layer: LayerConfig = configs[layerName]

                if (!visibleLayers?.[layerName]) return

                // Time-enabled layers stand out in the theme's secondary colour
                const color = layer.time?.enabled
                    ? 'var(--theme-color-secondary, #c91b6e)'
                    : 'var(--theme-color-base, #71767a)'

                // Core resolves the authored data times (open-ended "now",
                // duration offsets, cadence flooring); the resolvers below
                // read plain timestamps. A bound core could not read stays
                // as written, so it falls back the way it always has.
                const extent = extents?.[layerName]
                const time = layer.time && {
                    ...layer.time,
                    dataStartTime: extent?.start ?? layer.time.dataStartTime,
                    dataEndTime: extent?.end ?? layer.time.dataEndTime,
                }

                newLayers.push({
                    name: layerName,
                    displayName: layer.display_name || layer.name || layerName,
                    color: color,
                    timeRanges: resolveLayerTimeRanges(
                        time,
                        startTime,
                        endTime
                    ),
                    // Same fallback bounds as the ranges above, so a row
                    // navigates the span it draws.
                    navigation: resolveLayerNavigation(
                        time,
                        startTime,
                        endTime,
                        layerName
                    ),
                })
            })

            setLayers(newLayers)
        }

        fetchLayers()
        return () => {
            cancelled = true
        }
    }, [
        layersApiReady,
        readiness,
        configuredGranularity,
        startTime,
        endTime,
        layerVisibilityVersion,
    ])

    // Seed from TimeControl, then follow every committed change.
    const fetchInitialTimeData = useCallback(async () => {
        try {
            // Null means core predates the handler, not that time is off.
            if ((await mmgisIsTimeEnabled()) === false) {
                setReadiness('unavailable')
                return
            }

            const [start, end, current] = await Promise.all([
                mmgisGetTimeStart(),
                mmgisGetTimeEnd(),
                mmgisGetTimeCurrent(),
            ])

            if (!start || !end || !current) {
                setReadiness('unavailable')
                return
            }

            setStartTime((prev) => preserveIdentity(prev, new Date(start)))
            setEndTime((prev) => preserveIdentity(prev, new Date(end)))
            setCurrentTime((prev) => preserveIdentity(prev, new Date(current)))
            setReadiness('ready')
        } catch (err) {
            console.error('[Timeline] Failed to fetch initial time data:', err)
            setReadiness('unavailable')
        }
    }, [])
    useMMGISHandlerReady('time:getStart', fetchInitialTimeData)

    useEffect(() => {
        return mmgisOn('time:changed', (payload?: unknown) => {
            const data = payload as Partial<TimePayload> | undefined
            if (!data) return

            const requested = lastRequestedRef.current
            if (
                requested &&
                requested.startTime === data.startTime &&
                requested.endTime === data.endTime &&
                requested.currentTime === data.currentTime
            ) {
                // This plugin's own commit; local state already matches. The
                // match is consumed so a later external commit landing on the
                // same instant is treated as the real change it is.
                lastRequestedRef.current = null
                return
            }

            if (data.startTime) setStartTime((prev) => preserveIdentity(prev, new Date(data.startTime as string)))
            if (data.endTime) setEndTime((prev) => preserveIdentity(prev, new Date(data.endTime as string)))
            if (data.currentTime) setCurrentTime((prev) => preserveIdentity(prev, new Date(data.currentTime as string)))
        })
    }, [])

    // Committed time change from the scrubber
    const handleCurrentTimeChange = useCallback(
        (newTime: Date) => {
            commitTime(clampDate(newTime, startTimeRef.current, endTimeRef.current))
        },
        [commitTime]
    )

    /**
     * Hands the comparison of two dates over to the Comparison plugin.
     *
     * Announced on the bus rather than called: the timeline knows nothing about
     * Comparison beyond the name of the event, and a mission without that
     * plugin simply has nobody listening — the action still draws, and clicking
     * it goes nowhere rather than breaking the timeline.
     */
    const handleCompareClick = useCallback(() => {
        const payload: TimePayload = {
            startTime: startTimeRef.current.toISOString(),
            endTime: endTimeRef.current.toISOString(),
            currentTime: currentTimeRef.current.toISOString(),
        }
        mmgisEmit('plugin:comparison:startWithDates', payload)
    }, [])

    // Live time while the scrubber is dragged: the header date follows along,
    // but nothing is emitted until the drag is released.
    const handleCurrentTimePreview = useCallback((newTime: Date) => {
        setCurrentTime((prev) => preserveIdentity(prev, newTime))
    }, [])

    const canStepBackward = currentTime > startTime
    const canStepForward = currentTime < endTime

    const handleStepForward = useCallback(() => {
        handleCurrentTimeChange(stepTime(currentTimeRef.current, timeMode, 1))
    }, [timeMode, handleCurrentTimeChange])

    const handleStepBackward = useCallback(() => {
        handleCurrentTimeChange(stepTime(currentTimeRef.current, timeMode, -1))
    }, [timeMode, handleCurrentTimeChange])

    const handleGoToStart = useCallback(() => {
        commitTime(startTimeRef.current)
    }, [commitTime])

    const handleGoToEnd = useCallback(() => {
        commitTime(endTimeRef.current)
    }, [commitTime])

    /** Playing from the end restarts at the beginning rather than stalling. */
    const handlePlayToggle = useCallback(() => {
        if (isPlaying) {
            setIsPlaying(false)
            return
        }
        if (currentTimeRef.current >= endTimeRef.current) {
            commitTime(startTimeRef.current)
        }
        setIsPlaying(true)
    }, [isPlaying, commitTime])

    useEffect(() => {
        if (!isPlaying) return

        // One step per second, divided by the speed multiplier
        // (2x -> 500ms, 4x -> 250ms, 0.5x -> 2000ms).
        const speed = 1000 / playbackSpeed

        const interval = setInterval(() => {
            const nextTime = stepTime(currentTimeRef.current, timeMode, 1)
            if (nextTime > endTimeRef.current) {
                setIsPlaying(false)
                return
            }
            commitTime(nextTime)
        }, speed)

        return () => clearInterval(interval)
    }, [isPlaying, timeMode, playbackSpeed, commitTime])

    const infoPopupId = 'timeline-info-popup'

    if (readiness === 'unavailable') {
        return (
            <div className="timeline-unavailable">
                <div className="timeline-unavailable-message">
                    Time is not enabled for this mission
                </div>
                <div className="timeline-unavailable-hint">
                    Enable time in the mission configuration to use the timeline.
                </div>
            </div>
        )
    }

    // Loading until both core's window and the configured granularity are
    // held: every control below reads the zoom floor, and the floor is not
    // known before the tool vars answer.
    if (readiness === 'loading' || configuredGranularity === null) {
        return (
            <div className="timeline-loading">
                <div className="loading-message">Loading timeline...</div>
            </div>
        )
    }

    return (
        <div className={`timeline${isCollapsed ? ' timeline--collapsed' : ''}`}>
            <div className="timeline-header">
                <div className="timeline-header-left">
                    <DateSelector
                        selectedDate={currentTime}
                        startTime={startTime}
                        endTime={endTime}
                        timeMode={timeMode}
                        onDateChange={handleCurrentTimeChange}
                        onCompareClick={handleCompareClick}
                    />
                </div>
                <div className="timeline-header-center">
                    <PlaybackControls
                        isPlaying={isPlaying}
                        showPlayButton={allowPlayback}
                        canStepForward={canStepForward}
                        canStepBackward={canStepBackward}
                        onPlayToggle={handlePlayToggle}
                        onStepForward={handleStepForward}
                        onStepBackward={handleStepBackward}
                        onGoToStart={handleGoToStart}
                        onGoToEnd={handleGoToEnd}
                    />
                    {allowPlayback && (
                        <PlaybackSpeedControl
                            speed={playbackSpeed}
                            onCycleSpeed={() => setPlaybackSpeed((s) => getNextPlaybackSpeed(s))}
                        />
                    )}
                </div>
                <div className="timeline-header-right">
                    <TimeModeControl
                        currentMode={timeMode}
                        onModeChange={setTimeMode}
                        modes={shownTimeModes}
                    />
                    <div className="timeline-toolbar">
                        <ZoomControls
                            sliderValue={zoom.sliderValue}
                            spanMs={zoom.view.end.getTime() - zoom.view.start.getTime()}
                            canZoom={zoom.canZoom}
                            canFit={zoom.canFit}
                            autoFit={zoom.autoFit}
                            onZoomIn={zoom.zoomIn}
                            onZoomOut={zoom.zoomOut}
                            onSliderChange={zoom.setSliderValue}
                            onToggleAutoFit={zoom.toggleAutoFit}
                            onFitNow={zoom.fitToLayers}
                        />
                        <button
                            type="button"
                            ref={infoButtonRef}
                            className="timeline-tool-btn"
                            onClick={() => setShowInfoPopup(!showInfoPopup)}
                            title="Info"
                            aria-label="Timeline controls help"
                            aria-haspopup="dialog"
                            aria-expanded={showInfoPopup}
                            aria-controls={showInfoPopup ? infoPopupId : undefined}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                                <path d="M0 0h24v24H0V0z" fill="none"/>
                                <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                            </svg>
                        </button>
                        <button
                            type="button"
                            className="timeline-tool-btn timeline-collapse-btn"
                            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
                            title={isCollapsed ? 'Expand timeline' : 'Collapse timeline'}
                            aria-label={isCollapsed ? 'Expand timeline' : 'Collapse timeline'}
                            aria-expanded={!isCollapsed}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                                <path d="M12 15.5L5.5 9L6.9 7.6L12 12.7L17.1 7.6L18.5 9L12 15.5Z"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
            <div className="timeline-content">
                {layers.length === 0 ? (
                    <div className="timeline-empty">
                        <div className="timeline-empty-message">
                            No visible layers on the map
                        </div>
                        <div className="timeline-empty-hint">
                            Enable the visibility of one or more map layers to display them here.
                        </div>
                    </div>
                ) : (
                    <TimelineView
                        startTime={startTime}
                        endTime={endTime}
                        currentTime={currentTime}
                        timeMode={timeMode}
                        configuredGranularity={configuredGranularity}
                        layers={layers}
                        view={zoom.view}
                        onViewChange={zoom.setView}
                        onCurrentTimeChange={handleCurrentTimeChange}
                        onCurrentTimePreview={handleCurrentTimePreview}
                        onLayerNavigate={handleLayerNavigate}
                        onFitLayer={zoom.fitToLayer}
                    />
                )}
            </div>
            <FloatingPopover
                id={infoPopupId}
                anchorRef={infoButtonRef}
                isOpen={showInfoPopup}
                onClose={() => setShowInfoPopup(false)}
                placement="top"
                offset={8}
                className="timeline-info-tooltip-portal"
                label="Timeline controls"
            >
                <div className="timeline-info-tooltip-content">
                    <strong>Timeline Controls</strong>
                    <p>Scroll or use the zoom controls to change the span shown • Drag scrubber to change time • Click to jump • Hover a layer to step through its dates or frame it</p>
                </div>
            </FloatingPopover>
        </div>
    )
}
