import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { scaleTime } from 'd3-scale'
import { axisBottom } from 'd3-axis'
import { select } from 'd3-selection'
import { zoom, ZoomBehavior } from 'd3-zoom'
import type { TimeMode, LayerTimeData } from '../../types'
import { generateTimeTicks, formatDateByMode, clampDate, stepTime } from '../../utils/timeUtils'
import {
    minViewDuration,
    transformToWindow,
    windowToTransform,
    type ViewWindow,
} from '../../utils/zoomWindow'
import moment from 'moment'
import { LayerTimeline } from '../LayerTimeline/LayerTimeline'
import { LayerSidebarItem } from '../LayerSidebarItem/LayerSidebarItem'
import type { LayerNavigation } from '../../utils/layerNavigation'

export interface TimelineViewProps {
    startTime: Date
    endTime: Date
    currentTime: Date
    timeMode: TimeMode
    layers: LayerTimeData[]
    /** Committed time change — fires once the scrubber is released. */
    onCurrentTimeChange: (time: Date) => void
    /** Live time while the scrubber is being dragged, for display only. */
    onCurrentTimePreview?: (time: Date) => void
    /**
     * The instant a layer row's navigation controls lead to, with the model it
     * came from. Separate from `onCurrentTimeChange`, which clamps to the
     * timeline's window: a layer's data may sit outside the window shown.
     */
    onLayerNavigate: (target: Date, navigation: LayerNavigation) => void
    /** The visible window. The d3 transform is derived from it, never held. */
    view: ViewWindow
    /** A window a wheel or drag gesture arrived at. */
    onViewChange: (win: ViewWindow) => void
    /** The dashboard's display granularity, which sets how far in zoom may go. */
    configuredGranularity: TimeMode
    /** Frames one layer's own span, from the row's magnifier. */
    onFitLayer: (layer: LayerTimeData) => void
}

