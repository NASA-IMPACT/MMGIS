import React, { useState, useEffect, useCallback, useRef } from 'react'
import moment from 'moment'
import { FloatingPopover } from './lib/FloatingPopover'
import { mmgisRequest, mmgisOn, mmgisEmit, mmgisGetLayerConfigs, mmgisGetRawConfigData, mmgisGetVisibleLayers } from './adapters/mmgisAPI'
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
import { getTimeStep } from './lib/utils/timeUtils'
import './Timeline.css'

interface TimeData {
    startTime: string
    endTime: string
    currentTime: string
}

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
    const [isReady, setIsReady] = useState(false)

    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
    const [allowPlayback, setAllowPlayback] = useState(true)
    const [layerVisibilityVersion, setLayerVisibilityVersion] = useState(0)
    const [showInfoPopup, setShowInfoPopup] = useState(false)
    // Collapsed hides the layer list / scrubber area, leaving just the header
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [resetZoomFn, setResetZoomFn] = useState<(() => void) | null>(null)
    const infoButtonRef = useRef<HTMLButtonElement>(null)

    const handleResetZoomReady = useCallback((fn: () => void) => {
        setResetZoomFn(() => fn)
    }, [])

    // Fetch tool variables (e.g. allowPlayback) from the mission config
    useEffect(() => {
        let cancelled = false
        const fetchVars = async () => {
            try {
                const vars = await mmgisRequest<{
                    allowPlayback?: boolean
                    defaultTimeMode?: string
                    shownTimeModes?: string[]
                }>('tool:getVars', 'timeline')
                if (cancelled || !vars) return

                if (typeof vars.allowPlayback === 'boolean') {
                    setAllowPlayback(vars.allowPlayback)
                }

                // Determine which mode buttons to show (canonical order, empty = all)
                let effectiveModes = TIME_MODE_ORDER
                if (Array.isArray(vars.shownTimeModes)) {
                    const requested = vars.shownTimeModes.map((m) => String(m).toUpperCase())
                    const normalized = TIME_MODE_ORDER.filter((m) => requested.includes(m))
                    if (normalized.length > 0) effectiveModes = normalized
                }
                setShownTimeModes(effectiveModes)

                // Determine the initial mode: configured default (if valid),
                // otherwise the prior 'DAY' fallback; then clamp to a shown mode.
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
        }
        fetchVars()
        return () => {
            cancelled = true
        }
    }, [])

    // Stop playback if it becomes disabled via config
    useEffect(() => {
        if (!allowPlayback && isPlaying) setIsPlaying(false)
    }, [allowPlayback, isPlaying])

    // Subscribe to layer visibility changes
    useEffect(() => {
        const cleanup = mmgisOn('layer:visibilityChange', () => {
            console.log('[Timeline] Layer visibility changed, refetching layers')
            setLayerVisibilityVersion(v => v + 1)
        })
        return cleanup
    }, [])
    useEffect(() => {
        const fetchLayers = () => {
            const configs = mmgisGetLayerConfigs()
            const rawConfig = mmgisGetRawConfigData()
            const visibleLayers = mmgisGetVisibleLayers()
            const rawLayers = rawConfig?.layers || []
            const newLayers: LayerTimeData[] = []

            const findRawLayer = (layersArr: any[], name: string): any => {
                for (let l of layersArr) {
                    if (l.name === name) return l
                    if (l.sublayers) {
                        const sub = findRawLayer(l.sublayers, name)
                        if (sub) return sub
                    }
                }
                return null
            }

            Object.keys(configs).forEach(layerName => {
                const layer = configs[layerName]

                // Filter to only visible layers
                if (!visibleLayers?.[layerName]) {
                    return
                }

                let start = startTime
                let end = endTime
                let color = '#808080' // default grey

                if (layer.time && layer.time.enabled) {
                    let rawLayer = null
                    if (rawLayers.length > 0) {
                        rawLayer = findRawLayer(rawLayers, layerName)
                    }
                    const timeConfig = layer.time

                    if (timeConfig.dataStartTime) {
                        const parsedStart = new Date(timeConfig.dataStartTime)
                        if (!isNaN(parsedStart.getTime())) {
                            start = parsedStart
                        }
                    }
                    if (timeConfig.dataEndTime) {
                        const parsedEnd = timeConfig.dataEndTime === 'now' ? new Date() : new Date(timeConfig.dataEndTime)
                        if (!isNaN(parsedEnd.getTime())) {
                            end = parsedEnd
                        }
                    }

                    color = '#FF4D85' // pink for time enabled layers
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
    }, [startTime, endTime, layerVisibilityVersion])

    // Fetch initial time data from TimeControl
    useEffect(() => {
        const fetchInitialTimeData = async () => {
            try {
                console.log('[Timeline] Fetching initial time data from TimeControl...')
                const start = await mmgisRequest<string>('time:getStart')
                const end = await mmgisRequest<string>('time:getEnd')
                const current = await mmgisRequest<string>('time:getCurrent')

                console.log('[Timeline] Received initial time data:', { start, end, current })

                if (start && end && current) {
                    setStartTime(new Date(start))
                    setEndTime(new Date(end))
                    setCurrentTime(new Date(current))
                }
            } catch (err) {
                console.error('[Timeline] Failed to fetch initial time data:', err)
            } finally {
                setIsReady(true)
            }
        }

        fetchInitialTimeData()

        // Subscribe to time changes
        const cleanup = mmgisOn('time:change', (payload: any) => {
            console.log('[Timeline] Received time:change event:', payload)
            if (payload?.startTime) setStartTime(new Date(payload.startTime))
            if (payload?.endTime) setEndTime(new Date(payload.endTime))
            if (payload?.currentTime) setCurrentTime(new Date(payload.currentTime))
        })

        return cleanup
    }, [])


    // Handle current time change from scrubber
    const handleCurrentTimeChange = useCallback(
        (newTime: Date) => {
            console.log('[Timeline] User changed current time:', newTime.toISOString())
            setCurrentTime(newTime)

            // Emit time:changeRequested event for TimeControl to respond
            const payload = {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: newTime.toISOString(),
            }
            console.log('[Timeline] Emitting time:changeRequested:', payload)
            mmgisEmit('time:changeRequested', payload)
        },
        [startTime, endTime]
    )

    // Live time while the scrubber is dragged: the header date follows along,
    // but nothing is emitted until the drag is released.
    const handleCurrentTimePreview = useCallback((newTime: Date) => {
        setCurrentTime(newTime)
    }, [])

    // Handle current date change
    const handleCurrentDateChange = useCallback(
        (newCurrent: Date) => {
            setCurrentTime(newCurrent)

            // Emit time:changeRequested event for TimeControl to respond
            mmgisEmit('time:changeRequested', {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: newCurrent.toISOString(),
            })
        },
        [startTime, endTime]
    )

    // Playback logic
    const handleStepForward = useCallback(() => {
        const { unit, value } = getTimeStep(timeMode)
        const nextTime = moment(currentTime).add(value, unit as moment.unitOfTime.DurationConstructor).toDate()
        if (nextTime <= endTime) {
            handleCurrentTimeChange(nextTime)
        }
    }, [currentTime, endTime, timeMode, handleCurrentTimeChange])

    const handleStepBackward = useCallback(() => {
        const { unit, value } = getTimeStep(timeMode)
        const prevTime = moment(currentTime).subtract(value, unit as moment.unitOfTime.DurationConstructor).toDate()
        if (prevTime >= startTime) {
            handleCurrentTimeChange(prevTime)
        }
    }, [currentTime, startTime, timeMode, handleCurrentTimeChange])

    const handleGoToStart = useCallback(() => {
        handleCurrentTimeChange(startTime)
    }, [startTime, handleCurrentTimeChange])

    const handleGoToEnd = useCallback(() => {
        handleCurrentTimeChange(endTime)
    }, [endTime, handleCurrentTimeChange])

    useEffect(() => {
        if (!isPlaying) return

        const { unit, value } = getTimeStep(timeMode)
        // Base cadence is one step per second, divided by the playback speed
        // multiplier (2x -> 500ms, 4x -> 250ms, 0.5x -> 2000ms).
        const speed = 1000 / playbackSpeed

        const interval = setInterval(() => {
            setCurrentTime(prev => {
                const nextTime = moment(prev).add(value, unit as moment.unitOfTime.DurationConstructor).toDate()
                if (nextTime <= endTime) {
                    // Emit time:changeRequested event to notify TimeControl
                    const payload = {
                        startTime: startTime.toISOString(),
                        endTime: endTime.toISOString(),
                        currentTime: nextTime.toISOString(),
                    }
                    console.log('[Timeline] Playback emitting time:changeRequested:', payload)
                    mmgisEmit('time:changeRequested', payload)
                    return nextTime
                } else {
                    console.log('[Timeline] Playback reached end, stopping')
                    setIsPlaying(false)
                    return prev
                }
            })
        }, speed)

        return () => clearInterval(interval)
    }, [isPlaying, timeMode, endTime, startTime, playbackSpeed])

    if (!isReady) {
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
                        onDateChange={handleCurrentDateChange}
                    />
                </div>
                <div className="timeline-header-center">
                    <PlaybackControls
                        isPlaying={isPlaying}
                        showPlayButton={allowPlayback}
                        onPlayToggle={() => setIsPlaying(!isPlaying)}
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
                            className="timeline-tool-btn"
                            onClick={() => resetZoomFn?.()}
                            title="Reset Zoom"
                            disabled={!resetZoomFn}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/>
                            </svg>
                        </button>
                        <button
                            ref={infoButtonRef}
                            className="timeline-tool-btn"
                            onClick={() => setShowInfoPopup(!showInfoPopup)}
                            title="Info"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M0 0h24v24H0V0z" fill="none"/>
                                <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                            </svg>
                        </button>
                        <button
                            className="timeline-tool-btn timeline-collapse-btn"
                            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
                            title={isCollapsed ? 'Expand timeline' : 'Collapse timeline'}
                            aria-expanded={!isCollapsed}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
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
                            No layers on the timeline yet
                        </div>
                        <div className="timeline-empty-hint">
                            Add or enable time-enabled layers on the map to see
                            them here.
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
                anchorRef={infoButtonRef}
                isOpen={showInfoPopup}
                onClose={() => setShowInfoPopup(false)}
                placement="top"
                offset={8}
                className="timeline-info-tooltip-portal"
            >
                <div className="timeline-info-tooltip-content">
                    <strong>Timeline Controls</strong>
                    <p>Scroll to zoom • Drag scrubber to change time • Click to jump</p>
                </div>
            </FloatingPopover>
        </div>
    )
}


