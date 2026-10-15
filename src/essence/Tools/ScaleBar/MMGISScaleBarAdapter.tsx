import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScaleBar } from './lib'
import {
    buildScaleBarModel,
    resolveScaleUnits,
    SCALE_BAR_MAX_WIDTH_PX,
    type ScaleUnits,
} from '../_shared/scale/scaleBarModel'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import {
    mmgisGetMetersPerPixel,
    mmgisProvide,
    SCALE_BAR_SETTINGS_REQUEST,
    type ScaleBarSettings,
} from '../_shared/adapters/mmgisAPI'

type ToolVars = {
    units?: unknown
}

// False under a display:none ancestor (a hidden plugin or collapsed panel).
const isOnScreen = (el: HTMLElement | null): boolean =>
    !!el && el.getClientRects().length > 0

// The bar's rule starts at the host's bottom-left corner, where an export
// draws and measures its own bar.
const ruleStart = (el: HTMLElement | null) => {
    if (!isOnScreen(el)) return undefined
    const rect = el!.getBoundingClientRect()
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

// Whether two scales draw the same bar, so a frame that changes neither the
// label nor the visible length skips the render.
const drawsSameBar = (
    a: number | null,
    b: number | null,
    units: ScaleUnits,
): boolean => {
    const ma = buildScaleBarModel(a, units, SCALE_BAR_MAX_WIDTH_PX)
    const mb = buildScaleBarModel(b, units, SCALE_BAR_MAX_WIDTH_PX)
    if (!ma || !mb) return ma === mb
    return ma.label === mb.label && Math.abs(ma.widthPx - mb.widthPx) < WIDTH_TOLERANCE_PX
}

export function MMGISScaleBarAdapter() {
    const vars = useMMGISToolVars<ToolVars>('scalebar')
    const units = resolveScaleUnits(vars.units)
    const [metersPerPixel, setMetersPerPixel] = useState<number | null>(null)
    const hostRef = useRef<HTMLDivElement | null>(null)

    // The bar shows the scale under the pointer, and the scale at the map's
    // centre while the pointer is off the map.
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
        setMetersPerPixel((prev) => (drawsSameBar(prev, next, units) ? prev : next))
    }, [units])
    useMMGISHandlerReady('map:getMetersPerPixel', refresh)
    // Engines raise 'map:move' at most once per rendered frame, so reading
    // on it directly keeps the bar in step with the map.
    useMMGISEvent('map:move', refresh)
    useMMGISEvent('map:moveend', refresh)

    const onPointerMove = useCallback(
        (event?: unknown) => {
            pointer.current = containerPointOf(event)
            void refresh()
        },
        [refresh],
    )
    const onPointerOut = useCallback(() => {
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
            mmgisProvide(SCALE_BAR_SETTINGS_REQUEST, (): ScaleBarSettings | null => {
                const at = ruleStart(hostRef.current)
                return at ? { units, at } : null
            }),
        [units],
    )

    const model = buildScaleBarModel(metersPerPixel, units, SCALE_BAR_MAX_WIDTH_PX)
    return (
        <div ref={hostRef} className="blocks-scale-bar-host">
            <ScaleBar model={model} />
        </div>
    )
}
