import { z } from 'zod'
import type { MmgisClient } from '../mmgisClient.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

export function makeAdminTools(client: MmgisClient): ToolDef[] {
    return [
        {
            name: 'mission_list',
            description: 'List all mission (dashboard) names in this MMGIS deployment.',
            schema: {},
            handler: async () => {
                try {
                    return toToolResult({ missions: await client.listMissions() })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
        {
            name: 'mission_get',
            description: "Get a mission's full configuration JSON and current version.",
            schema: { mission: z.string().describe('Mission name (see mission_list)') },
            handler: async ({ mission }: { mission: string }) => {
                try {
                    const out = await client.getMission(mission)
                    return toToolResult({ mission: out.mission, version: out.version, config: out.config })
                } catch (err) {
                    return toErrorResult(err)
                }
            },
        },
    ]
}
