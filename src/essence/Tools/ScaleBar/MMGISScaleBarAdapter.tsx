import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScaleBar } from './lib'
import {
    buildScaleBarModel,
    resolveScaleUnits,
    SCALE_BAR_MAX_WIDTH_PX,
    type ScaleBarModel,
} from '../_shared/scale/scaleBarModel'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import {
    mmgisGetEngineType,
    mmgisGetMetersPerPixel,
    mmgisProvide,
    EXPORT_SCALE_BAR_REQUEST,
    type ScaleBarSettings,
} from '../_shared/adapters/mmgisAPI'

type ToolVars = {
    units?: unknown
}

// The bottom-left corner of the bar's backing box, where an export draws its
// own backing and measures its scale. Undefined while no bar is drawn, or
// under a display:none ancestor (a hidden plugin or collapsed panel).
const backingCorner = (host: HTMLElement | null) => {
    const bar = host?.querySelector<HTMLElement>('.blocks-scale-bar')
    if (!bar || bar.getClientRects().length === 0) return undefined
    const rect = bar.getBoundingClientRect()
    return { clientX: rect.left, clientY: rect.bottom }
}

// The pointer's position in the map container, from a 'map:mousemove' event.
const containerPointOf = (event: unknown): { x: number; y: number } | null => {
    const p = (event as { containerPoint?: { x?: unknown; y?: unknown } } | undefined)
        ?.containerPoint
    return p && Number.isFinite(p.x) && Number.isFinite(p.y)
        ? { x: p.x as number, y: p.y as number }
        : null
}

// Below this change in length, in CSS pixels, a redraw would look the same.
const WIDTH_TOLERANCE_PX = 0.25

// Whether two models draw the same bar, so a frame that changes neither the
// label nor the visible length skips the render.
const drawsSameBar = (a: ScaleBarModel | null, b: ScaleBarModel | null): boolean => {
    if (!a || !b) return a === b
    return a.label === b.label && Math.abs(a.widthPx - b.widthPx) < WIDTH_TOLERANCE_PX
}

export function MMGISScaleBarAdapter() {
    const vars = useMMGISToolVars<ToolVars>('scalebar')
    const units = resolveScaleUnits(vars.units)
    const [model, setModel] = useState<ScaleBarModel | null>(null)
    const hostRef = useRef<HTMLDivElement | null>(null)

    // The bar shows the scale under the pointer, and the scale at the map's
    // centre while the pointer is off the map. Leaflet does not report the
    // pointer leaving the map when it leaves across a feature that listens
    // for hovers, so there the bar always shows the centre's scale.
    const followsPointer = useRef(false)
    const pointer = useRef<{ x: number; y: number } | null>(null)
    // Reads can settle out of order; only the latest one is shown.
    const latestRead = useRef(0)

    const refresh = useCallback(async () => {
        const read = ++latestRead.current
        let next: number | null = null
        try {
            next = await mmgisGetMetersPerPixel(pointer.current ?? undefined)
            // A pointer off the map's ground (past a world's edge) has no
            // scale of its own, so the centre's stands in.
            if (next == null && pointer.current) next = await mmgisGetMetersPerPixel()
        } catch (err) {
            console.warn('ScaleBar: reading the map scale failed', err)
        }
        if (read !== latestRead.current) return
        const nextModel = buildScaleBarModel(next, units, SCALE_BAR_MAX_WIDTH_PX)
        setModel((prev) => (drawsSameBar(prev, nextModel) ? prev : nextModel))
    }, [units])
    // The engine is built by the time the map can measure its scale. This
    // reruns when the units change, which redraws the bar in them.
    const onMapReady = useCallback(async () => {
        try {
            followsPointer.current = (await mmgisGetEngineType()) !== 'leaflet'
        } catch {
            followsPointer.current = false
        }
        await refresh()
    }, [refresh])
    useMMGISHandlerReady('map:getMetersPerPixel', onMapReady)
    // Engines raise 'map:move' at most once per rendered frame, so reading
    // on it directly keeps the bar in step with the map.
    useMMGISEvent('map:move', refresh)
    useMMGISEvent('map:moveend', refresh)

    const onPointerMove = useCallback(
        (event?: unknown) => {
            if (!followsPointer.current) return
            pointer.current = containerPointOf(event)
            void refresh()
        },
        [refresh],
    )
    const onPointerOut = useCallback(() => {
        if (!pointer.current) return
        pointer.current = null
        void refresh()
    }, [refresh])
    useMMGISEvent('map:mousemove', onPointerMove)
    useMMGISEvent('map:mouseout', onPointerOut)

    // A map with no size yet has no scale; the layout dispatches 'resize'
    // whenever the map area changes size, often several times in a row, so
    // the read waits for the next frame.
    const frame = useRef<number | null>(null)
    const refreshNextFrame = useCallback(() => {
        if (frame.current != null) return
        frame.current = requestAnimationFrame(() => {
            frame.current = null
            void refresh()
        })
    }, [refresh])
    useEffect(() => {
        window.addEventListener('resize', refreshNextFrame)
        return () => {
            window.removeEventListener('resize', refreshNextFrame)
            if (frame.current != null) cancelAnimationFrame(frame.current)
        }
    }, [refreshNextFrame])

    useEffect(
        () =>
            mmgisProvide(EXPORT_SCALE_BAR_REQUEST, (): ScaleBarSettings | null => {
                const at = backingCorner(hostRef.current)
                return at ? { units, at } : null
            }),
        [units],
    )

    return (
        <div ref={hostRef} className="blocks-scale-bar-host">
            <ScaleBar model={model} />
        </div>
    )
}
