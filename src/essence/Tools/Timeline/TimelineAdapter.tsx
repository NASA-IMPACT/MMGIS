import React, { useState, useEffect, useCallback, useRef } from 'react'
import moment from 'moment'
import { FloatingPopover } from '../../Ancillary/FloatingPopover'
import { mmgisRequest, mmgisOn, mmgisEmit, mmgisGetLayerConfigs, mmgisGetRawConfigData, mmgisGetVisibleLayers } from './adapters/mmgisAPI'
import {
    TimelineView,
    TimeModeControl,
    DateSelector,
    PlaybackControls,
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
    const [layers, setLayers] = useState<LayerTimeData[]>([])
    const [isReady, setIsReady] = useState(false)

    const [isPlaying, setIsPlaying] = useState(false)
    const [layerVisibilityVersion, setLayerVisibilityVersion] = useState(0)
    const [showInfoPopup, setShowInfoPopup] = useState(false)
    const [resetZoomFn, setResetZoomFn] = useState<(() => void) | null>(null)
    const infoButtonRef = useRef<HTMLButtonElement>(null)

    const handleResetZoomReady = useCallback((fn: () => void) => {
        setResetZoomFn(() => fn)
    }, [])

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
                    if (timeConfig.dateEndTime) {
                        const parsedEnd = timeConfig.dateEndTime === 'now' ? new Date() : new Date(timeConfig.dateEndTime)
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

            // Emit time:userChanged event for TimeControl to respond
            const payload = {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: newTime.toISOString(),
            }
            console.log('[Timeline] Emitting time:userChanged:', payload)
            mmgisEmit('time:userChanged', payload)
        },
        [startTime, endTime]
    )

    // Handle current date change
    const handleCurrentDateChange = useCallback(
        (newCurrent: Date) => {
            setCurrentTime(newCurrent)

            // Emit time:userChanged event for TimeControl to respond
            mmgisEmit('time:userChanged', {
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
        // Adjust interval speed based on mode (e.g. DAY is faster than MONTH)
        const speed = 1000

        const interval = setInterval(() => {
            setCurrentTime(prev => {
                const nextTime = moment(prev).add(value, unit as moment.unitOfTime.DurationConstructor).toDate()
                if (nextTime <= endTime) {
                    // Emit time:userChanged event to notify TimeControl
                    const payload = {
                        startTime: startTime.toISOString(),
                        endTime: endTime.toISOString(),
                        currentTime: nextTime.toISOString(),
                    }
                    console.log('[Timeline] Playback emitting time:userChanged:', payload)
                    mmgisEmit('time:userChanged', payload)
                    return nextTime
                } else {
                    console.log('[Timeline] Playback reached end, stopping')
                    setIsPlaying(false)
                    return prev
                }
            })
        }, speed)

        return () => clearInterval(interval)
    }, [isPlaying, timeMode, endTime, startTime])

    if (!isReady) {
        return (
            <div className="timeline-loading">
                <div className="loading-message">Loading timeline...</div>
            </div>
        )
    }

    return (
        <div className="timeline">
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
                        onPlayToggle={() => setIsPlaying(!isPlaying)}
                        onStepForward={handleStepForward}
                        onStepBackward={handleStepBackward}
                        onGoToStart={handleGoToStart}
                        onGoToEnd={handleGoToEnd}
                    />
                </div>
                <div className="timeline-header-right">
                    <TimeModeControl
                        currentMode={timeMode}
                        onModeChange={setTimeMode}
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
                    </div>
                </div>
            </div>
            <div className="timeline-content">
                <TimelineView
                    startTime={startTime}
                    endTime={endTime}
                    currentTime={currentTime}
                    timeMode={timeMode}
                    layers={layers}
                    onCurrentTimeChange={handleCurrentTimeChange}
                    onResetZoomReady={handleResetZoomReady}
                />
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


