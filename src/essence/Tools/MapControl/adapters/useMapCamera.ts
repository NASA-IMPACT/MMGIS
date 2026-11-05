// Follows the map camera for the compass. MMGIS-coupled — stays in MMGIS.
import { useEffect, useState } from 'react'
import type { MapCamera } from '../lib'
import { mmgisGetCamera, mmgisOn } from '../../_shared/adapters/mmgisAPI'
import { whenMMGISHandlerReady } from '../../_shared/adapters/whenMMGISHandlerReady'

/** Registered with the engine, so its arrival marks when a read can answer. */
const CAMERA_HANDLER = 'map:getCamera'

export type MapCameraState = {
    camera: MapCamera
    /** False on an engine that cannot rotate or tilt, where reset does nothing. */
    rotatable: boolean
}

// The bearing and pitch a `map:move` or `map:moveend` payload carries, when
// it is an engine view state (deck.gl). Leaflet's payload is its own event,
// which carries neither, so the camera is asked for instead.
const cameraIn = (payload: unknown): MapCamera | null => {
    const p = payload as { bearing?: unknown; pitch?: unknown } | undefined
    return typeof p?.bearing === 'number' && typeof p?.pitch === 'number'
        ? { bearing: p.bearing, pitch: p.pitch }
        : null
}

/**
 * The map's bearing and pitch, kept current while `enabled`: read once the
 * camera handler is up, then followed through `map:move` and `map:moveend`,
 * at most once per animation frame. A payload that carries the camera is
 * used as is; one that does not (Leaflet) costs a `map:getCamera` request.
 * Null until the first read lands, and whenever the map cannot report a
 * bearing.
 */
export function useMapCamera(enabled: boolean): MapCameraState | null {
    const [state, setState] = useState<MapCameraState | null>(null)

    useEffect(() => {
        if (!enabled) return
        let live = true
        let frame: number | null = null
        // The latest camera a move reported, applied on the next frame.
        let pending: MapCamera | null = null

        const read = async () => {
            try {
                const cam = await mmgisGetCamera()
                if (!live) return
                setState(
                    cam
                        ? {
                              camera: { bearing: cam.bearing, pitch: cam.pitch },
                              rotatable: cam.rotatable,
                          }
                        : null,
                )
            } catch (err) {
                console.warn('MapControl: reading the map camera failed', err)
            }
        }
        const onMove = (payload?: unknown) => {
            pending = cameraIn(payload)
            if (frame != null) return
            frame = requestAnimationFrame(() => {
                frame = null
                const camera = pending
                pending = null
                if (!camera) {
                    void read()
                    return
                }
                // `rotatable` never changes for an engine, so a move only
                // updates the camera; before the first read there is nothing
                // to update and the read's answer arrives on its own.
                setState((prev) => (prev ? { ...prev, camera } : prev))
            })
        }

        const stopWaiting = whenMMGISHandlerReady(CAMERA_HANDLER, () => void read())
        const offMoveEnd = mmgisOn('map:moveend', onMove)
        const offMove = mmgisOn('map:move', onMove)
        return () => {
            live = false
            stopWaiting()
            offMoveEnd()
            offMove()
            if (frame != null) cancelAnimationFrame(frame)
        }
    }, [enabled])

    return state
}
