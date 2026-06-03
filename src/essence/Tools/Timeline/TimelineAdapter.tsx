import React, { useState, useEffect, useCallback } from 'react'
import moment from 'moment'
import { mmgisRequest, mmgisOn, mmgisEmit, mmgisGetLayerConfigs, mmgisGetRawConfigData } from './adapters/mmgisAPI'
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

    useEffect(() => {
        const fetchLayers = () => {
            const configs = mmgisGetLayerConfigs()
            const rawConfig = mmgisGetRawConfigData()
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

            console.log('[Timeline] Fetching layer configs for timeline:', { configs, rawLayers })

            Object.keys(configs).forEach(layerName => {
                const layer = configs[layerName]
                
                let start = startTime
                let end = endTime
                let color = '#808080' // default grey
                
                if (layer.time && layer.time.enabled) {
                    let rawLayer = null
                    if (rawLayers.length > 0) {
                        rawLayer = findRawLayer(rawLayers, layerName)
                    }
                    const timeConfig = rawLayer?.time || layer.time

                    if (timeConfig.start) {
                        const parsedStart = new Date(timeConfig.start)
                        if (!isNaN(parsedStart.getTime())) {
                            start = parsedStart
                        }
                    }
                    if (timeConfig.end) {
                        const parsedEnd = timeConfig.end === 'now' ? new Date() : new Date(timeConfig.end)
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
    }, [startTime, endTime])

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

    // Handle start date change
    const handleStartDateChange = useCallback(
        (newStart: Date) => {
            setStartTime(newStart)

            // Emit time:userChanged event for TimeControl to respond
            mmgisEmit('time:userChanged', {
                startTime: newStart.toISOString(),
                endTime: endTime.toISOString(),
                currentTime: currentTime.toISOString(),
            })
        },
        [endTime, currentTime]
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
                        onDateChange={handleStartDateChange}
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
                />
            </div>
        </div>
    )
}


