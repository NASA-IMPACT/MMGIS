import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildServer } from '../src/server.js'
import { makeAdminTools } from '../src/tools/admin.js'

describe('buildServer', () => {
    it('registers tools and answers listTools over MCP', async () => {
        const server = buildServer({ tools: makeAdminTools({ listMissions: async () => [] } as any) })
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await server.connect(serverTransport)
        const client = new Client({ name: 'test', version: '0.0.0' })
        await client.connect(clientTransport)
        const { tools } = await client.listTools()
        expect(tools.map((t) => t.name)).toContain('mission_list')
    })
})
