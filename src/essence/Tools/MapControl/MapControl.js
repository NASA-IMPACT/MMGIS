// Plugin dependency: `@turf/turf` is imported below for great-circle distance
// in the measure tool. MMGIS already bundles it. To port this component to
// another project, install `@turf/turf` or swap the `distance` call for an
// equivalent implementation.
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { distance, point } from '@turf/turf'
import { formatDistance } from './MapControl.helpers'
import {
    bg,
    createStyles,
    resolveTheme,
    MEASURE_STYLE,
    BasemapIcon,
    PlusIcon,
    MinusIcon,
    RulerIcon,
} from './MapControl.styles'

const MEASURE_OVERLAY_ID = 'plugin:mapcontrol:measure'

function MapControl({
    styles = [],
    active = null,
    rightOffset = 12,
    theme,
    onSelectBasemap,
    onZoomIn,
    onZoomOut,
    subscribeToMap,
    drawOverlay,
    removeOverlay,
    projectLatLng,
    setMapCursor,
}) {
    const resolvedTheme = useMemo(() => resolveTheme(theme), [theme])
    const S = useMemo(() => createStyles(resolvedTheme), [resolvedTheme])

    const [open, setOpen] = useState(false)
    const [measuring, setMeasuring] = useState(false)
    const [points, setPoints] = useState([])
    const [mouseLatLng, setMouseLatLng] = useState(null)
    const [labelPixel, setLabelPixel] = useState(null)
    const rootRef = useRef(null)

    const measureSupported = Boolean(
        subscribeToMap && drawOverlay && removeOverlay
    )

    let segment = null
    if (measuring) {
        if (points.length === 2) segment = [points[0], points[1]]
        else if (points.length === 1 && mouseLatLng)
            segment = [points[0], mouseLatLng]
    }

    function toggleMeasure() {
        if (measuring) {
            setMeasuring(false)
            setPoints([])
            setMouseLatLng(null)
            setLabelPixel(null)
        } else {
            setMeasuring(true)
            setPoints([])
            setMouseLatLng(null)
            setLabelPixel(null)
            setOpen(false)
        }
    }

    useEffect(() => {
        function onDown(e) {
            if (rootRef.current && !rootRef.current.contains(e.target))
                setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [])

    useEffect(() => {
        function onKey(e) {
            if (e.key !== 'Escape') return
            setOpen(false)
            if (measuring) {
                setMeasuring(false)
                setPoints([])
            }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [measuring])

    useEffect(() => {
        if (!measuring || !subscribeToMap) return undefined

        const unsubscribe = subscribeToMap({
            onClick: (e) => {
                if (!e || e.lat == null || e.lng == null) return
                setPoints((prev) => {
                    if (prev.length >= 2) return [{ lat: e.lat, lng: e.lng }]
                    return prev.concat([{ lat: e.lat, lng: e.lng }])
                })
            },
            onMouseMove: (e) => {
                if (!e || e.lat == null || e.lng == null) return
                setMouseLatLng({ lat: e.lat, lng: e.lng })
            },
        })

        if (setMapCursor) setMapCursor('crosshair')

        return () => {
            if (typeof unsubscribe === 'function') unsubscribe()
            if (setMapCursor) setMapCursor('')
        }
    }, [measuring, subscribeToMap, setMapCursor])

    useEffect(() => {
        if (!drawOverlay || !removeOverlay) return

        if (!measuring || points.length === 0) {
            removeOverlay(MEASURE_OVERLAY_ID)
            return
        }

        const features = points.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
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
            })
        }

        drawOverlay({
            id: MEASURE_OVERLAY_ID,
            geojson: { type: 'FeatureCollection', features },
            style: MEASURE_STYLE,
        })
    }, [measuring, points, mouseLatLng, drawOverlay, removeOverlay])

    useEffect(() => {
        return () => {
            if (removeOverlay) removeOverlay(MEASURE_OVERLAY_ID)
        }
    }, [removeOverlay])

    useEffect(() => {
        if (!segment || !projectLatLng) {
            setLabelPixel(null)
            return undefined
        }
        const mid = {
            lat: (segment[0].lat + segment[1].lat) / 2,
            lng: (segment[0].lng + segment[1].lng) / 2,
        }
        let cancelled = false
        Promise.resolve(projectLatLng(mid)).then((pt) => {
            if (!cancelled && pt && pt.x != null && pt.y != null) {
                setLabelPixel({ x: pt.x, y: pt.y })
            }
        })
        return () => {
            cancelled = true
        }
    }, [
        segment ? segment[0].lat : null,
        segment ? segment[0].lng : null,
        segment ? segment[1].lat : null,
        segment ? segment[1].lng : null,
        projectLatLng,
    ])

    const current = active || styles[0]
    const hasStyles = styles.length > 0
    const hasZoom = Boolean(onZoomIn || onZoomOut)

    return (
        <>
            <div ref={rootRef} style={S.root(rightOffset)}>
                <div style={S.bar}>
                    {hasStyles && (
                        <>
                            <button
                                type="button"
                                style={S.barBtn(open, bg(current && current.name))}
                                onClick={() => setOpen((v) => !v)}
                                title={current ? `Basemap: ${current.name}` : 'Basemap'}
                            >
                                <BasemapIcon />
                            </button>
                            <span style={S.divider} />
                        </>
                    )}
                    {measureSupported && (
                        <>
                            <button
                                type="button"
                                style={S.barBtn(measuring)}
                                onClick={toggleMeasure}
                                title={
                                    measuring
                                        ? 'Exit measure mode (Esc)'
                                        : 'Measure distance'
                                }
                            >
                                <RulerIcon />
                            </button>
                            {hasZoom && <span style={S.divider} />}
                        </>
                    )}
                    {onZoomOut && (
                        <button
                            type="button"
                            style={S.barBtn(false)}
                            onClick={onZoomOut}
                            title="Zoom out"
                        >
                            <MinusIcon />
                        </button>
                    )}
                    {onZoomIn && onZoomOut && <span style={S.divider} />}
                    {onZoomIn && (
                        <button
                            type="button"
                            style={S.barBtn(false)}
                            onClick={onZoomIn}
                            title="Zoom in"
                        >
                            <PlusIcon />
                        </button>
                    )}
                </div>
                {measuring && points.length === 0 && (
                    <div style={S.readoutHint}>Click points on the map</div>
                )}
                {open && hasStyles && (
                    <div style={S.panel}>
                        <div style={S.panelHeader}>Style</div>
                        {styles.map((entry) => {
                            const isActive =
                                current && entry.name === current.name
                            return (
                                <button
                                    type="button"
                                    key={entry.name}
                                    style={S.row(isActive)}
                                    onClick={() => {
                                        if (onSelectBasemap)
                                            onSelectBasemap(entry)
                                    }}
                                >
                                    <span style={S.rowLabel(isActive)}>
                                        {entry.name}
                                    </span>
                                    <span
                                        style={S.rowThumb(
                                            bg(entry.name),
                                            isActive
                                        )}
                                    />
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>
            {measuring && segment && labelPixel && (
                <div style={S.measureLabel(labelPixel)}>
                    {formatDistance(
                        distance(
                            point([segment[0].lng, segment[0].lat]),
                            point([segment[1].lng, segment[1].lat]),
                            { units: 'meters' }
                        )
                    )}
                </div>
            )}
        </>
    )
}

export default MapControl
