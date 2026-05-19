import React from 'react'
import { useState, useCallback, useRef, type MouseEvent } from 'react'
import type { CategoricalStop } from '../types'

export type CategoricalGraphicProps = {
    stops: CategoricalStop[]
    defaultExpanded?: boolean
}

export function CategoricalGraphic({
    stops,
    defaultExpanded = false,
}: CategoricalGraphicProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)
    const [hoverLabel, setHoverLabel] = useState<string | null>(null)
    const [tooltipPos, setTooltipPos] = useState({ x: 0 })
    const barRef = useRef<HTMLDivElement | null>(null)

    const handleMouseMove = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
            if (!barRef.current || !stops || stops.length === 0) return
            const rect = barRef.current.getBoundingClientRect()
            const offsetX = e.clientX - rect.left
            const width = rect.width
            const segmentWidth = width / stops.length
            const segmentIndex = Math.min(
                Math.floor(offsetX / segmentWidth),
                stops.length - 1,
            )
            if (segmentIndex >= 0 && segmentIndex < stops.length) {
                setHoverLabel(stops[segmentIndex].label)
                setTooltipPos({ x: offsetX })
            }
        },
        [stops],
    )

    const handleMouseLeave = useCallback(() => setHoverLabel(null), [])

    if (!stops || stops.length === 0) return null

    if (!isExpanded) {
        return (
            <div className="blocks-categorical-graphic">
                <div className="blocks-categorical-graphic__bar-row">
                    <div
                        ref={barRef}
                        className="blocks-categorical-graphic__swatch-line"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        {stops.map((stop, index) => (
                            <div
                                key={`${stop.color}-${index}`}
                                className="blocks-categorical-graphic__swatch-segment"
                                style={{ backgroundColor: stop.color }}
                            />
                        ))}
                        {hoverLabel !== null && (
                            <div
                                className="blocks-categorical-graphic__tooltip blocks-categorical-graphic__tooltip--visible"
                                style={{ left: tooltipPos.x }}
                            >
                                {hoverLabel}
                            </div>
                        )}
                    </div>
                    <div className="blocks-categorical-graphic__spacer" />
                </div>
                {stops.length > 1 && (
                    <div
                        className="blocks-categorical-graphic__toggle"
                        onClick={() => setIsExpanded(true)}
                    >
                        <i className="mdi mdi-chevron-down mdi-14px" />
                        <span>Show {stops.length} categories</span>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="blocks-categorical-graphic">
            <div className="blocks-categorical-graphic__list">
                {stops.map((stop, index) => (
                    <div key={`${stop.color}-${index}`} className="blocks-categorical-graphic__item">
                        <div className="blocks-categorical-graphic__swatch" style={{ backgroundColor: stop.color }} />
                        <span className="blocks-categorical-graphic__label">{stop.label}</span>
                    </div>
                ))}
            </div>
            <div className="blocks-categorical-graphic__toggle" onClick={() => setIsExpanded(false)}>
                <i className="mdi mdi-chevron-up mdi-14px" />
                <span>Collapse</span>
            </div>
        </div>
    )
}
