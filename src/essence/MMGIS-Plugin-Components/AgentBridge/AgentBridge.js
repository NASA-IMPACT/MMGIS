import Map_ from '../../Basics/Map_/Map_'
import L_ from '../../Basics/Layers_/Layers_'
import ToolController_ from '../../Basics/ToolController_/ToolController_'
import TimeControl from '../../Basics/TimeControl_/TimeControl'
import { isStaticBuild } from '../../../pre/capabilities'
import { executeCommand } from './commands'

// Envelope contract shared with mcp/src/bridge.ts — keep in sync.
const FRAME_TYPE = 'agent-bridge'
const RECONNECT_MS = 10000

const AgentBridge = {
    ws: null,
    sessionId: null,

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
        if (parsed == null || parsed.type !== FRAME_TYPE) return
        if (parsed.agent == null || parsed.agent.kind !== 'command') return
        if (parsed.body == null || parsed.body.mission !== L_.mission) return

        const { id, command, args } = parsed.agent
        let outcome
        try {
            outcome = await executeCommand(command, args, {
                Map_,
                L_,
                ToolController_,
                TimeControl,
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
