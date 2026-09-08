import React, { useState, useEffect, useCallback, useRef } from 'react'
import { FloatingPopover } from './lib/FloatingPopover'
import {
    mmgisRequest,
    mmgisOn,
    mmgisEmit,
    mmgisGetLayerConfigs,
    mmgisGetVisibleLayers,
    mmgisIsTimeEnabled,
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
    getNextPlaybackSpeed,
    TIME_MODE_ORDER,
    type TimeMode,
    type LayerTimeData
} from './lib'
import { stepTime, clampDate } from './lib/utils/timeUtils'
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
    const [resetZoomFn, setResetZoomFn] = useState<(() => void) | null>(null)
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

    const handleResetZoomReady = useCallback((fn: () => void) => {
        setResetZoomFn(() => fn)
    }, [])

    /** Moves the scrubber and asks core to commit the same instant. */
    const commitTime = useCallback((next: Date) => {
        setCurrentTime((prev) => preserveIdentity(prev, next))
        const payload: TimePayload = {
            startTime: startTimeRef.current.toISOString(),
            endTime: endTimeRef.current.toISOString(),
            currentTime: next.toISOString(),
        }
        lastRequestedRef.current = payload
        mmgisEmit('time:changeRequested', payload)
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
            if (!vars) return

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
        } catch (err) {
            console.warn('[Timeline] Failed to fetch tool vars:', err)
        }
    }, [])
    useMMGISHandlerReady('tool:getVars', fetchVars)

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

    useEffect(() => {
        if (!layersApiReady) return
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

                let start = startTime
                let end = endTime
                let color = 'var(--theme-color-base, #71767a)' // default grey

                if (layer.time && layer.time.enabled) {
                    // Core resolves the authored data times; null means
                    // unset or unreadable, keep the fallback.
                    const extent = extents?.[layerName]
                    if (extent?.start != null) start = new Date(extent.start)
                    if (extent?.end != null) end = new Date(extent.end)

                    // Time-enabled layers stand out in the theme's secondary colour
                    color = 'var(--theme-color-secondary, #c91b6e)'
                }

                newLayers.push({
                    name: layerName,
                    displayName: layer.display_name || layer.name || layerName,
                    color: color,
                    timeRanges: [
                        { start, end }
                    ]
                })
            })

            setLayers(newLayers)
        }

        fetchLayers()
        return () => {
            cancelled = true
        }
    }, [layersApiReady, startTime, endTime, layerVisibilityVersion])

    // Seed from TimeControl, then follow every committed change.
    const fetchInitialTimeData = useCallback(async () => {
        try {
            // Null means core predates the handler, not that time is off.
            if ((await mmgisIsTimeEnabled()) === false) {
                setReadiness('unavailable')
                return
            }

            const [start, end, current] = await Promise.all([
                mmgisRequest<string>('time:getStart'),
                mmgisRequest<string>('time:getEnd'),
                mmgisRequest<string>('time:getCurrent'),
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

    if (readiness === 'loading') {
        return (
            <div className="timeline-loading">
                <div className="loading-message">Loading timeline...</div>
            </div>
        )
    }

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
                        <button
                            type="button"
                            className="timeline-tool-btn"
                            onClick={() => resetZoomFn?.()}
                            title="Reset Zoom"
                            aria-label="Reset zoom"
                            disabled={!resetZoomFn}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                                <path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/>
                            </svg>
                        </button>
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
                        layers={layers}
                        onCurrentTimeChange={handleCurrentTimeChange}
                        onCurrentTimePreview={handleCurrentTimePreview}
                        onResetZoomReady={handleResetZoomReady}
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
                    <p>Scroll to zoom • Drag scrubber to change time • Click to jump</p>
                </div>
            </FloatingPopover>
        </div>
    )
}
