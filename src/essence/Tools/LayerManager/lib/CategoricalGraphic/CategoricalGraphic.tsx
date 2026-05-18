import React from 'react'
import { useState, useCallback, useRef, type MouseEvent } from 'react'
import type { CategoricalStop } from '../types'
import styles from './CategoricalGraphic.module.scss'

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
            <div className={styles.categoricalGraphic}>
                <div className={styles.categoricalBarRow}>
                    <div
                        ref={barRef}
                        className={styles.categoricalSwatchLine}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        {stops.map((stop, index) => (
                            <div
                                key={`${stop.color}-${index}`}
                                className={styles.categoricalSwatchSegment}
                                style={{ backgroundColor: stop.color }}
                            />
                        ))}
                        {hoverLabel !== null && (
                            <div
                                className={`${styles.categoricalTooltip} ${styles.visible}`}
                                style={{ left: tooltipPos.x }}
                            >
                                {hoverLabel}
                            </div>
                        )}
                    </div>
                    <div className={styles.categoricalSpacer} />
                </div>
                {stops.length > 1 && (
                    <div
                        className={styles.categoricalToggle}
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
        <div className={styles.categoricalGraphic}>
            <div className={styles.categoricalList}>
                {stops.map((stop, index) => (
                    <div key={`${stop.color}-${index}`} className={styles.categoricalItem}>
                        <div className={styles.categoricalSwatch} style={{ backgroundColor: stop.color }} />
                        <span className={styles.categoricalLabel}>{stop.label}</span>
                    </div>
                ))}
            </div>
            <div className={styles.categoricalToggle} onClick={() => setIsExpanded(false)}>
                <i className="mdi mdi-chevron-up mdi-14px" />
                <span>Collapse</span>
            </div>
        </div>
    )
}
