import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolDef } from './tools/result.js'

export function buildServer(deps: { tools: ToolDef[] }): McpServer {
    const server = new McpServer({ name: 'mmgis', version: '0.1.0' })
    for (const t of deps.tools) {
        // `server.tool(name, description, schema, handler)` is deprecated in the installed
        // @modelcontextprotocol/sdk version; use the `registerTool` config-object form instead.
        server.registerTool(t.name, { description: t.description, inputSchema: t.schema }, t.handler)
    }
    return server
}
