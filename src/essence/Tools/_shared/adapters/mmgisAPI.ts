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
        dataStartTime?: string
        dataEndTime?: string
        [key: string]: unknown
    }
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

/**
 * Whether this core build registers a handler under `name` — not whether it
 * currently has anything to serve. The panel and plugin providers register at
 * module scope, so their names read true with no layout mounted; a command's
 * own `layout-inactive` refusal is what reports that.
 */
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

/**
 * One layer's config by UUID (core also resolves display names). Registered
 * as late as mmgisGetLayerConfigs — null during mission boot/reload or
 * against a core without the handler; callers treat that as "layer unknown
 * yet" rather than an error.
 */
export const mmgisGetLayerConfig = (
    layerUUID: string,
): Promise<LayerConfig | null> => {
    return mmgisRequestIfProvided<LayerConfig>('layers:getConfig', layerUUID)
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

export type PanelState = 'collapsed' | 'expanded' | 'iconified' | 'focused'
export type PluginState = 'unloaded' | 'hidden' | 'visible'

/**
 * Every panel and plugin bus name this client speaks, and the only place they
 * are written. `tests/unit/providers/busReconciliation.spec.js` checks each
 * against the handlers core registers.
 */
export const PANEL_PLUGIN_BUS = {
    getPanels: 'panels:getAll',
    setPanelState: 'panels:setState',
    showPanel: 'panels:show',
    hidePanel: 'panels:hide',
    getPlugins: 'plugins:getAll',
    setPluginState: 'plugins:setState',
    showPlugin: 'plugins:show',
    hidePlugin: 'plugins:hide',
} as const

/**
 * Events core broadcasts when the layout moves. Each payload carries the same
 * listing its `getAll` request returns, so a subscriber has nothing to
 * re-request.
 */
export const PANEL_PLUGIN_EVENTS = {
    panelsChanged: 'panels:changed',
    pluginsChanged: 'plugins:changed',
} as const

/** One panel in the layout, as much of it as a plugin needs to target it. */
export type PanelInfo = {
    id: string
    position: string
    state: PanelState
    /** Tool ids the panel holds — how a plugin finds the panel it lives in. */
    toolIds: string[]
}

export type PluginInfo = {
    id: string
    state: PluginState
}

/**
 * Why a command was refused. `PanelManager_/types/layout.ts` carries core's
 * copy of this list and defines each reason.
 *
 * `layout-inactive` covers two causes a caller cannot tell apart: a core with
 * no layout currently mounted, reported by the providers, and a core too old
 * to register the handler, synthesized below by `command`.
 */
export const COMMAND_REFUSAL_REASONS = [
    'bad-request',
    'not-found',
    'state-not-allowed',
    'no-visible-state',
    'layout-inactive',
    'load-failed',
    'transition-failed',
] as const
export type CommandRefusalReason = (typeof COMMAND_REFUSAL_REASONS)[number]

export type CommandResult =
    | { ok: true; state: PanelState | PluginState; changed: boolean }
    | { ok: false; reason: CommandRefusalReason }

const UNREACHABLE: CommandResult = { ok: false, reason: 'layout-inactive' }

/** Against a core too old to register the handler, synthesizes the same
 *  layout-inactive result a current core reports for an inactive layout. */
const command = async (name: string, params: unknown): Promise<CommandResult> => {
    const result = await mmgisRequestIfProvided<CommandResult>(name, params)
    return result ?? UNREACHABLE
}

/**
 * Every panel in the layout, ordered by priority. Empty against a core with no
 * layout or no handler — follow state with the `panels:changed` event rather
 * than polling.
 */
export const mmgisGetPanels = async (): Promise<PanelInfo[]> => {
    return (await mmgisRequestIfProvided<PanelInfo[]>(PANEL_PLUGIN_BUS.getPanels)) ?? []
}

/** Move a panel to a state. Naming the state makes repeats and retries safe. */
export const mmgisSetPanelState = (panelId: string, state: PanelState): Promise<CommandResult> =>
    command(PANEL_PLUGIN_BUS.setPanelState, { panelId, state })

/** Restore a collapsed panel to the state it last held. */
export const mmgisShowPanel = (panelId: string): Promise<CommandResult> =>
    command(PANEL_PLUGIN_BUS.showPanel, { panelId })

/** Collapse a panel without destroying its contents. */
export const mmgisHidePanel = (panelId: string): Promise<CommandResult> =>
    command(PANEL_PLUGIN_BUS.hidePanel, { panelId })

/** Every plugin known to the layout and its lifecycle state. */
export const mmgisGetPlugins = async (): Promise<PluginInfo[]> => {
    return (await mmgisRequestIfProvided<PluginInfo[]>(PANEL_PLUGIN_BUS.getPlugins)) ?? []
}

/** Move a plugin to a lifecycle state, loading it first if that is required. */
export const mmgisSetPluginState = (pluginId: string, state: PluginState): Promise<CommandResult> =>
    command(PANEL_PLUGIN_BUS.setPluginState, { pluginId, state })

/** Reveal a plugin, loading it first if it is unloaded. */
export const mmgisShowPlugin = (pluginId: string): Promise<CommandResult> =>
    command(PANEL_PLUGIN_BUS.showPlugin, { pluginId })

/** Hide a plugin without destroying its instance or state. */
export const mmgisHidePlugin = (pluginId: string): Promise<CommandResult> =>
    command(PANEL_PLUGIN_BUS.hidePlugin, { pluginId })

/** Subscribe to layout changes; the payload carries the full panel listing. */
export const mmgisOnPanelsChanged = (
    handler: (panels: PanelInfo[]) => void,
): EventCleanup =>
    mmgisOn(PANEL_PLUGIN_EVENTS.panelsChanged, (payload) =>
        handler(((payload as { panels?: PanelInfo[] })?.panels) ?? []),
    )

/** Subscribe to plugin lifecycle changes; the payload carries every plugin. */
export const mmgisOnPluginsChanged = (
    handler: (plugins: PluginInfo[]) => void,
): EventCleanup =>
    mmgisOn(PANEL_PLUGIN_EVENTS.pluginsChanged, (payload) =>
        handler(((payload as { plugins?: PluginInfo[] })?.plugins) ?? []),
    )

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
