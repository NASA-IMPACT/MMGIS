# MMGIS Chat UI

A standalone chat app for driving MMGIS with your own OpenAI key: describe a
dashboard, watch the MCP tools fire, open the result, and steer the live map —
all from a browser chat.

## Quickstart

1. Build the MCP server once: `cd ../mcp && npm install && npm run build`
2. `cd chat && npm install`
3. `cp .env.example .env` and set `OPENAI_API_KEY`, `MMGIS_URL`, `MMGIS_TOKEN`
   (mint a token per `../mcp/README.md`).
4. `npm start` → open http://localhost:8895

## What you can do

- "Create an air quality dashboard over Atlanta" → watch `catalog_*` +
  `dashboard_generate` fire; click "Open dashboard →".
- "Show me the config JSON for that dashboard" → the model calls
  `dashboard_generate` with `returnConfig: true`; copy the JSON from the tool card.
- **JSON config** drawer → paste/edit config JSON, name it, "Create dashboard
  from JSON" (runs `dashboard_create_from_config` through the agent, visibly).
- With a dashboard open in another tab: "fly the map to Huntsville" (`view_*`
  tools drive that session over the MMGIS websocket).

## How it works

Browser (static page, SSE) → `server.js` (Express; your key stays here) →
OpenAI function calling → MCP client over stdio → `../mcp/dist/index.js` →
MMGIS REST + websocket. Conversation state lives in your browser
(localStorage); the server is stateless.

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | (required) | Server-side only |
| `OPENAI_MODEL` | `gpt-4o` | Chat model |
| `CHAT_PORT` | `8895` | UI port |
| `MCP_COMMAND` / `MCP_ARGS` | `node` / `../mcp/dist/index.js` | MCP server launch (paths relative to `chat/`) |
| `MMGIS_URL`, `MMGIS_TOKEN`, `MAPBOX_TOKEN`, ... | — | Passed through to the MCP server |

## Known limitations

- Cross-turn memory only replays user/assistant text — tool results are not
  persisted between turns. If you need the model to recall a config from
  earlier in the conversation, ask it to echo the config back rather than
  relying on it to remember the raw tool output.
- Very large configs may not round-trip faithfully through the JSON drawer
  (the model can hit output length limits when repeating them back).

## Manual E2E checklist

- [ ] `/api/health` shows the model and `MCP connected` with 14 tools
- [ ] Simple prompt streams a text reply
- [ ] Dashboard request shows tool cards and an "Open dashboard →" button that loads in MMGIS
- [ ] "show me the config JSON" returns the full config in a tool card
- [ ] JSON drawer creates a mission from pasted (edited) config
- [ ] `view_fly_to` request visibly moves an open dashboard's map
- [ ] Bad OpenAI key shows a red error bubble, conversation survives a retry
