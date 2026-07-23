import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketServer, WebSocket } from 'ws'
import { BridgeClient } from '../src/bridge.js'
import { MMGISError } from '../src/mmgisClient.js'

// Mimics MMGIS API/websocket.js: relay every frame to ALL clients (sender included)
function startRelay(): Promise<{ wss: WebSocketServer; url: string }> {
    return new Promise((resolve) => {
        const wss = new WebSocketServer({ port: 0 }, () => {
            const { port } = wss.address() as { port: number }
            resolve({ wss, url: `ws://127.0.0.1:${port}/` })
        })
        wss.on('connection', (ws) => {
            ws.on('message', (m) => {
                for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(m.toString())
            })
        })
    })
}

// Fake AgentBridge browser session
function fakeBrowser(url: string, mission: string, respond: (agent: any) => any): WebSocket {
    const ws = new WebSocket(url)
    ws.on('message', (m) => {
        const parsed = JSON.parse(m.toString())
        if (parsed.type !== 'agent-bridge' || parsed.agent?.kind !== 'command') return
        if (parsed.body?.mission !== mission) return
        ws.send(
            JSON.stringify({
                type: 'agent-bridge',
                body: { mission },
                info: { type: 'agentBridge' },
                agent: { kind: 'ack', id: parsed.agent.id, sessionId: 's1', ...respond(parsed.agent) },
            })
        )
    })
    return ws
}

describe('BridgeClient', () => {
    let wss: WebSocketServer, browser: WebSocket | null = null, bridge: BridgeClient

    afterEach(() => {
        bridge?.close()
        browser?.close()
        wss?.close()
    })

    it('sends a command frame and resolves with the ack result', async () => {
        const relay = await startRelay()
        wss = relay.wss
        browser = fakeBrowser(relay.url, 'Demo', (agent) => ({ ok: true, result: { echoed: agent.command } }))
        await new Promise((r) => browser!.on('open', r))
        bridge = new BridgeClient(relay.url, 2000)
        const result = await bridge.sendCommand('Demo', 'fly_to', { lat: 1, lon: 2 })
        expect(result).toEqual({ echoed: 'fly_to' })
    })

    it('rejects with the browser-reported error on failed acks', async () => {
        const relay = await startRelay()
        wss = relay.wss
        browser = fakeBrowser(relay.url, 'Demo', () => ({ ok: false, error: 'Unknown layer: X' }))
        await new Promise((r) => browser!.on('open', r))
        bridge = new BridgeClient(relay.url, 2000)
        await expect(bridge.sendCommand('Demo', 'toggle_layer', { layer: 'X' })).rejects.toThrow('Unknown layer: X')
    })

    it('times out with a helpful hint when no session responds', async () => {
        const relay = await startRelay()
        wss = relay.wss
        bridge = new BridgeClient(relay.url, 300)
        const err = await bridge.sendCommand('Demo', 'fly_to', {}).catch((e) => e)
        expect(err.message).toMatch(/No browser session/)
        expect(err.hint).toMatch(/AgentBridge/)
    })

    it('ignores acks for other missions (browser filters by mission)', async () => {
        const relay = await startRelay()
        wss = relay.wss
        browser = fakeBrowser(relay.url, 'OtherMission', () => ({ ok: true, result: {} }))
        await new Promise((r) => browser!.on('open', r))
        bridge = new BridgeClient(relay.url, 300)
        await expect(bridge.sendCommand('Demo', 'fly_to', {})).rejects.toThrow(/No browser session/)
    })

    it('dedupes concurrent connects: two overlapping sendCommand calls share one bridge connection', async () => {
        const relay = await startRelay()
        wss = relay.wss

        // Attach the connection counter BEFORE anything connects, so both the
        // fake browser's connection and the bridge client's connection(s) are
        // counted.
        let connectionCount = 0
        wss.on('connection', () => {
            connectionCount++
        })

        browser = fakeBrowser(relay.url, 'Demo', (agent) => ({ ok: true, result: { echoed: agent.command } }))
        await new Promise((r) => browser!.on('open', r))
        expect(connectionCount).toBe(1) // sanity: only the fake browser so far

        bridge = new BridgeClient(relay.url, 2000)
        // Fire both calls back-to-back without awaiting between them, both
        // before the underlying websocket has finished connecting.
        const p1 = bridge.sendCommand('Demo', 'fly_to', { lat: 1, lon: 2 })
        const p2 = bridge.sendCommand('Demo', 'toggle_layer', { layer: 'X' })

        const [r1, r2] = await Promise.all([p1, p2])
        expect(r1).toEqual({ echoed: 'fly_to' })
        expect(r2).toEqual({ echoed: 'toggle_layer' })

        // connectionCount now includes the fake browser's connection (1) plus
        // however many connections the bridge client opened. Subtracting the
        // browser's one isolates the bridge client's connection count, which
        // must be exactly 1 even though two sendCommand calls overlapped.
        expect(connectionCount - 1).toBe(1)
    })

    it('rejects with an actionable hint when the relay is unreachable', async () => {
        bridge = new BridgeClient('ws://127.0.0.1:1/', 300)
        const err = await bridge.sendCommand('Demo', 'fly_to', {}).catch((e) => e)
        expect(err).toBeInstanceOf(MMGISError)
        expect(err.hint).toMatch(/ENABLE_MMGIS_WEBSOCKETS/)
    })
})
