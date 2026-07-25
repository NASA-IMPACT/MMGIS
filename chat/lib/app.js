import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { runAgentLoop } from './agentLoop.js'

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

export function createApp({ cfg, openai, bridge }) {
    const app = express()
    app.use(express.json({ limit: '2mb' }))
    app.use(express.static(PUBLIC_DIR))

    app.get('/api/health', async (req, res) => {
        let toolCount = 0
        try {
            toolCount = (await bridge.getOpenAiTools()).length
        } catch {
            // leave toolCount 0; mcpConnected reflects reality below
        }
        res.json({ ok: true, model: cfg.model, mcpConnected: bridge.isConnected(), toolCount })
    })

    app.get('/api/tools', async (req, res) => {
        try {
            const tools = await bridge.getOpenAiTools()
            res.json({ tools: tools.map((t) => ({ name: t.function.name, description: t.function.description })) })
        } catch (err) {
            res.status(502).json({ error: err.message })
        }
    })

    app.post('/api/chat', async (req, res) => {
        const { messages } = req.body || {}
        const valid =
            Array.isArray(messages) &&
            messages.every((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
        if (!valid) {
            return res.status(400).json({ error: 'body must be {messages: [{role: user|assistant, content: string}]}' })
        }
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')
        const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`)
        try {
            await runAgentLoop({ messages, openai, bridge, model: cfg.model, onEvent: send })
        } catch (err) {
            send({ type: 'error', message: err.message })
        }
        res.end()
    })

    return app
}
