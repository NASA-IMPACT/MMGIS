import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AddTempLayerPanel } from './lib'
import type { AddTempLayerInput } from './lib'
import { buildLayerObj } from './adapters/buildLayerObj'
import { mmgisOn, mmgisRequest } from '../_shared/adapters/mmgisAPI'

/**
 * Bridges the portable AddTempLayerPanel (the "Add layer from URL" form) to
 * MMGIS. The tool starts hidden in its floating panel; ANY plugin can reveal
 * it by emitting the show event below — the plugin ships no trigger of its
 * own. The ✕ hides it again. Submits become `layers:addLayer` requests
 * (session-only add; lost on reload).
 */

const TOOL_ID = 'AddTempLayerTool'
/** Emit this on the bus (no payload needed) to reveal the form. */
export const ADD_TEMP_LAYER_SHOW_EVENT = 'addTempLayer:show'

// The plugin lifecycle API (modern layout) isn't part of the shared client's
// Window typing; type the two calls we use locally.
type PluginLifecycle = {
    showPlugin?: (id: string) => boolean
    hidePlugin?: (id: string) => boolean
}
const lifecycle = (): PluginLifecycle =>
    (window as { mmgisAPI?: PluginLifecycle }).mmgisAPI ?? {}

export function MMGISAddTempLayerAdapter() {
    // Engine-reported load failure for the most recently added layer. Layers
    // are added optimistically; the engine's request hooks broadcast the real
    // outcome and we surface it in the form. An 'ok' report clears it.
    const [engineError, setEngineError] = useState<string | null>(null)
    const lastAddedRef = useRef<string | null>(null)

    useEffect(
        () =>
            mmgisOn(ADD_TEMP_LAYER_SHOW_EVENT, () => {
                lifecycle().showPlugin?.(TOOL_ID)
            }),
        [],
    )

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
        lifecycle().hidePlugin?.(TOOL_ID)
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
