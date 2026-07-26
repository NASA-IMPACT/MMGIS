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
        res.json({
            ok: true,
            model: cfg.model,
            mcpConnected: bridge.isConnected(),
            toolCount,
            mmgisUrl: cfg.mcpEnv?.MMGIS_URL ?? null,
            // Where the dashboard UI is served (webpack dev server differs from the API port)
            dashboardUrl: cfg.mcpEnv?.MMGIS_DASHBOARD_URL ?? cfg.mcpEnv?.MMGIS_URL ?? null,
        })
    })

    app.get('/api/missions', async (req, res) => {
        try {
            const out = await bridge.callTool('mission_list', {})
            if (out.isError) return res.status(502).json({ error: out.text })
            res.json({ missions: JSON.parse(out.text).missions ?? [] })
        } catch (err) {
            res.status(502).json({ error: String(err?.message ?? err) })
        }
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
            send({ type: 'error', message: String(err?.message ?? err) })
        }
        res.end()
    })

    return app
}
