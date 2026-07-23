// Whitelisted, view-only commands the agent bridge can execute.
// All MMGIS internals arrive via `deps` so this module stays unit-testable.

function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v)
}

// Mission configs (and our dashboard_tool_options) expose a tool's display
// `name` (e.g. 'LayerManager'), but the id-keyed APIs that actually open a
// tool — window.mmgisAPI.showPlugin/loadPlugin/isPluginLoaded/isPluginHidden
// (modern) and ToolController_.toolModules/makeTool (classic) — are keyed by
// the config's `js` id (e.g. 'LayerManagerTool'). Accept either form so
// `open_tool` works whether the agent passes the display name or the js id.
export function resolveToolId(tools, name) {
    const entry = (tools || []).find((t) => t.name === name || t.js === name)
    return entry ? entry.js : name
}

export function getViewState(deps) {
    const { Map_, L_, ToolAdapter, TimeControl } = deps
    return {
        mission: L_.mission || null,
        center: Map_.map && Map_.map.getCenter ? Map_.map.getCenter() : null,
        zoom: Map_.map && Map_.map.getZoom ? Map_.map.getZoom() : null,
        layersOn: L_.layers ? L_.layers.on : {},
        activeTool:
            ToolAdapter && typeof ToolAdapter.activeToolName === 'function'
                ? ToolAdapter.activeToolName()
                : null,
        currentTime: TimeControl && TimeControl.getTime ? TimeControl.getTime() : null,
    }
}

export async function executeCommand(command, args, deps) {
    const { Map_, L_, ToolAdapter, TimeControl } = deps
    const a = args || {}
    switch (command) {
        case 'fly_to': {
            if (!isFiniteNumber(a.lat) || !isFiniteNumber(a.lon))
                return { ok: false, error: 'fly_to requires numeric lat and lon' }
            Map_.resetView([a.lat, a.lon, isFiniteNumber(a.zoom) ? a.zoom : undefined])
            return { ok: true, result: getViewState(deps) }
        }
        case 'toggle_layer': {
            if (typeof a.layer !== 'string')
                return { ok: false, error: 'toggle_layer requires a layer name or uuid' }
            const uuid = L_.asLayerUUID(a.layer)
            if (uuid == null || L_.layers.data[uuid] == null)
                return { ok: false, error: `Unknown layer: ${a.layer}` }
            const current = L_.layers.on[uuid]
            if (typeof a.on === 'boolean' && current === a.on)
                return { ok: true, result: { layer: uuid, on: current } }
            await L_.toggleLayer(L_.layers.data[uuid])
            return { ok: true, result: { layer: uuid, on: L_.layers.on[uuid] } }
        }
        case 'open_tool': {
            if (typeof a.name !== 'string')
                return { ok: false, error: 'open_tool requires a tool name' }
            if (!ToolAdapter || typeof ToolAdapter.openTool !== 'function')
                return { ok: false, error: 'open_tool is not supported in this session' }
            const outcome = ToolAdapter.openTool(a.name)
            if (!outcome || outcome.ok !== true)
                return {
                    ok: false,
                    error: (outcome && outcome.error) || `Unknown or unopenable tool: ${a.name}`,
                }
            return { ok: true, result: { activeTool: outcome.activeTool ?? null } }
        }
        case 'set_time': {
            if (!a.startTime || !a.endTime)
                return { ok: false, error: 'set_time requires startTime and endTime (ISO strings)' }
            const ok = TimeControl.setTime(a.startTime, a.endTime, false, '00:00:00', a.currentTime)
            if (ok === false)
                return { ok: false, error: 'Time is not enabled for this mission' }
            return { ok: true, result: { currentTime: TimeControl.getTime() } }
        }
        case 'get_view_state':
            return { ok: true, result: getViewState(deps) }
        default:
            return { ok: false, error: `Unknown command: ${command}` }
    }
}
