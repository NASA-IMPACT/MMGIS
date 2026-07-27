import { vi } from 'vitest'

export function fakeFetch(status: number, json: unknown) {
    return vi.fn(async () => ({ ok: status < 400, status, json: async () => json })) as unknown as typeof fetch
}

export function parse(res: { content: { text: string }[] }) {
    return JSON.parse(res.content[0].text)
}
