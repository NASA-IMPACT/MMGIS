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

/**
 * The map's bearing and pitch, kept current while `enabled`: read once the
 * camera handler is up, again on every `map:ready` (a re-initialized map), and
 * at most once per animation frame while `map:move` or `map:moveend` fire.
 * Null until the first read lands, and whenever the map cannot report a
 * bearing.
 */
export function useMapCamera(enabled: boolean): MapCameraState | null {
    const [state, setState] = useState<MapCameraState | null>(null)

    useEffect(() => {
        if (!enabled) return
        let live = true
        let frame: number | null = null

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
        const readNextFrame = () => {
            if (frame != null) return
            frame = requestAnimationFrame(() => {
                frame = null
                void read()
            })
        }

        const stopWaiting = whenMMGISHandlerReady(CAMERA_HANDLER, () => void read())
        const offReady = mmgisOn('map:ready', () => void read())
        const offMoveEnd = mmgisOn('map:moveend', readNextFrame)
        const offMove = mmgisOn('map:move', readNextFrame)
        return () => {
            live = false
            stopWaiting()
            offReady()
            offMoveEnd()
            offMove()
            if (frame != null) cancelAnimationFrame(frame)
        }
    }, [enabled])

    return state
}
