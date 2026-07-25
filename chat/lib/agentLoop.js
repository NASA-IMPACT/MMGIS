export const SYSTEM_PROMPT = `You are an assistant that builds and drives MMGIS dashboards through tools.

Workflow guidance:
- Before generating a dashboard, call dashboard_profile_schema (input shape + layer examples) and dashboard_tool_options (valid tool names).
- Find data layers with catalog_collections / catalog_search, and convert items with catalog_item_to_layer.
- Mission names must avoid punctuation (letters, numbers, spaces, underscores are safe).
- After dashboard_generate or dashboard_create_from_config succeeds, ALWAYS give the user the mission URL.
- When the user wants to see or edit the raw config, call dashboard_generate with returnConfig: true and show the JSON.
- When the user provides config JSON, install it with dashboard_create_from_config.
- Use view_* tools to drive a browser session that has the mission open (view_get_state first if unsure).
- Tool errors include a "hint" — follow it to self-correct. If you cannot recover, tell the user the error and hint plainly.
- Editing existing dashboards: prefer layer_add/layer_update/layer_remove and tool_toggle (these apply LIVE in open sessions). For anything else use mission_update_config with a JSON merge-patch (null deletes a key; arrays replace) — then call view_reload so an open session shows the change.
- DESTRUCTIVE tools (mission_delete, geodataset_delete, user_create, user_set_permission) return needsConfirmation first. Show the user exactly what will happen, get their explicit yes, then retry with confirm: true. Never set confirm on your own.
- Geodata: ingest GeoJSON with geodataset_ingest (inline for small data, url for hosted files), then add a layer with type "vector" and url "geodatasets:<name>".
- User management: new users start as Viewer (001); promote with user_set_permission (110 Admin / 001 Viewer; SuperAdmin cannot be granted). Never repeat passwords back.
- Be concise. Never invent tool results.`

export async function runAgentLoop({ messages, openai, bridge, model, onEvent, maxIterations = 15 }) {
    const tools = await bridge.getOpenAiTools()
    const convo = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]

    for (let i = 0; i < maxIterations; i++) {
        const { text, toolCalls } = await streamOneTurn({ openai, model, messages: convo, tools, onEvent })
        if (toolCalls.length === 0) {
            onEvent({ type: 'done' })
            return
        }
        convo.push({
            role: 'assistant',
            content: text || null,
            tool_calls: toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.args },
            })),
        })
        for (const c of toolCalls) {
            let parsed = null
            try {
                parsed = c.args ? JSON.parse(c.args) : {}
            } catch {
                parsed = null
            }
            onEvent({ type: 'tool_call', id: c.id, name: c.name, args: parsed ?? {} })
            const result =
                parsed === null
                    ? { text: JSON.stringify({ error: `Invalid JSON arguments: ${c.args}` }), isError: true }
                    : await bridge.callTool(c.name, parsed)
            onEvent({ type: 'tool_result', id: c.id, name: c.name, result: result.text, isError: result.isError })
            convo.push({ role: 'tool', tool_call_id: c.id, content: result.text })
        }
    }

    // Loop guard: force a final, tool-free summary
    convo.push({ role: 'user', content: 'Tool budget exhausted — summarize what you did and stop.' })
    await streamOneTurn({ openai, model, messages: convo, onEvent })
    onEvent({ type: 'done' })
}

async function streamOneTurn({ openai, model, messages, tools, onEvent }) {
    const stream = await openai.chat.completions.create({
        model,
        messages,
        stream: true,
        ...(tools ? { tools } : {}),
    })
    let text = ''
    const toolCalls = []
    for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
            text += delta.content
            onEvent({ type: 'text', delta: delta.content })
        }
        for (const tc of delta.tool_calls || []) {
            const slot = (toolCalls[tc.index] ??= { id: '', name: '', args: '' })
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) slot.name += tc.function.name
            if (tc.function?.arguments) slot.args += tc.function.arguments
        }
    }
    return { text, toolCalls: toolCalls.filter(Boolean) }
}
