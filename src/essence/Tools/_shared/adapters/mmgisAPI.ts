type EventCleanup = () => void

type MMGISAPI = {
    request: (name: string, params?: unknown) => Promise<unknown>
    on: (event: string, handler: (payload?: unknown) => void) => EventCleanup
    emit: (event: string, payload?: unknown) => void
    provide?: (name: string, handler: (...args: unknown[]) => unknown) => EventCleanup
    hasHandler?: (name: string) => boolean
}

export type MapScreenshotResult = {
    blob: Blob
    mimeType: 'image/png'
    extension: 'png'
    width: number
    height: number
}

/** The subset of a mission layer config that plugins read off the bus. */
export type LayerConfig = {
    name?: string
    display_name?: string
    time?: {
        enabled?: boolean
        /**
         * 'global' and 'requery' track the global cursor; 'local' carries its
         * own window in `start`/`end`.
         */
        type?: string
        start?: string | null
        end?: string | null
        /** As authored: a concrete ISO datetime or a policy string ("now",
         *  "now - P1D"). Ask mmgisGetTemporalExtents for the dates. */
        dataStartTime?: string
        dataEndTime?: string
        [key: string]: unknown
    }
    url?: string
    [key: string]: unknown
}

export type ViewState = {
    missionName: string | null
    time: string | null
    center: { lat: number; lng: number } | null
    zoom: number | null
}

declare global {
    interface Window {
        mmgisAPI?: MMGISAPI
    }
}

export const mmgisRequest = async <T = unknown>(name: string, params?: unknown): Promise<T | null> => {
    if (window.mmgisAPI?.request) {
        return (await window.mmgisAPI.request(name, params)) as T
    }
    return null
}

export const mmgisOn = (event: string, handler: (payload?: unknown) => void): EventCleanup => {
    if (!window.mmgisAPI?.on) return () => {}
    return window.mmgisAPI.on(event, handler)
}

export const mmgisEmit = (event: string, payload?: unknown): void => {
    window.mmgisAPI?.emit?.(event, payload)
}

export const mmgisProvide = (name: string, handler: (...args: unknown[]) => unknown): EventCleanup => {
    if (!window.mmgisAPI?.provide) return () => {}
    return window.mmgisAPI.provide(name, handler)
}

export const mmgisHasHandler = (name: string): boolean => {
    return window.mmgisAPI?.hasHandler?.(name) === true
}

// Typed wrappers for the core capabilities this plugin consumes, so plugins
// reach core only through this shared client — and only via the
// request/provide bus (string-named messages survive a sandbox boundary;
// direct method calls don't). The bus name strings live here and nowhere
// else. Each wrapper resolves null when core is absent or too old to
// register the handler; errors thrown by a registered handler still
// propagate (they are real failures, not version skew).

const mmgisRequestIfProvided = async <T = unknown>(
    name: string,
    params?: unknown,
): Promise<T | null> => {
    if (!mmgisHasHandler(name)) return null
    return mmgisRequest<T>(name, params)
}

/** The current view as a complete, self-contained share URL. */
export const mmgisWriteCoordinateURL = (): Promise<string | null> => {
    return mmgisRequestIfProvided<string>('map:writeCoordinateURL')
}

/** The current map as a PNG Blob plus image metadata. */
export const mmgisGetMapScreenshot = (): Promise<
    MapScreenshotResult | null
> => {
    return mmgisRequestIfProvided<MapScreenshotResult>('map:getScreenshot')
}

/** View metadata (mission, time, center, zoom); fields null until loaded. */
export const mmgisGetViewState = (): Promise<ViewState | null> => {
    return mmgisRequestIfProvided<ViewState>('map:getViewState')
}

/**
 * Every layer's config, keyed by layer UUID. Core registers this handler in
 * Layers_.fina(), after the mission's layers load and after tools mount, so
 * drive the call with useMMGISHandlerReady rather than requesting at mount.
 */
export const mmgisGetLayerConfigs = (): Promise<Record<
    string,
    LayerConfig
> | null> => {
    return mmgisRequestIfProvided<Record<string, LayerConfig>>(
        'layers:getAllConfigs',
    )
}

/** Per-layer visibility, keyed by layer UUID. Registered as late as
 *  mmgisGetLayerConfigs; the same readiness caveat applies. */
export const mmgisGetVisibleLayers = (): Promise<Record<
    string,
    boolean
> | null> => {
    return mmgisRequestIfProvided<Record<string, boolean>>('layers:getVisible')
}

/** Runtime "shown in layer lists" flags, keyed by layer UUID; absent =
 *  listed, false = hidden (e.g. filtered out by the LayerFilter plugin). */
export const mmgisGetListedLayers = (): Promise<Record<
    string,
    boolean
> | null> => {
    return mmgisRequestIfProvided<Record<string, boolean>>('layers:getListed')
}

/**
 * What a layer's COG colormap supports: `hasColormap` for whether there is a
 * ramp to draw a legend from, `canChangeColormap` for whether that ramp can be
 * changed (via `layers:updateConfig` + `layers:refresh`). An `image` layer
 * has the first without the second.
 */
export type CogCapabilities = {
    hasColormap: boolean
    canChangeColormap: boolean
}

/**
 * COG capabilities for every layer, keyed by layer UUID.
 *
 * Registered as late as mmgisGetLayerConfigs; the same readiness caveat
 * applies. Null against a core that does not register the handler, in which
 * case callers leave the colormap controls out.
 */
export const mmgisGetCogCapabilities = (): Promise<Record<
    string,
    CogCapabilities
