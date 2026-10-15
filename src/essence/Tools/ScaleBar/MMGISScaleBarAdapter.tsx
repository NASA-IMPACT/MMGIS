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

const SCALE_RETRY_MS = 250
const SCALE_RETRY_LIMIT = 80

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

    // An engine that loads its basemap asynchronously answers null at first,
    // and nothing moves to prompt another read, so a null answer is retried.
    const retryTimer = useRef<number | null>(null)
    const retries = useRef(0)
    const unmounted = useRef(false)
    const refresh = useCallback(async () => {
        let next: number | null = null
        try {
            next = await mmgisGetMetersPerPixel(ruleStart(hostRef.current))
        } catch (err) {
            console.warn('ScaleBar: reading the map scale failed', err)
        }
        if (unmounted.current) return
        setMetersPerPixel(next)
        if (next == null && retryTimer.current == null && retries.current++ < SCALE_RETRY_LIMIT) {
            retryTimer.current = window.setTimeout(() => {
                retryTimer.current = null
                void refresh()
            }, SCALE_RETRY_MS)
        }
    }, [])
    useEffect(
        () => () => {
            unmounted.current = true
            if (retryTimer.current != null) window.clearTimeout(retryTimer.current)
        },
        [],
    )
    useMMGISHandlerReady('map:getMetersPerPixel', refresh)

    useMMGISEvent('map:move', refresh)
    useMMGISEvent('map:moveend', refresh)

    // Exports draw a bar exactly when the map shows one, in the same units.
    const unitsRef = useRef<ScaleUnits>(units)
    unitsRef.current = units
    useEffect(
        () =>
            mmgisProvide(SCALE_BAR_SETTINGS_REQUEST, (): ScaleBarSettings | null =>
                isOnScreen(hostRef.current) ? { units: unitsRef.current } : null,
            ),
        [],
    )

    const model = buildScaleBarModel(metersPerPixel, units, SCALE_BAR_MAX_WIDTH_PX)
    return (
        <div ref={hostRef} className="blocks-scale-bar-host">
            <ScaleBar model={model} />
        </div>
    )
}
