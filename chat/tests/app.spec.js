import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from '../lib/app.js'

const cfg = { model: 'test-model', port: 0 }

function fakeBridge() {
    return {
        isConnected: () => true,
        getOpenAiTools: async () => [{ type: 'function', function: { name: 'mission_list', description: 'List', parameters: {} } }],
        callTool: async () => ({ text: '{"ok":true}', isError: false }),
    }
}

function fakeOpenai(script) {
    return {
        chat: {
            completions: {
                create: async () => (async function* () {
                    for (const c of script) yield { choices: [{ delta: c }] }
                })(),
            },
        },
    }
}

async function readSse(res) {
    const text = await res.text()
    return text.split('\n\n').filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, '')))
}

describe('chat app', () => {
    let server
    afterEach(() => server?.close())

    async function start(app) {
        await new Promise((resolve) => { server = app.listen(0, resolve) })
        return `http://127.0.0.1:${server.address().port}`
    }

    it('GET /api/health reports model and mcp status', async () => {
        const url = await start(createApp({ cfg, openai: fakeOpenai([]), bridge: fakeBridge() }))
        const out = await (await fetch(`${url}/api/health`)).json()
        expect(out).toEqual({ ok: true, model: 'test-model', mcpConnected: true, toolCount: 1 })
    })

    it('GET /api/tools lists tool names and descriptions', async () => {
        const url = await start(createApp({ cfg, openai: fakeOpenai([]), bridge: fakeBridge() }))
        const out = await (await fetch(`${url}/api/tools`)).json()
        expect(out.tools).toEqual([{ name: 'mission_list', description: 'List' }])
    })

    it('POST /api/chat streams SSE events ending in done', async () => {
        const url = await start(createApp({ cfg, openai: fakeOpenai([{ content: 'Hi' }]), bridge: fakeBridge() }))
        const res = await fetch(`${url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
        })
        expect(res.headers.get('content-type')).toContain('text/event-stream')
        expect(await readSse(res)).toEqual([{ type: 'text', delta: 'Hi' }, { type: 'done' }])
    })

    it('rejects malformed bodies with 400', async () => {
        const url = await start(createApp({ cfg, openai: fakeOpenai([]), bridge: fakeBridge() }))
        const res = await fetch(`${url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: 'nope' }),
        })
        expect(res.status).toBe(400)
    })

    it('maps loop failures to an SSE error event', async () => {
        const openai = { chat: { completions: { create: async () => { throw new Error('bad key') } } } }
        const url = await start(createApp({ cfg, openai, bridge: fakeBridge() }))
        const res = await fetch(`${url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
        })
        const events = await readSse(res)
        expect(events.at(-1)).toEqual({ type: 'error', message: 'bad key' })
    })
})
