import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AddTempLayerPanel } from './lib'
import type { AddTempLayerInput } from './lib'
import { buildLayerObj } from './adapters/buildLayerObj'
import {
    mmgisOn,
    mmgisRequest,
    mmgisShowPlugin,
    mmgisHidePlugin,
} from '../_shared/adapters/mmgisAPI'

/**
 * Bridges the portable AddTempLayerPanel (the "Add layer from URL" form) to
 * MMGIS. The tool starts hidden in its floating panel; ANY plugin can reveal
 * it by emitting the show event below — the plugin ships no trigger of its
 * own. The ✕ hides it again. Submits become `layers:addLayer` requests
 * (session-only add; lost on reload).
 */

/** This plugin's canonical id, as declared in its config.json. */
const TOOL_ID = 'addtemplayer'
/** Emit this on the bus (no payload needed) to reveal the form. */
export const ADD_TEMP_LAYER_SHOW_EVENT = 'addTempLayer:show'

/**
 * Reveal or dismiss this tool through the plugin lifecycle bus, reporting a
 * refusal rather than dropping it. Nothing else can reveal the form, so a
 * silent failure here leaves it unreachable.
 */
const setVisible = (visible: boolean) => {
    const command = visible ? mmgisShowPlugin : mmgisHidePlugin
    const verb = visible ? 'show' : 'hide'
    // The result is read through a widened shape rather than CommandResult's
    // own union: this project compiles without strictNullChecks, where a
    // boolean discriminant does not narrow.
    command(TOOL_ID)
        .then((result: { ok: boolean; reason?: string }) => {
            if (!result.ok) {
                console.warn(`[AddTempLayer] ${verb} refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn(`[AddTempLayer] ${verb} failed:`, err))
}

export function MMGISAddTempLayerAdapter() {
    // Engine-reported load failure for the most recently added layer. Layers
    // are added optimistically; the engine's request hooks broadcast the real
    // outcome and we surface it in the form. An 'ok' report clears it.
    const [engineError, setEngineError] = useState<string | null>(null)
    const lastAddedRef = useRef<string | null>(null)

    useEffect(
        () =>
            mmgisOn(ADD_TEMP_LAYER_SHOW_EVENT, () => {
                setVisible(true)
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
        setVisible(false)
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
