import { describe, it, expect } from 'vitest'
import { loadConfig } from '../lib/config.js'

const base = { OPENAI_API_KEY: 'sk-test' }

describe('loadConfig', () => {
    it('throws without OPENAI_API_KEY', () => {
        expect(() => loadConfig({})).toThrow(/OPENAI_API_KEY/)
    })
    it('applies defaults', () => {
        const cfg = loadConfig({ ...base })
        expect(cfg.model).toBe('gpt-4o')
        expect(cfg.port).toBe(8895)
        expect(cfg.mcpCommand).toBe('node')
        expect(cfg.mcpArgs).toEqual(['../mcp/dist/index.js'])
        expect(cfg.mcpCwd.endsWith('/chat')).toBe(true)
    })
    it('honors overrides and splits MCP_ARGS on spaces', () => {
        const cfg = loadConfig({ ...base, OPENAI_MODEL: 'gpt-4o-mini', CHAT_PORT: '9000', MCP_ARGS: 'dist/index.js --flag' })
        expect(cfg.model).toBe('gpt-4o-mini')
        expect(cfg.port).toBe(9000)
        expect(cfg.mcpArgs).toEqual(['dist/index.js', '--flag'])
    })
    it('passes the whole env through as mcpEnv', () => {
        const cfg = loadConfig({ ...base, MMGIS_TOKEN: 'tok' })
        expect(cfg.mcpEnv.MMGIS_TOKEN).toBe('tok')
    })
})
