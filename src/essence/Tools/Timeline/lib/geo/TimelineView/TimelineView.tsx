import React, { useRef, useEffect, useState, useCallback } from 'react'
import { scaleTime } from 'd3-scale'
import { axisBottom } from 'd3-axis'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom'
import type { TimeMode, LayerTimeData } from '../../types'
import { generateTimeTicks, formatDateByMode, clampDate } from '../../utils/timeUtils'
import { LayerTimeline } from '../LayerTimeline/LayerTimeline'

export interface TimelineViewProps {
    startTime: Date
    endTime: Date
    currentTime: Date
    timeMode: TimeMode
    layers: LayerTimeData[]
    onCurrentTimeChange: (time: Date) => void
    onResetZoomReady?: (resetZoomFn: () => void) => void
}

export const TimelineView: React.FC<TimelineViewProps> = ({
    startTime,
    endTime,
    currentTime,
    timeMode,
    layers,
    onCurrentTimeChange,
    onResetZoomReady,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const axisRef = useRef<SVGGElement>(null)
    const topAxisRef = useRef<SVGGElement>(null)
    const scrubberRef = useRef<SVGGElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [dimensions, setDimensions] = useState({ width: 800, height: 200 })
    const [zoomTransform, setZoomTransform] = useState(zoomIdentity)

    const axisHeight = 24 // Space for the bottom axis
    const layerBarHeight = 15
    const topBarHeight = 24 // Space for top axis

    // Calculate total height needed for layers
    const totalLayersHeight = layers.length * layerBarHeight

    // Calculate required SVG height
    const requiredHeight = axisHeight + totalLayersHeight

    // Update dimensions on resize
    useEffect(() => {
        if (!containerRef.current) return

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width } = entry.contentRect
                setDimensions({ width, height: requiredHeight })
            }
        })

        resizeObserver.observe(containerRef.current)
        return () => resizeObserver.disconnect()
    }, [requiredHeight])

    // Create scales
    const xScale = scaleTime()
        .domain([startTime, endTime])
        .range([0, dimensions.width])

    const transformedXScale = zoomTransform.rescaleX(xScale)

    // Render bottom axis
    useEffect(() => {
        if (!axisRef.current) return

        const [visibleStart, visibleEnd] = transformedXScale.domain() as [Date, Date]
        const tickValues = generateTimeTicks(visibleStart, visibleEnd, timeMode, Math.max(2, Math.floor(dimensions.width / 80)))
        const axis = axisBottom(transformedXScale)
            .tickValues(tickValues)
            .tickFormat((d) => formatDateByMode(d as Date, timeMode))
            .tickSize(6)
            .tickPadding(8)

        const axisGroup = select(axisRef.current)
        axisGroup.selectAll('*').remove() // Clear existing axis
        axisGroup.call(axis as any)

        // Grid lines shooting up through the layers
        axisGroup.selectAll('.tick line').attr('y2', -totalLayersHeight)

        // Ensure text is visible
        axisGroup.selectAll('.tick text')
            .attr('fill', '#565c65')
            .style('font-size', '11px')
            .style('font-family', "'Inter', system-ui, -apple-system, sans-serif")
    }, [transformedXScale, timeMode, totalLayersHeight, startTime, endTime])

    // Render top axis for month/year (like JAN 2025)
    useEffect(() => {
        if (!topAxisRef.current) return

        const [visibleStart, visibleEnd] = transformedXScale.domain() as [Date, Date]
        const tickValues = generateTimeTicks(visibleStart, visibleEnd, 'MONTH', Math.max(2, Math.floor(dimensions.width / 100)))
        const topAxis = axisBottom(transformedXScale)
            .tickValues(tickValues)
            .tickFormat((d) => formatDateByMode(d as Date, 'MONTH'))
            .tickSize(0)
            .tickPadding(6)

        const topAxisGroup = select(topAxisRef.current)
        topAxisGroup.selectAll('*').remove() // Clear existing axis
        topAxisGroup.call(topAxis as any)

        // Ensure text is visible
        topAxisGroup.selectAll('.tick text')
            .attr('fill', '#71767a')
            .style('font-size', '11px')
            .style('font-weight', '600')
            .style('font-family', "'Inter', system-ui, -apple-system, sans-serif")
    }, [transformedXScale, startTime, endTime])

    // Setup zoom behavior
    useEffect(() => {
        if (!svgRef.current) return

        const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
            .scaleExtent([1, 50])
            .translateExtent([
                [0, 0],
                [dimensions.width, dimensions.height],
            ])
            .on('zoom', (event) => {
                setZoomTransform(event.transform)
            })

        const svg = select(svgRef.current)
        svg.call(zoomBehavior as any)

        // Expose reset zoom function to parent
        if (onResetZoomReady) {
            const resetZoom = () => {
                svg.transition().duration(300).call(zoomBehavior.transform as any, zoomIdentity)
            }
            onResetZoomReady(resetZoom)
        }

        return () => {
            svg.on('.zoom', null)
        }
    }, [dimensions, onResetZoomReady])

    // Update scrubber position
    const scrubberX = transformedXScale(currentTime)

    // Handle scrubber drag
    const handleScrubberMouseDown = useCallback(() => {
        setIsDragging(true)
    }, [])

    const handleMouseMove = useCallback(
        (event: MouseEvent) => {
            if (!isDragging || !svgRef.current) return

            const svgRect = svgRef.current.getBoundingClientRect()
            const x = event.clientX - svgRect.left
            const newTime = transformedXScale.invert(x)
            const clampedTime = clampDate(newTime, startTime, endTime)

            onCurrentTimeChange(clampedTime)
        },
        [isDragging, transformedXScale, startTime, endTime, onCurrentTimeChange]
    )

    const handleMouseUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)

            return () => {
                window.removeEventListener('mousemove', handleMouseMove)
                window.removeEventListener('mouseup', handleMouseUp)
            }
        }
    }, [isDragging, handleMouseMove, handleMouseUp])

    // Handle click on timeline to jump to that time
    const handleTimelineClick = useCallback(
        (event: React.MouseEvent<SVGSVGElement>) => {
            if (isDragging) return

            const svgRect = event.currentTarget.getBoundingClientRect()
            const x = event.clientX - svgRect.left
            const newTime = transformedXScale.invert(x)
            const clampedTime = clampDate(newTime, startTime, endTime)

            onCurrentTimeChange(clampedTime)
        },
        [isDragging, transformedXScale, startTime, endTime, onCurrentTimeChange]
    )

    return (
        <>
            <div className="timeline-view-container" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
                {/* Layers Sidebar */}
                <div className="timeline-sidebar" style={{ flexShrink: 0 }}>
                    <div className="timeline-sidebar-header" style={{ height: topBarHeight, flexShrink: 0, minHeight: topBarHeight }}></div>
                    <div className="timeline-sidebar-layers">
                        {layers.map((layer) => (
                            <div className="layer-item" key={layer.name} style={{ height: layerBarHeight, flexShrink: 0 }}>
                                <span className="layer-color-dot" style={{ backgroundColor: layer.color }}></span>
                                <span className="layer-name">{layer.displayName}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Timeline SVG Area */}
                <div ref={containerRef} className="timeline-svg-container" style={{ minWidth: 0 }}>
                    <div className="timeline-top-bar" style={{ height: topBarHeight, flexShrink: 0, minHeight: topBarHeight }}>
                        <svg width={dimensions.width} height={topBarHeight} style={{ display: 'block' }}>
                            <g ref={topAxisRef} transform={`translate(0, 4)`} className="timeline-top-axis" />
                        </svg>
                    </div>
                    <svg
                        ref={svgRef}
                        width={dimensions.width}
                        height={dimensions.height}
                        onClick={handleTimelineClick}
                        style={{ cursor: isDragging ? 'grabbing' : 'crosshair', display: 'block', flexShrink: 0, minHeight: dimensions.height }}
                    >
                        {/* Layer timelines (rendered first so grid/scrubber goes on top) */}
                        <g className="layer-timelines">
                            {layers.map((layer, index) => (
                                <g key={layer.name}>
                                    <rect 
                                        x={0} 
                                        y={index * layerBarHeight} 
                                        width={dimensions.width} 
                                        height={layerBarHeight} 
                                        fill="transparent"
                                        className="layer-row-bg"
                                    />
                                    <LayerTimeline
                                        layer={layer}
                                        xScale={transformedXScale}
                                        y={index * layerBarHeight}
                                        height={layerBarHeight}
                                    />
                                </g>
                            ))}
                        </g>

                        {/* Bottom Time axis */}
                        <g
                            ref={axisRef}
                            transform={`translate(0, ${totalLayersHeight})`}
                            className="timeline-axis"
                        />

                        {/* Current time scrubber */}
                        <g ref={scrubberRef} className="timeline-scrubber">
                            {/* Scrubber line through all layers */}
                            <line
                                x1={scrubberX}
                                y1={0}
                                x2={scrubberX}
                                y2={totalLayersHeight}
                                stroke="#0b7a8a"
                                strokeWidth="2"
                                style={{ pointerEvents: 'none' }}
                            />

                            {/* Scrubber diamond head at the top of the layers */}
                            <polygon
                                points={`${scrubberX},0 ${scrubberX + 8},8 ${scrubberX},16 ${scrubberX - 8},8`}
                                fill="#0b7a8a"
                                stroke="#ffffff"
                                strokeWidth="1.5"
                                style={{ cursor: 'grab' }}
                                onMouseDown={handleScrubberMouseDown}
                            />
                        </g>
                    </svg>
                </div>
            </div>
        </>
    )
}
