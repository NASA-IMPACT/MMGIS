import { useCallback, useEffect, useState } from 'react'
import type {
    ContainerPoint,
    LatLng,
    MapOverlayOpts,
    MapSubscribeHandlers,
} from '../types'
import { MEASURE_STYLE } from '../utils/measure'

const MEASURE_OVERLAY_ID = 'plugin:mapcontrol:measure'

export type MeasureCallbacks = {
    subscribeToMap?: (handlers: MapSubscribeHandlers) => () => void
    onDrawOverlay?: (opts: MapOverlayOpts) => void
    onRemoveOverlay?: (id: string) => void
    onProjectLatLng?: (latlng: LatLng) => Promise<ContainerPoint | null>
    onSetCursor?: (cursor: string) => void
}

export type MeasureState = {
    /** True only if the map callbacks needed for measuring were provided. */
    supported: boolean
    measuring: boolean
    /** Two-point segment being measured (or live preview), else null. */
    segment: [LatLng, LatLng] | null
    /** Pixel position for the distance label, or null. */
    labelPixel: ContainerPoint | null
    /** No points collected yet (show the hint). */
    awaitingFirst: boolean
    toggle: () => void
    stop: () => void
}

/**
 * Owns measure-mode state: subscribes to map click/move, collects two points,
 * draws the line overlay, and projects the midpoint to a pixel for the label.
 * All map interaction is via injected callbacks — no MMGIS coupling.
 */
export function useMeasure({
    subscribeToMap,
    onDrawOverlay,
    onRemoveOverlay,
    onProjectLatLng,
    onSetCursor,
}: MeasureCallbacks): MeasureState {
    const [measuring, setMeasuring] = useState(false)
    const [points, setPoints] = useState<LatLng[]>([])
    const [mouseLatLng, setMouseLatLng] = useState<LatLng | null>(null)
    const [labelPixel, setLabelPixel] = useState<ContainerPoint | null>(null)

    const supported = Boolean(subscribeToMap && onDrawOverlay && onRemoveOverlay)

    let segment: [LatLng, LatLng] | null = null
    if (measuring) {
        if (points.length === 2) segment = [points[0], points[1]]
        else if (points.length === 1 && mouseLatLng) segment = [points[0], mouseLatLng]
    }

    // Subscribe to map click/move while measuring
    useEffect(() => {
        if (!measuring || !subscribeToMap) return
        const unsub = subscribeToMap({
            onClick: (e) => {
                if (e?.lat == null || e?.lng == null) return
                setPoints((prev) =>
                    prev.length >= 2
                        ? [{ lat: e.lat, lng: e.lng }]
                        : [...prev, { lat: e.lat, lng: e.lng }]
                )
            },
            onMouseMove: (e) => {
                if (e?.lat != null && e?.lng != null) setMouseLatLng({ lat: e.lat, lng: e.lng })
            },
        })
        if (onSetCursor) onSetCursor('crosshair')
        return () => {
            unsub()
            if (onSetCursor) onSetCursor('')
        }
    }, [measuring, subscribeToMap, onSetCursor])

    // Draw / update the measure overlay
    useEffect(() => {
        if (!onDrawOverlay || !onRemoveOverlay) return
        if (!measuring || points.length === 0) {
            onRemoveOverlay(MEASURE_OVERLAY_ID)
            return
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const features: any[] = points.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: {},
        }))
        if (segment) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [segment[0].lng, segment[0].lat],
                        [segment[1].lng, segment[1].lat],
                    ],
                },
                properties: {},
            })
        }
        onDrawOverlay({
            id: MEASURE_OVERLAY_ID,
            geojson: { type: 'FeatureCollection', features },
            style: MEASURE_STYLE,
        })
        // mouseLatLng intentionally in deps — redraws the preview line on move.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measuring, points, mouseLatLng, onDrawOverlay, onRemoveOverlay])

    // Cleanup overlay on unmount
    useEffect(() => () => onRemoveOverlay?.(MEASURE_OVERLAY_ID), [onRemoveOverlay])

    // Project segment midpoint → pixel for the distance label
    useEffect(() => {
        if (!segment || !onProjectLatLng) {
            setLabelPixel(null)
            return
        }
        const mid = {
            lat: (segment[0].lat + segment[1].lat) / 2,
            lng: (segment[0].lng + segment[1].lng) / 2,
        }
        let cancelled = false
        Promise.resolve(onProjectLatLng(mid)).then((pt) => {
            if (!cancelled && pt?.x != null && pt?.y != null) setLabelPixel({ x: pt.x, y: pt.y })
        })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segment?.[0]?.lat, segment?.[0]?.lng, segment?.[1]?.lat, segment?.[1]?.lng, onProjectLatLng])

    const stop = useCallback(() => {
        setMeasuring(false)
        setPoints([])
        setMouseLatLng(null)
        setLabelPixel(null)
    }, [])
    const toggle = useCallback(() => {
        setMeasuring((prev) => {
            setPoints([])
            if (prev) {
                setMouseLatLng(null)
                setLabelPixel(null)
            }
            return !prev
        })
    }, [])

    return {
        supported,
        measuring,
        segment,
        labelPixel,
        awaitingFirst: measuring && points.length === 0,
        toggle,
        stop,
    }
}