export const TimelineView: React.FC<TimelineViewProps> = ({
    startTime,
    endTime,
    currentTime,
    timeMode,
    layers,
    onCurrentTimeChange,
    onCurrentTimePreview,
    onLayerNavigate,
    view,
    onViewChange,
    configuredGranularity,
    onFitLayer,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const axisRef = useRef<SVGGElement>(null)
    const topAxisRef = useRef<SVGGElement>(null)
    const [isDragging, setIsDragging] = useState(false)
    // Where the scrubber sits mid-drag. The committed time only changes on mouse up.
    const [dragTime, setDragTime] = useState<Date | null>(null)
    // True once a drag has actually moved, so the trailing click doesn't re-seek.
    const didDragRef = useRef(false)
    const [dimensions, setDimensions] = useState({ width: 800, height: 200 })

    const axisHeight = 24 // Space for the bottom axis
    const layerBarHeight = 20 // Row pitch, shared by the sidebar item and the SVG row
    const topBarHeight = 24 // Space for top axis
    const markerSize = 18 // Rendered size of the scrubber marker

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

    /** The global window, as the transform conversions take it. */
    const bounds = useMemo(
        () => ({ start: startTime, end: endTime }),
        [startTime, endTime]
    )

    // The visible window is the domain on screen, so the axes and the layer
    // bars read it directly. Memoized so the axis effects below only fire when
    // the window or the width actually change; rebuilt every render they would
    // tear down and redraw both axes on every pointermove of a scrubber drag.
    const transformedXScale = useMemo(
        () => scaleTime().domain([view.start, view.end]).range([0, dimensions.width]),
        [view, dimensions.width]
    )

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

        // Sizing only — fill and family come from .timeline-axis .tick text
        axisGroup.selectAll('.tick text')
            .style('font-size', '11px')
    }, [transformedXScale, timeMode, totalLayersHeight, dimensions.width])

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

        // Sizing only — fill and family come from .timeline-top-axis .tick text
        topAxisGroup.selectAll('.tick text')
            .style('font-size', '11px')
            .style('font-weight', '600')
    }, [transformedXScale, dimensions.width])

    // The zoom behaviour is held so the push effect below can hand it a
    // transform, keeping d3's own internal state in step with the window.
    const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
    // The zoom handler is built once per behaviour but must always read the
    // window and the callback of the latest render, so both go through refs
    // rather than into the behaviour's dependencies: rebuilding the behaviour
    // on every parent render would tear its listeners down mid-gesture.
    const viewRef = useRef(view)
    const onViewChangeRef = useRef(onViewChange)
    useEffect(() => {
        viewRef.current = view
        onViewChangeRef.current = onViewChange
    }, [view, onViewChange])

    // Setup zoom behavior
    useEffect(() => {
        const node = svgRef.current
        if (!node) return
        // At zero width both conversions fall back to the global window, so a
        // push here reads that back out and discards the view. A chart this
        // wide is hidden anyway; the effect reruns once it has width.
        if (!(dimensions.width > 0)) return

        // The cap is the ratio of the global window to the tightest span the
        // displayed granularity allows, so the tightest reachable view carries
        // the same tick density whatever the mission is configured for.
        const boundsSpan = bounds.end.getTime() - bounds.start.getTime()
        const maxScale = Math.max(
            1,
            boundsSpan / minViewDuration(configuredGranularity)
        )

        const zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
            // The lower bound stays 1: zooming out past the global window
            // shows empty space either side and is not useful.
            .scaleExtent([1, maxScale])
            // The viewport is the chart's own box. Given explicitly rather
            // than left to d3 to read off the element: the SVG is sized from
            // these same numbers, and reading them back needs the SVG
            // geometry API, which jsdom does not implement.
            .extent([
                [0, 0],
                [dimensions.width, dimensions.height],
            ])
            .translateExtent([
                [0, 0],
                [dimensions.width, dimensions.height],
            ])
            // Grabbing the scrubber drags it instead of panning the view.
            .filter((event: any) => {
                if (event.target?.closest?.('.timeline-scrubber-handle')) return false
                return !event.ctrlKey && !event.button
            })
            .on('zoom', (event) => {
                const next = transformToWindow(
                    event.transform,
                    bounds,
                    dimensions.width
                )
                // Pushing a transform in re-fires this handler with the window
                // it was just given. Compared by value rather than flagged:
                // a flag has to be cleared, and a transition interrupted
                // partway — by a wheel event arriving mid-animation, which is
                // ordinary use — leaves it set. The comparison is exact to the
                // millisecond because the two conversions round-trip exactly.
                const held = viewRef.current
                if (
                    next.start.getTime() === held.start.getTime() &&
                    next.end.getTime() === held.end.getTime()
                )
                    return
                onViewChangeRef.current(next)
            })

        zoomBehaviorRef.current = zoomBehavior
        const svg = select(node)
        svg.call(zoomBehavior as any)
        // A fresh behaviour starts from the window held, not from d3's
        // identity: the first gesture would otherwise jump from the global
        // window to wherever it lands.
        svg.call(
            zoomBehavior.transform as any,
            windowToTransform(viewRef.current, bounds, dimensions.width)
        )

        return () => {
            // A gesture open across this teardown keeps dispatching through
            // this behaviour. Detaching stops it reading the window through
            // these bounds and this width.
            zoomBehavior.on('zoom', null)
            svg.on('.zoom', null)

            // d3 writes the node's transform before it notifies, so a
            // silenced gesture still walks it away from the window. Only an
            // open gesture needs releasing.
            const gestured = node as unknown as { __zooming?: unknown }
            if (gestured.__zooming) {
                // The move listener does the walking. Its mouseup stays: that
                // re-enables text selection and ends the gesture.
                const nodeWindow = node.ownerDocument?.defaultView
                if (nodeWindow) select(nodeWindow).on('mousemove.zoom', null)

                // A gesture is claimed by name from the node, so the
                // replacement finds this one and dispatches through the
                // listeners just detached, leaving the chart inert.
                delete gestured.__zooming
            }

            zoomBehaviorRef.current = null
        }
    }, [bounds, dimensions, configuredGranularity])

    // Push the window into d3 so wheel and drag gestures start from where the
    // view actually is, rather than from wherever the last gesture left it.
    useEffect(() => {
        const zoomBehavior = zoomBehaviorRef.current
        if (!svgRef.current || !zoomBehavior) return
        // No behaviour is built at zero width; this guards the same fallback.
        if (!(dimensions.width > 0)) return

        select(svgRef.current).call(
            zoomBehavior.transform as any,
            windowToTransform(view, bounds, dimensions.width)
        )
    }, [view, bounds, dimensions])

    // Update scrubber position — it follows the pointer while dragging
    const scrubberTime = dragTime ?? currentTime
    const scrubberX = transformedXScale(scrubberTime)

    // Scrubber drag. Pointer capture covers mouse, touch and pen in one path
    // and keeps move/up on the handle even when the pointer leaves the SVG.
    const handleScrubberPointerDown = useCallback(
        (event: React.PointerEvent) => {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture?.(event.pointerId)
            didDragRef.current = false
            setDragTime(currentTime)
            setIsDragging(true)
        },
        [currentTime]
    )

    const handleScrubberPointerMove = useCallback(
        (event: React.PointerEvent) => {
            if (!isDragging || !svgRef.current) return

            const svgRect = svgRef.current.getBoundingClientRect()
            const x = event.clientX - svgRect.left
            const newTime = transformedXScale.invert(x)
            const clampedTime = clampDate(newTime, startTime, endTime)

            didDragRef.current = true
            setDragTime(clampedTime)
            onCurrentTimePreview?.(clampedTime)
        },
        [isDragging, transformedXScale, startTime, endTime, onCurrentTimePreview]
    )

    // Commit the date the scrubber landed on, once the drag ends
    const handleScrubberPointerUp = useCallback(
        (event: React.PointerEvent) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId)
            if (didDragRef.current && dragTime) onCurrentTimeChange(dragTime)
            didDragRef.current = false
            setDragTime(null)
            setIsDragging(false)
        },
        [dragTime, onCurrentTimeChange]
    )

    const scrubberPointerHandlers = {
        onPointerDown: handleScrubberPointerDown,
        onPointerMove: handleScrubberPointerMove,
        onPointerUp: handleScrubberPointerUp,
        onPointerCancel: handleScrubberPointerUp,
    }

    /** Arrow keys step by the current granularity; Home/End jump to the ends. */
    const handleScrubberKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            let next: Date | null = null

            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowDown':
                    next = stepTime(currentTime, timeMode, -1)
                    break
                case 'ArrowRight':
                case 'ArrowUp':
                    next = stepTime(currentTime, timeMode, 1)
                    break
                case 'Home':
                    next = startTime
                    break
                case 'End':
                    next = endTime
                    break
                default:
                    return
            }

            event.preventDefault()
            event.stopPropagation()
            onCurrentTimeChange(clampDate(next, startTime, endTime))
        },
        [currentTime, timeMode, startTime, endTime, onCurrentTimeChange]
    )

    // Handle click on timeline to jump to that time
    const handleTimelineClick = useCallback(
        (event: React.MouseEvent<SVGSVGElement>) => {
            if (isDragging) return
            // Clicks on the handle grab the scrubber; they never re-seek, and a
            // drag's trailing click retargets here through pointer capture.
            if ((event.target as Element)?.closest?.('.timeline-scrubber-handle')) {
                didDragRef.current = false
                return
            }
            if (didDragRef.current) {
                didDragRef.current = false
                return
            }

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
                            <LayerSidebarItem
                                key={layer.name}
                                layer={layer}
                                height={layerBarHeight}
                                currentTime={currentTime}
                                timeMode={timeMode}
                                onNavigate={onLayerNavigate}
                                onFit={onFitLayer}
                            />
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
                        <defs>
                            {/* Region widened past the default 120% so the blur
                                isn't clipped at the marker's edges. */}
                            <filter
                                id="timeline-scrubber-shadow"
                                x="-100%"
                                y="-100%"
                                width="300%"
                                height="300%"
                            >
                                <feDropShadow
                                    dx="0"
                                    dy="0"
                                    stdDeviation="5"
                                    floodOpacity="0.2"
                                />
                            </filter>
                        </defs>

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
                        <g className="timeline-scrubber">
                            {/* Scrubber line through all layers */}
                            <line
                                x1={scrubberX}
                                y1={0}
                                x2={scrubberX}
                                y2={totalLayersHeight}
                                strokeWidth="2"
                                className="timeline-scrubber-line"
                                style={{ pointerEvents: 'none' }}
                            />

                            {/* Scrubber diamond head at the top of the layers.
                                Drawn in the marker artwork's own 43x42 space, then
                                scaled to markerSize and centred on the scrubber. */}
                            <g
                                transform={`translate(${scrubberX}, ${markerSize / 2}) scale(${markerSize / 22}) translate(-21.3609, -21)`}
                                filter="url(#timeline-scrubber-shadow)"
                                className="timeline-scrubber-handle"
                                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                                tabIndex={0}
                                role="slider"
                                aria-label="Current time"
                                aria-valuemin={startTime.getTime()}
                                aria-valuemax={endTime.getTime()}
                                aria-valuenow={scrubberTime.getTime()}
                                aria-valuetext={moment.utc(scrubberTime).format('MMM D, YYYY HH:mm [UTC]')}
                                onKeyDown={handleScrubberKeyDown}
                                {...scrubberPointerHandlers}
                            >
                                <path
                                    d="M21.3609 10L32.7219 21L21.3609 32L10 21L21.3609 10Z"
                                    className="timeline-scrubber-marker"
                                />
                                <path
                                    d="M31.2832 21L21.3604 30.6074L11.4375 21L21.3604 11.3916L31.2832 21Z"
                                    strokeWidth="2"
                                    fill="none"
                                    className="timeline-scrubber-marker-inline"
                                />
                            </g>

                            {/* Invisible band widening the grab area along the line */}
                            <rect
                                x={scrubberX - 5}
                                y={0}
                                width={10}
                                height={Math.max(totalLayersHeight, 16)}
                                fill="transparent"
                                className="timeline-scrubber-handle"
                                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                                aria-hidden="true"
                                {...scrubberPointerHandlers}
                            />
                        </g>
                    </svg>
                </div>
            </div>
        </>
    )
}
