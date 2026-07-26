import { z } from 'zod'
import type { BridgeClient } from '../bridge.js'
import { type ToolDef, toToolResult, toErrorResult } from './result.js'

export function makeViewTools(bridge: BridgeClient): ToolDef[] {
    const run = async (mission: string, command: string, args: object) => {
        try {
            return toToolResult({ result: await bridge.sendCommand(mission, command, args) })
        } catch (err) {
            return toErrorResult(err)
        }
    }
    const mission = z.string().describe('Exact mission name as returned by mission_list (case and spaces matter)')
    return [
        {
            name: 'view_fly_to',
            description: "Fly a connected browser session's map to a lat/lon (and optional zoom).",
            schema: { mission, lat: z.number(), lon: z.number(), zoom: z.number().optional() },
            handler: ({ mission, ...args }: any) => run(mission, 'fly_to', args),
        },
        {
            name: 'view_toggle_layer',
            description: 'Toggle (or set) a layer\'s visibility in a connected browser session.',
            schema: {
                mission,
                layer: z.string().describe('Layer name or uuid'),
                on: z.boolean().optional().describe('Target state; omit to flip'),
            },
            handler: ({ mission, ...args }: any) => run(mission, 'toggle_layer', args),
        },
        {
            name: 'view_open_tool',
            description: 'Open a tool panel (e.g. Chart, Measure) in a connected browser session.',
            schema: { mission, name: z.string().describe('Tool name') },
            handler: ({ mission, ...args }: any) => run(mission, 'open_tool', args),
        },
        {
            name: 'view_set_time',
            description: 'Set the global time range in a connected browser session (time must be enabled).',
            schema: {
                mission,
                startTime: z.string().describe('ISO datetime'),
                endTime: z.string().describe('ISO datetime'),
                currentTime: z.string().optional(),
            },
            handler: ({ mission, ...args }: any) => run(mission, 'set_time', args),
        },
        {
            name: 'view_get_state',
            description: 'Get the current view state (center, zoom, layers on, active tool, time) of a connected browser session.',
            schema: { mission },
            handler: ({ mission }: any) => run(mission, 'get_view_state', {}),
        },
        {
            name: 'view_reload',
            description: 'Reload an open browser session so non-layer config changes (basemap, page name, tools) take effect. A timeout after sending can mean the page reloaded before acking — treat that as success if view_get_state works afterwards.',
            schema: { mission },
            handler: ({ mission }: any) => run(mission, 'reload', {}),
        },
    ]
}
