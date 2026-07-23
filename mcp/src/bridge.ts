import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import { MMGISError } from './mmgisClient.js'

export class BridgeClient {
    private ws: WebSocket | null = null

    constructor(private wsUrl: string, private timeoutMs = 5000) {}

    private connect(): Promise<WebSocket> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve(this.ws)
        }
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl)
            ws.once('open', () => {
                this.ws = ws
                resolve(ws)
            })
            ws.once('error', (err) => {
                reject(
                    new MMGISError(
                        `Could not connect to the MMGIS websocket at ${this.wsUrl}: ${err.message}`,
                        'Set ENABLE_MMGIS_WEBSOCKETS=true in the MMGIS .env and check MMGIS_WS_URL.'
                    )
                )
            })
        })
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
    }
}
