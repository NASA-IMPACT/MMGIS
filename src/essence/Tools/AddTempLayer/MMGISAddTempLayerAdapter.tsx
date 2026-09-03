import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AddTempLayerPanel } from './lib'
import type { AddTempLayerInput } from './lib'
import { buildLayerObj } from './adapters/buildLayerObj'
import {
    mmgisOn,
    mmgisRequest,
    mmgisHidePlugin,
} from '../_shared/adapters/mmgisAPI'

/**
 * Bridges the portable AddTempLayerPanel (the "Add layer from URL" form) to
 * MMGIS. The tool starts hidden in its floating panel; the ✕ hides it again.
 * Submits become `layers:addLayer` requests (session-only add; lost on reload).
 */

const TOOL_ID = 'AddTempLayerTool'

/**
 * Dismisses this tool, reporting a refusal rather than dropping it: a silent
 * failure leaves a form the user has closed still sitting over the map.
 */
const hideSelf = () => {
    // The result is read through a widened shape rather than CommandResult's
    // own union: this project compiles without strictNullChecks, where a
    // boolean discriminant does not narrow.
    mmgisHidePlugin(TOOL_ID)
        .then((result: { ok: boolean; reason?: string }) => {
            if (!result.ok) {
                console.warn(`[AddTempLayer] hide refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn('[AddTempLayer] hide failed:', err))
}

export function MMGISAddTempLayerAdapter() {
    // Engine-reported load failure for the most recently added layer. Layers
    // are added optimistically; the engine's request hooks broadcast the real
    // outcome and we surface it in the form. An 'ok' report clears it.
    const [engineError, setEngineError] = useState<string | null>(null)
    const lastAddedRef = useRef<string | null>(null)

    useEffect(
        () =>
            mmgisOn('layers:loadStatusChanged', (payload) => {
                const p = payload as {
                    layerName?: string
                    status?: string
                    message?: string | null
                }
                if (!p?.layerName || p.layerName !== lastAddedRef.current) return
                setEngineError(
                    p.status === 'error'
                        ? p.message ||
                              'The map engine reported an error loading this layer.'
                        : null,
                )
            }),
        [],
    )

    const onClose = useCallback(() => {
        hideSelf()
    }, [])

    const onAddLayer = useCallback((input: AddTempLayerInput) => {
        const layerObj = buildLayerObj(input)
        if (!layerObj) {
            return Promise.reject(new Error('Invalid or unrecognized layer URL'))
        }
        lastAddedRef.current = layerObj.name
        setEngineError(null)
        return mmgisRequest('layers:addLayer', layerObj)
    }, [])

    return (
        <AddTempLayerPanel
            onAddLayer={onAddLayer}
            onClose={onClose}
            engineError={engineError}
        />
    )
}
