import { describe, it, expect, vi } from 'vitest'
import { McpBridge } from '../lib/mcpBridge.js'

function fakeClient(overrides = {}) {
    return {
        listTools: vi.fn(async () => ({
            tools: [
                { name: 'mission_list', description: 'List missions', inputSchema: { type: 'object', properties: {} } },
            ],
        })),
        callTool: vi.fn(async () => ({ content: [{ type: 'text', text: '{"missions":[]}' }] })),
        close: vi.fn(async () => {}),
        ...overrides,
    }
}

describe('McpBridge', () => {
    it('converts MCP tools to OpenAI function schemas and caches them', async () => {
        const client = fakeClient()
        const bridge = new McpBridge({}, async () => ({ client }))
        const tools = await bridge.getOpenAiTools()
        expect(tools).toEqual([
            {
                type: 'function',
                function: { name: 'mission_list', description: 'List missions', parameters: { type: 'object', properties: {} } },
            },
        ])
        await bridge.getOpenAiTools()
        expect(client.listTools).toHaveBeenCalledTimes(1)
    })
    it('callTool returns text and isError', async () => {
        const client = fakeClient({
            callTool: vi.fn(async ({ name }) => ({ content: [{ type: 'text', text: `ran ${name}` }], isError: false })),
        })
        const bridge = new McpBridge({}, async () => ({ client }))
        const out = await bridge.callTool('mission_list', {})
        expect(out).toEqual({ text: 'ran mission_list', isError: false })
        expect(client.callTool).toHaveBeenCalledWith({ name: 'mission_list', arguments: {} })
    })
    it('a throwing callTool yields an isError result and resets the connection for retry', async () => {
        let calls = 0
        const dead = fakeClient({ callTool: vi.fn(async () => { throw new Error('transport closed') }) })
        const alive = fakeClient()
        const bridge = new McpBridge({}, async () => ({ client: ++calls === 1 ? dead : alive }))
        const out = await bridge.callTool('mission_list', {})
        expect(out.isError).toBe(true)
        expect(out.text).toContain('transport closed')
        expect(bridge.isConnected()).toBe(false)
        expect(dead.close).toHaveBeenCalledTimes(1)
        const retry = await bridge.callTool('mission_list', {})
        expect(retry.isError).toBe(false)
    })
    it('concurrent connect() callers only invoke the clientFactory once', async () => {
        const client = fakeClient()
        const factory = vi.fn(async () => {
            await new Promise((r) => setTimeout(r, 20))
            return { client }
        })
        const bridge = new McpBridge({}, factory)
        await Promise.all([bridge.callTool('mission_list', {}), bridge.callTool('mission_list', {})])
        expect(factory).toHaveBeenCalledTimes(1)
    })
    it('callTool serializes a non-Error throw into the error text', async () => {
        const client = fakeClient({ callTool: vi.fn(async () => { throw 'boom string' }) })
        const bridge = new McpBridge({}, async () => ({ client }))
        const out = await bridge.callTool('mission_list', {})
        expect(out.isError).toBe(true)
        expect(out.text).toContain('boom string')
    })
})
