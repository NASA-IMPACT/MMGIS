import 'dotenv/config'
import OpenAI from 'openai'
import { loadConfig } from './lib/config.js'
import { McpBridge } from './lib/mcpBridge.js'
import { createApp } from './lib/app.js'

const cfg = loadConfig()
const openai = new OpenAI({ apiKey: cfg.apiKey })
const bridge = new McpBridge(cfg)

const app = createApp({ cfg, openai, bridge })
app.listen(cfg.port, () => {
    console.log(`MMGIS chat UI: http://localhost:${cfg.port} (model: ${cfg.model})`)
})

const shutdown = async () => {
    await bridge.close().catch(() => {})
    process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
