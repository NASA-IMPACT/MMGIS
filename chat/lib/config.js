import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadConfig(env = process.env) {
    if (!env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is required — copy chat/.env.example to chat/.env and set it')
    }
    return {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL || 'gpt-4o',
        port: parseInt(env.CHAT_PORT || '8895', 10),
        mcpCommand: env.MCP_COMMAND || 'node',
        mcpArgs: (env.MCP_ARGS || '../mcp/dist/index.js').split(' ').filter(Boolean),
        // chat/lib -> chat/
        mcpCwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
        mcpEnv: { ...env },
    }
}
