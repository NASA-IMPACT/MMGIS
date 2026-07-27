import Map_ from '../../Basics/Map_/Map_'
import L_ from '../../Basics/Layers_/Layers_'
import ToolController_ from '../../Basics/ToolController_/ToolController_'
import TimeControl from '../../Basics/TimeControl_/TimeControl'
import { isStaticBuild } from '../../../pre/capabilities'
import { executeCommand, resolveToolId, sameMission, shouldReloadForFrame } from './commands'

// Envelope contract shared with mcp/src/bridge.ts — keep in sync.
const FRAME_TYPE = 'agent-bridge'
const RECONNECT_MS = 10000
// Coalesce bursts of config-mutation broadcasts (e.g. several layer_add
// calls in a row) into a single reload instead of reloading per-frame.
const RELOAD_DEBOUNCE_MS = 800

// Shared modern-vs-classic mode check. Modern missions set
// L_.configData.msv.mode === 'modern'; everything else is classic.
// Kept as a single source of truth so the tool adapter and the
// auto-reload gate below never disagree about which mode is active.
function isModernMission() {
    return !!(L_.configData && L_.configData.msv && L_.configData.msv.mode === 'modern')
}

// Builds the tool-activation adapter `commands.js` uses for `open_tool` /
// `get_view_state`. Classic missions run the exclusive-panel ToolController_;
// modern missions (L_.configData.msv.mode === 'modern') never instantiate it
// — only ToolControllerModern_ runs, wired up behind window.mmgisAPI's
// show/hide/load-plugin API. Keeping the mode switch here (not in commands.js)
// lets commands.js stay a plain, dependency-injected, unit-testable module.
// Shared result shape for the modern openTool branches below.
function toOpenResult(ok, toolId, name) {
    return ok
        ? { ok: true, activeTool: toolId }
        : { ok: false, error: `Unknown or unopenable tool: ${name}` }
}

function buildToolAdapter() {
    const isModern = isModernMission()

    if (isModern) {
        return {
            mode: 'modern',
            // Modern layout has no single exclusive "active tool" — panels can
            // show many tools at once — so there is nothing honest to report here.
            activeToolName: function () {
                return null
            },
            openTool: function (name) {
                const api = window.mmgisAPI
                if (!api || typeof api.isPluginLoaded !== 'function') {
                    return {
                        ok: false,
                        error: 'open_tool is not supported in modern mode yet',
                    }
                }
                const toolId = resolveToolId(L_.configData && L_.configData.tools, name)
                const loaded = api.isPluginLoaded(toolId)
                const hidden = api.isPluginHidden(toolId)

                if (loaded && !hidden) {
                    // Already visible; treat as a success (idempotent open).
                    return toOpenResult(true, toolId, name)
                }
                if (loaded && hidden) {
                    // Loaded but hidden (hidePlugin / startHidden) — reveal it.
                    return toOpenResult(api.showPlugin(toolId), toolId, name)
                }
                if (!loaded && hidden) {
                    // Deferred (startUnloaded / previously unloadPlugin'd) — load it.
                    return toOpenResult(api.loadPlugin(toolId), toolId, name)
                }
                // Neither loaded nor deferred: this name was never assigned to a
                // panel in this mission's config — there is no ground truth that
                // says opening it did anything.
                return toOpenResult(false, toolId, name)
            },
        }
    }

    return {
        mode: 'classic',
        activeToolName: function () {
            return ToolController_.activeToolName
        },
        openTool: function (name) {
            const toolId = resolveToolId(L_.configData && L_.configData.tools, name)
            const tool = ToolController_.toolModules && ToolController_.toolModules[toolId]
            if (
                !tool ||
                typeof tool.make !== 'function' ||
                typeof tool.destroy !== 'function'
            ) {
                return { ok: false, error: `Unknown or unopenable tool: ${name}` }
            }
            ToolController_.makeTool(toolId)
            return { ok: true, activeTool: ToolController_.activeToolName }
        },
    }
}

const AgentBridge = {
    ws: null,
    sessionId: null,
    reloadTimer: null,

    init: function (vars) {
        this.sessionId =
            window.crypto && window.crypto.randomUUID
                ? window.crypto.randomUUID()
                : String(Math.random()).slice(2)
        this.connect()
    },

    getWsPath: function () {
        const g = window.mmgisglobal || {}
        if (isStaticBuild()) return null
        if (!g.PORT) return null
        if (g.ENABLE_MMGIS_WEBSOCKETS !== 'true') return null
        const protocol =
            window.location.protocol.indexOf('https') !== -1 ? 'wss' : 'ws'
        const rootPath = g.WEBSOCKET_ROOT_PATH || g.ROOT_PATH || ''
        const host =
            g.NODE_ENV === 'development'
                ? `localhost:${parseInt(g.PORT || '8888', 10)}`
                : window.location.host
        return `${protocol}://${host}${rootPath}/`
    },

    connect: function () {
        const path = this.getWsPath()
        if (path == null) {
            console.warn(
                '[AgentBridge] Websockets disabled (static build, no PORT, or ENABLE_MMGIS_WEBSOCKETS != true); agent bridge inactive.'
            )
            return
        }
        try {
            this.ws = new WebSocket(path)
        } catch (err) {
            console.warn('[AgentBridge] Failed to open websocket:', err)
            setTimeout(() => this.connect(), RECONNECT_MS)
            return
        }
        this.ws.onopen = () => {
            this.send({ kind: 'presence', sessionId: this.sessionId })
        }
        this.ws.onmessage = (event) => this.onMessage(event)
        this.ws.onclose = () => {
            setTimeout(() => this.connect(), RECONNECT_MS)
        }
    },

    send: function (agent) {
        if (!this.ws || this.ws.readyState !== 1) return
        this.ws.send(
            JSON.stringify({
                type: FRAME_TYPE,
                body: { mission: L_.mission },
                info: { type: 'agentBridge' },
                agent,
            })
        )
    },

    onMessage: async function (event) {
        let parsed
        try {
            parsed = JSON.parse(event.data)
        } catch (err) {
            return
        }

        // Config-mutation broadcast (not an agent-bridge frame): modern.js
        // has no websocket client of its own, so this is the only place
        // that can notice a saved config change and bring the session
        // current. Debounced so a burst of edits reloads once, not per-frame.
        // Modern-only: classic sessions already live-apply layer frames
        // natively via essence.js, so reloading there would be redundant
        // (and destructive to any unsaved local UI state).
        if (shouldReloadForFrame(parsed, L_.mission) && isModernMission()) {
            clearTimeout(this.reloadTimer)
            this.reloadTimer = setTimeout(() => {
                window.location.reload()
            }, RELOAD_DEBOUNCE_MS)
        }

        if (parsed == null || parsed.type !== FRAME_TYPE) return
        if (parsed.agent == null || parsed.agent.kind !== 'command') return
        if (parsed.body == null || !sameMission(parsed.body.mission, L_.mission)) return

        const { id, command, args } = parsed.agent
        let outcome
        try {
            outcome = await executeCommand(command, args, {
                Map_,
                L_,
                ToolAdapter: buildToolAdapter(),
                TimeControl,
                reload: () => window.location.reload(),
            })
        } catch (err) {
            outcome = { ok: false, error: `Command threw: ${err.message}` }
        }
        this.send({
            kind: 'ack',
            id,
            sessionId: this.sessionId,
            ok: outcome.ok,
            result: outcome.result,
            error: outcome.error,
        })
    },
}

export default AgentBridge
