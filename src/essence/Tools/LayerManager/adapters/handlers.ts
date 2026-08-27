import {
    mmgisRequest,
    mmgisEmit,
    mmgisGetLayerCogCapabilities,
    mmgisGetLayerBounds,
    mmgisFitBounds,
} from '../../_shared/adapters/mmgisAPI'
import {
    ZOOM_TO_LAYER_PADDING,
    ZOOM_TO_LAYER_POINT_MAX_ZOOM,
} from '../lib/utils/constants'

type Refresh = () => Promise<void> | void

/**
 * Whether core accepts a colormap or rescale change for this layer, by its
 * config shape and tile source. The same verdict makes the controls editable
 * in the legend, so a write is only sent for a layer core can recompile.
 */
const canChangeColormap = async (layerId: string): Promise<boolean> => {
    const capabilities = await mmgisGetLayerCogCapabilities(layerId)
    return capabilities?.canChangeColormap === true
}

/** [[south, west], [north, east]], the shape mmgisFitBounds takes. */
type NormalizedBounds = [[number, number], [number, number]]

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)

/**
 * The viewport as [[south, west], [north, east]].
 *
 * `map:getBounds` hands back whatever the active engine's adapter returns, and
 * the two disagree: Leaflet gives plain `{southWest, northEast}` corners while
 * deck.gl gives Leaflet-style `getSouthWest()` / `getNorthEast()` accessors. A
 * corner tuple is accepted too. Null when the shape is none of those, which
 * leaves callers treating the viewport as unknown rather than guessing.
 */
export const normalizeMapBounds = (raw: unknown): NormalizedBounds | null => {
    if (raw == null || typeof raw !== 'object') return null

    const source = raw as Record<string, unknown>

    // Corner tuple: [[lat, lng], [lat, lng]].
    if (Array.isArray(raw)) {
        const [sw, ne] = raw as [unknown, unknown]
        if (Array.isArray(sw) && Array.isArray(ne)) {
            const [s, w] = sw as number[]
            const [n, e] = ne as number[]
            if ([s, w, n, e].every(isFiniteNumber)) {
                return [
                    [s, w],
                    [n, e],
                ]
            }
        }
        return null
    }

    const readCorner = (
        plain: unknown,
        accessor: unknown,
    ): { lat: number; lng: number } | null => {
        const corner =
            typeof accessor === 'function'
                ? (accessor as () => unknown).call(raw)
                : plain
        if (corner == null || typeof corner !== 'object') return null
        const { lat, lng } = corner as Record<string, unknown>
        return isFiniteNumber(lat) && isFiniteNumber(lng) ? { lat, lng } : null
    }

    const southWest = readCorner(source.southWest, source.getSouthWest)
    const northEast = readCorner(source.northEast, source.getNorthEast)
    if (southWest == null || northEast == null) return null

    return [
        [southWest.lat, southWest.lng],
        [northEast.lat, northEast.lng],
    ]
}

/** Whether two extents overlap at all. Touching edges count as overlapping. */
export const boundsIntersect = (
    a: NormalizedBounds,
    b: NormalizedBounds,
): boolean => {
    const [[aSouth, aWest], [aNorth, aEast]] = a
    const [[bSouth, bWest], [bNorth, bEast]] = b
    return (
        aSouth <= bNorth && aNorth >= bSouth && aWest <= bEast && aEast >= bWest
    )
}

/**
 * Brings a layer into view when switching it on would otherwise change nothing
 * on screen.
 *
 * Only moves when the layer's extent lies entirely outside the viewport: a
 * layer that already overlaps what you are looking at is left alone, so
 * stacking layers over one area never yanks the camera. Silent no-op when
 * either extent is unavailable — an unknown viewport is not grounds for moving
 * the map.
 */
const revealLayerIfOffscreen = async (layerId: string): Promise<boolean> => {
    const layerBounds = await mmgisGetLayerBounds(layerId)
    if (layerBounds === null) return false

    const viewport = normalizeMapBounds(await mmgisRequest('map:getBounds'))
    if (viewport === null) return false
    if (boundsIntersect(layerBounds, viewport)) return false

    const [[south, west], [north, east]] = layerBounds
    const enclosesNoArea = south === north && west === east
    return mmgisFitBounds(layerBounds, {
        padding: ZOOM_TO_LAYER_PADDING,
        ...(enclosesNoArea ? { maxZoom: ZOOM_TO_LAYER_POINT_MAX_ZOOM } : {}),
    })
}

export const toggleVisibility = async (layerId: string): Promise<void> => {
    const newVisibility = await mmgisRequest<boolean>('layers:toggle', layerId)
    if (newVisibility !== null) {
        mmgisEmit('layer:visibilityChange', { layerName: layerId, visible: newVisibility })
        // Switching a layer on is a request to see it. Without this, a layer
        // whose data sits off-screen draws correctly and looks broken.
        if (newVisibility === true) await revealLayerIfOffscreen(layerId)
    }
}

export const setOpacity = async (layerId: string, opacity: number): Promise<void> => {
    const success = await mmgisRequest<boolean>('layers:setOpacity', { layerUUID: layerId, opacity })
    if (success) {
        mmgisEmit('layer:opacityChange', { layerName: layerId, opacity })
    }
}

/**
 * Moves the map to a layer's extent.
 *
 * Does nothing for a layer with no extent to move to. The menu offering this
 * asks core for the same bounds when it opens and disables the item in that
 * case, so the check here is what keeps a stale menu from moving the map
 * somewhere arbitrary.
 *
 * The fit is capped only for an extent enclosing no area. Anything with area
 * fits as far in as it goes, so a layer covering a few hundred metres is not
 * held back to the zoom a point layer needs.
 */
export const zoomToLayer = async (layerId: string): Promise<void> => {
    const bounds = await mmgisGetLayerBounds(layerId)
    if (bounds === null) {
        // Reachable only when the layer lost its extent between the menu
        // resolving it and the click. The panel has no channel for saying so,
        // which leaves the log as the sole trace of a click that led nowhere.
        console.warn(`LayerManager: '${layerId}' has no extent to zoom to`)
        return
    }
    const [[south, west], [north, east]] = bounds
    const enclosesNoArea = south === north && west === east
    await mmgisFitBounds(bounds, {
        padding: ZOOM_TO_LAYER_PADDING,
        ...(enclosesNoArea ? { maxZoom: ZOOM_TO_LAYER_POINT_MAX_ZOOM } : {}),
    })
}

export const setColormap = async (layerId: string, colormap: string, refresh: Refresh): Promise<void> => {
    if (!(await canChangeColormap(layerId))) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogColormap: colormap } })
    // applyCogFieldsToUrl prefers `currentCogColormap` over the mission-configured
    // `cogColormap`, so the override key has to match the config write above.
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogColormap: colormap } })
    mmgisEmit('layer:cogColormapChange', { layerName: layerId, colormap })
    await refresh()
}

export const setRescale = async (
    layerId: string,
    min: number,
    max: number,
    refresh: Refresh,
): Promise<void> => {
    if (!(await canChangeColormap(layerId))) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogMin: min, currentCogMax: max } })
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogMin: min, currentCogMax: max } })
    mmgisEmit('layer:cogRescaleChange', { layerName: layerId, min, max })
    await refresh()
}

