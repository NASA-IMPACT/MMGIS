#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from './config.js'
import { MmgisClient } from './mmgisClient.js'
import { makeAdminTools } from './tools/admin.js'
import { makeDashboardTools } from './tools/dashboard.js'
import { makeCatalogTools } from './tools/catalog.js'
import { buildServer } from './server.js'

async function main() {
    const cfg = loadConfig()
    const client = new MmgisClient(cfg.mmgisUrl, cfg.mmgisToken)
    const server = buildServer({
        tools: [...makeAdminTools(client), ...makeDashboardTools(client, cfg), ...makeCatalogTools(cfg)],
    })
    await server.connect(new StdioServerTransport())
    // stdio server runs until the client disconnects
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
