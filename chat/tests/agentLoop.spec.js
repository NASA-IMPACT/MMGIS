import { describe, it, expect, vi } from 'vitest'
import { runAgentLoop, SYSTEM_PROMPT } from '../lib/agentLoop.js'

// Builds a fake OpenAI client whose create() returns scripted streams, in order.
// Each script is an array of {content?} | {tool?: {index, id?, name?, args?}} chunk specs.
function fakeOpenai(scripts) {
    let call = 0
    const seen = []
    return {
        seen,
        chat: {
            completions: {
                create: vi.fn(async (params) => {
                    seen.push(params)
                    const script = scripts[call++]
                    async function* gen() {
                        for (const c of script) {
                            if (c.content !== undefined) {
                                yield { choices: [{ delta: { content: c.content } }] }
                            } else if (c.tool) {
                                yield {
                                    choices: [{
                                        delta: {
                                            tool_calls: [{
                                                index: c.tool.index,
                                                ...(c.tool.id ? { id: c.tool.id } : {}),
                                                function: {
                                                    ...(c.tool.name ? { name: c.tool.name } : {}),
                                                    ...(c.tool.args ? { arguments: c.tool.args } : {}),
                                                },
                                            }],
                                        },
                                    }],
                                }
                            }
                        }
                    }
                    return gen()
                }),
            },
        },
    }
}

const bridge = {
    getOpenAiTools: async () => [{ type: 'function', function: { name: 'mission_list', description: '', parameters: {} } }],
    callTool: vi.fn(async (name) => ({ text: `{"ran":"${name}"}`, isError: false })),
}

describe('runAgentLoop', () => {
    it('streams text and finishes with done when no tools are called', async () => {
        const openai = fakeOpenai([[{ content: 'Hello' }, { content: ' there' }]])
        const events = []
        await runAgentLoop({ messages: [{ role: 'user', content: 'hi' }], openai, bridge, model: 'm', onEvent: (e) => events.push(e) })
        expect(events).toEqual([
            { type: 'text', delta: 'Hello' },
            { type: 'text', delta: ' there' },
            { type: 'done' },
        ])
        expect(openai.seen[0].messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
    })

    it('accumulates fragmented tool-call deltas, executes via bridge, loops, and threads results back', async () => {
        const openai = fakeOpenai([
            [
                { tool: { index: 0, id: 'call_1', name: 'mission_list' } },
                { tool: { index: 0, args: '{"a"' } },
                { tool: { index: 0, args: ':1}' } },
            ],
            [{ content: 'Done!' }],
        ])
        const events = []
        await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], openai, bridge, model: 'm', onEvent: (e) => events.push(e) })
        expect(events).toEqual([
            { type: 'tool_call', id: 'call_1', name: 'mission_list', args: { a: 1 } },
            { type: 'tool_result', id: 'call_1', name: 'mission_list', result: '{"ran":"mission_list"}', isError: false },
            { type: 'text', delta: 'Done!' },
            { type: 'done' },
        ])
        expect(bridge.callTool).toHaveBeenCalledWith('mission_list', { a: 1 })
        const second = openai.seen[1].messages
        expect(second.at(-2).tool_calls[0]).toEqual({
            id: 'call_1', type: 'function', function: { name: 'mission_list', arguments: '{"a":1}' },
        })
        expect(second.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ran":"mission_list"}' })
    })

    it('stops after maxIterations tool rounds with a final summarize turn', async () => {
        const toolRound = [
            { tool: { index: 0, id: 'call_x', name: 'mission_list', args: '{}' } },
        ]
        const openai = fakeOpenai([toolRound, toolRound, [{ content: 'Summary.' }]])
        const events = []
        await runAgentLoop({
            messages: [{ role: 'user', content: 'go' }], openai, bridge, model: 'm',
            onEvent: (e) => events.push(e), maxIterations: 2,
        })
        expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(2)
        expect(events.at(-2)).toEqual({ type: 'text', delta: 'Summary.' })
        expect(events.at(-1)).toEqual({ type: 'done' })
        // The forced final call must disable tools
        expect(openai.seen[2].tools).toBeUndefined()
    })

    it('passes unparseable tool arguments to the bridge as an empty object with an error result', async () => {
        const openai = fakeOpenai([
            [{ tool: { index: 0, id: 'call_b', name: 'mission_list', args: '{not json' } }],
            [{ content: 'ok' }],
        ])
        const events = []
        await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], openai, bridge, model: 'm', onEvent: (e) => events.push(e) })
        const result = events.find((e) => e.type === 'tool_result')
        expect(result.isError).toBe(true)
        expect(result.result).toContain('Invalid JSON arguments')
    })
})
