import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ScaleBar } from './lib'
import {
    buildScaleBarModel,
    resolveScaleUnits,
    SCALE_BAR_MAX_WIDTH_PX,
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

// The bar's rule starts at the host's bottom-left corner. Map scale varies
// across the screen, so it is measured there rather than at the centre.
const ruleStart = (el: HTMLElement | null) => {
    if (!isOnScreen(el)) return undefined
    const rect = el!.getBoundingClientRect()
    return { clientX: rect.left, clientY: rect.bottom }
}

export function MMGISScaleBarAdapter() {
    const vars = useMMGISToolVars<ToolVars>('scalebar')
    const units = resolveScaleUnits(vars.units)
    const [metersPerPixel, setMetersPerPixel] = useState<number | null>(null)
    const hostRef = useRef<HTMLDivElement | null>(null)

    const refresh = useCallback(async () => {
        try {
            setMetersPerPixel(await mmgisGetMetersPerPixel(ruleStart(hostRef.current)))
        } catch (err) {
            console.warn('ScaleBar: reading the map scale failed', err)
            setMetersPerPixel(null)
        }
    }, [])
    useMMGISHandlerReady('map:getMetersPerPixel', refresh)
    useMMGISEvent('map:moveend', refresh)

    // 'map:move' fires every frame of a gesture; read at most once per frame.
    const frame = useRef<number | null>(null)
    const refreshNextFrame = useCallback(() => {
        if (frame.current != null) return
        frame.current = requestAnimationFrame(() => {
            frame.current = null
            void refresh()
        })
    }, [refresh])
    useMMGISEvent('map:move', refreshNextFrame)

    // A map with no size yet has no scale; the layout dispatches 'resize'
    // whenever the map area changes size.
    useEffect(() => {
        window.addEventListener('resize', refreshNextFrame)
        return () => {
            window.removeEventListener('resize', refreshNextFrame)
            if (frame.current != null) cancelAnimationFrame(frame.current)
        }
    }, [refreshNextFrame])

    useEffect(
        () =>
            mmgisProvide(SCALE_BAR_SETTINGS_REQUEST, (): ScaleBarSettings | null =>
                isOnScreen(hostRef.current) ? { units } : null,
            ),
        [units],
    )

    const model = buildScaleBarModel(metersPerPixel, units, SCALE_BAR_MAX_WIDTH_PX)
    return (
        <div ref={hostRef} className="blocks-scale-bar-host">
            <ScaleBar model={model} />
        </div>
    )
}