> | null> => {
    return mmgisRequestIfProvided<Record<string, CogCapabilities>>(
        'layers:getCogCapabilities',
    )
}

/**
 * COG capabilities for one layer. Core resolves a display name to its UUID,
 * so callers holding either identifier get the same answer — unlike indexing
 * the bulk map, which is UUID-keyed.
 *
 * Null when the layer is unknown, or against a core without the handler.
 */
export const mmgisGetLayerCogCapabilities = (
    layerUUID: string,
): Promise<CogCapabilities | null> => {
    return mmgisRequestIfProvided<CogCapabilities>(
        'layers:getCogCapabilities',
        layerUUID,
    )
}

/** When a layer has data, as ISO datetimes; null where unset or unreadable. */
export type TemporalExtent = {
    start: string | null
    end: string | null
}

/**
 * Temporal extent for every layer, keyed by layer UUID, resolved by core at
 * the moment of asking. Null against a core without the handler.
 */
export const mmgisGetTemporalExtents = (): Promise<Record<
    string,
    TemporalExtent
> | null> => {
    return mmgisRequestIfProvided<Record<string, TemporalExtent>>(
        'layers:getTemporalExtent',
    )
}

/** Temporal extent for one layer, by UUID or display name. */
export const mmgisGetLayerTemporalExtent = (
    layerUUID: string,
): Promise<TemporalExtent | null> => {
    return mmgisRequestIfProvided<TemporalExtent>(
        'layers:getTemporalExtent',
        layerUUID,
    )
}

/** A geographic extent as `[[south, west], [north, east]]`. */
export type LayerBounds = [[number, number], [number, number]]

/**
 * Where a layer sits on the map.
 *
 * Null when the layer has no extent core can work out — a vector layer whose
 * features have not loaded, a raster layer with no configured footprint — and
 * null against a core that does not register the handler, in which case callers
 * leave the controls that depend on an extent inert.
 *
 * Registered as late as mmgisGetLayerConfigs; the same readiness caveat applies.
 */
export const mmgisGetLayerBounds = (
    layerUUID: string,
): Promise<LayerBounds | null> => {
    return mmgisRequestIfProvided<LayerBounds>('layers:getBounds', layerUUID)
}

/**
 * Moves the map so the given extent fills the view. True when core accepted it;
 * false against a core without the handler.
 *
 * `padding` is in screen pixels. `maxZoom` caps how far in the fit may go,
 * which matters for a zero-area extent — a single point otherwise resolves to
 * maximum zoom.
 */
export const mmgisFitBounds = async (
    bounds: LayerBounds,
    options?: { padding?: number; maxZoom?: number },
): Promise<boolean> => {
    const fitted = await mmgisRequestIfProvided<boolean>('map:fitBounds', {
        bounds,
        options,
    })
    return fitted === true
}

/**
 * Where each layer's tiling service lives, keyed by layer UUID, already
 * resolved through the per-layer and mission-wide overrides core applies. An
 * entry is null when no service is reachable for that layer.
 *
 * Registered as late as mmgisGetLayerConfigs; the same readiness caveat
 * applies. Null against a core without the handler, in which case callers
 * have no service to reach.
 */
export const mmgisGetTiTilerUrls = (): Promise<Record<
    string,
    string | null
> | null> => {
    return mmgisRequestIfProvided<Record<string, string | null>>(
        'layers:getTiTilerUrl',
    )
}

/** Whether the mission has time enabled at all. */
export const mmgisIsTimeEnabled = (): Promise<boolean | null> => {
    return mmgisRequestIfProvided<boolean>('time:isEnabled')
}

/**
 * The current time already rendered through the mission's configured time
 * format (`L_.configData.time.format`), so a header displaying it matches
 * what TimeControl's own UI shows rather than a raw ISO string. Null when
 * time is disabled, not yet seeded, or against a core that predates the
 * handler — callers fall back to their own raw time string in that case.
 */
export const mmgisGetCurrentTimeFormatted = (): Promise<string | null> => {
    return mmgisRequestIfProvided<string>('time:getCurrentFormatted')
}

/**
 * A caller-supplied time rendered through that same mission format, for
 * displaying a time the caller holds itself rather than the cursor's. Null
 * for a missing or unparseable time, and against a core that predates the
 * handler — callers show no time at all rather than one formatted their own
 * way, which would disagree with the mission's.
 */
export const mmgisFormatTime = (
    time: string | number | null | undefined,
): Promise<string | null> => {
    return mmgisRequestIfProvided<string>('time:formatTime', time)
}

/** The global time cursor's window start; null until time is seeded. */
export const mmgisGetTimeStart = (): Promise<string | null> => {
    return mmgisRequestIfProvided<string>('time:getStart')
}

/** The global time cursor's window end; null until time is seeded. */
export const mmgisGetTimeEnd = (): Promise<string | null> => {
    return mmgisRequestIfProvided<string>('time:getEnd')
}

/**
 * Copies text to the clipboard via core's app:copyText handler; true on
 * success. Against cores that predate the handler — including ones whose
 * direct copyText method carried a legacy execCommand path this plugin no
 * longer calls — falls back to the modern browser API only, so copy
 * silently degrades to false on old-core insecure origins.
 */
export const mmgisCopyText = async (text: string): Promise<boolean> => {
    const copied = await mmgisRequestIfProvided<boolean>('app:copyText', text)
    if (copied !== null) return copied === true
    if (!navigator.clipboard?.writeText) return false
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
