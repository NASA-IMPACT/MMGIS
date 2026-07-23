import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { MMGISError } from './mmgisClient.js'

export class BridgeClient {
    private ws: WebSocket | null = null
    private connecting: Promise<WebSocket> | null = null

    constructor(private wsUrl: string, private timeoutMs = 5000) {}

    private connect(): Promise<WebSocket> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve(this.ws)
        }
        if (this.connecting) {
            return this.connecting
        }
        this.connecting = new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl)
            ws.once('open', () => {
                this.ws = ws
                this.connecting = null
                resolve(ws)
                // The `once('error', ...)` below only guards the connect phase —
                // it's still attached (it hasn't fired) but a socket that errors
                // post-open would otherwise leave us holding a dead `this.ws`
                // forever. Keep a persistent handler so a later socket error
                // can't crash the process (EventEmitter throws on an unhandled
                // 'error' with zero listeners) and so the next sendCommand()
                // reconnects instead of reusing the broken socket.
                ws.on('error', () => {
                    // Only clear state that still belongs to this socket — if a
                    // newer reconnect has already replaced `this.ws`/`this.connecting`
                    // (e.g. this ws was closed and connect() was called again before
                    // this stale error fired), leave that newer in-flight state alone.
                    const wasCurrent = this.ws === ws
                    if (wasCurrent) this.ws = null
                    if (wasCurrent && this.connecting) this.connecting = null
                })
            })
            ws.once('error', (err) => {
                this.connecting = null
                reject(
                    new MMGISError(
                        `Could not connect to the MMGIS websocket at ${this.wsUrl}: ${err.message}`,
                        'Set ENABLE_MMGIS_WEBSOCKETS=true in the MMGIS .env and check MMGIS_WS_URL.'
                    )
                )
            })
        })
        return this.connecting
    }

    async sendCommand(mission: string, command: string, args: object): Promise<any> {
        const ws = await this.connect()
        const id = randomUUID()
        const frame = JSON.stringify({
            type: 'agent-bridge',
            body: { mission },
            info: { type: 'agentBridge' },
            agent: { kind: 'command', id, command, args },
        })
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup()
                reject(
                    new MMGISError(
                        `No browser session responded for mission "${mission}" within ${this.timeoutMs}ms`,
                        'Open the mission in a browser — the AgentBridge component must be enabled in its config (dashboard_generate does this automatically).'
                    )
                )
            }, this.timeoutMs)
            const onMessage = (data: WebSocket.RawData) => {
                try {
                    const parsed = JSON.parse(data.toString())
                    if (parsed?.type === 'agent-bridge' && parsed.agent?.kind === 'ack' && parsed.agent.id === id) {
                        cleanup()
                        if (parsed.agent.ok) resolve(parsed.agent.result)
                        else reject(new MMGISError(parsed.agent.error || 'Command failed in the browser'))
                    }
                } catch {
                    // non-JSON or unrelated frame — ignore
                }
            }
            const cleanup = () => {
                clearTimeout(timer)
                ws.off('message', onMessage)
            }
            ws.on('message', onMessage)
            ws.send(frame)
        })
    }

    close() {
        this.ws?.close()
        this.ws = null
        this.connecting = null
    }
}
