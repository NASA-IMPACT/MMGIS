// Follows the map camera for the compass. MMGIS-coupled — stays in MMGIS.
import { useEffect, useState } from 'react'
import type { MapCamera } from '../lib'
import { mmgisGetViewState, mmgisOn } from '../../_shared/adapters/mmgisAPI'
import { whenMMGISHandlerReady } from '../../_shared/adapters/whenMMGISHandlerReady'

/**
 * Core registers `map:resetNorth` alongside the other map handlers once the
 * engine exists, so its arrival marks the point a camera read has an answer.
 */
const MAP_READY_HANDLER = 'map:resetNorth'

/**
 * The map's bearing and pitch, kept current while `enabled`: read once the
 * map is up, on every `map:moveend`, and at most once per animation frame
 * while `map:move` fires through a gesture. Null until the first read lands,
 * and whenever the map cannot report a bearing.
 */
export function useMapCamera(enabled: boolean): MapCamera | null {
    const [camera, setCamera] = useState<MapCamera | null>(null)

    useEffect(() => {
        if (!enabled) return
        let live = true
        let frame: number | null = null

        const read = async () => {
            try {
                const view = await mmgisGetViewState()
                if (!live) return
                setCamera(
                    view && typeof view.bearing === 'number'
                        ? { bearing: view.bearing, pitch: view.pitch ?? 0 }
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

        const stopWaiting = whenMMGISHandlerReady(MAP_READY_HANDLER, () => void read())
        const offMoveEnd = mmgisOn('map:moveend', () => void read())
        const offMove = mmgisOn('map:move', readNextFrame)
        return () => {
            live = false
            stopWaiting()
            offMoveEnd()
            offMove()
            if (frame != null) cancelAnimationFrame(frame)
        }
    }, [enabled])

    return camera
}
