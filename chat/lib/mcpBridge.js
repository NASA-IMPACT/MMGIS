import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

async function defaultClientFactory(cfg) {
    const transport = new StdioClientTransport({
        command: cfg.mcpCommand,
        args: cfg.mcpArgs,
        cwd: cfg.mcpCwd,
        env: cfg.mcpEnv,
    })
    const client = new Client({ name: 'mmgis-chat', version: '0.1.0' })
    await client.connect(transport)
    return { client }
}

export class McpBridge {
    constructor(cfg, clientFactory = defaultClientFactory) {
        this.cfg = cfg
        this.clientFactory = clientFactory
        this.client = null
        this.tools = null
    }

    async connect() {
        if (this.client) return
        const { client } = await this.clientFactory(this.cfg)
        this.client = client
    }

    isConnected() {
        return this.client != null
    }

    async getOpenAiTools() {
        await this.connect()
        if (!this.tools) {
            const { tools } = await this.client.listTools()
            this.tools = tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description || '', parameters: t.inputSchema },
            }))
        }
        return this.tools
    }

    async callTool(name, args) {
        try {
            await this.connect()
            const res = await this.client.callTool({ name, arguments: args })
            return { text: res.content?.[0]?.text ?? '', isError: Boolean(res.isError) }
        } catch (err) {
            // Drop the connection so the next call reconnects (fresh MCP process)
            this.client = null
            this.tools = null
            return { text: JSON.stringify({ error: err.message }), isError: true }
        }
    }

    async close() {
        await this.client?.close()
        this.client = null
        this.tools = null
    }
}
