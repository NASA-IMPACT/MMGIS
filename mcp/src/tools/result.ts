import type { z } from 'zod'

export interface ToolDef {
    name: string
    description: string
    schema: z.ZodRawShape
    handler: (args: any) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>
}

export function toToolResult(data: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

export function toErrorResult(err: unknown) {
    const e = err as { message?: string; hint?: string }
    return {
        isError: true,
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify({ error: e?.message || String(err), ...(e?.hint ? { hint: e.hint } : {}) }),
            },
        ],
    }
}
