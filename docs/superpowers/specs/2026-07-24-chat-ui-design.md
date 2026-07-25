# MMGIS Chat UI — Design

**Date:** 2026-07-24
**Status:** Approved approach (A) by stakeholder; spec pending review
**Branch:** `feature/agentic-mmgis`
**Purpose:** A standalone chat web app the stakeholder uses to *visually test* the
agentic MMGIS capabilities with their own OpenAI key — type a request, watch the
MCP tools fire, open the resulting dashboard, and see live view control.

## Decisions Made

| Question | Decision |
| --- | --- |
| Placement | Standalone page (own port), opened beside the MMGIS tab — not embedded in MMGIS yet |
| Location | Self-contained `chat/` folder in this repo, with its own `package.json` and `.env`; designed to be lifted out later as its own deployable |
| OpenAI key | Lives in `chat/.env` (`OPENAI_API_KEY`), server-side only, gitignored; `.env.example` committed |
| Tool execution | Approach A: the chat backend is an **MCP client** of the existing `mcp/dist/index.js` over stdio — same 13 tools, auto-discovered, zero duplicated logic |
| Frontend | Single static page (vanilla HTML/CSS/JS, no build step), SSE streaming |
| Primary user | The stakeholder testing the feature; demo-grade polish, not production chat |

## Architecture

```
Browser (chat UI, static)          chat/ server (Express, Node 20)         mcp/dist/index.js
┌──────────────────────┐  SSE   ┌──────────────────────────────┐  stdio  ┌──────────────┐
│ conversation state    │◄──────│ POST /api/chat                │◄───────►│ MMGIS MCP    │
│ tool-call cards       │──────►│  agent loop: OpenAI chat      │  MCP    │ server       │
│ "Open dashboard →"    │ fetch │  completions + function calls │         │ (13 tools)   │
└──────────────────────┘        │ GET /api/health, /api/tools   │         └──────┬───────┘
                                └──────────────┬───────────────┘                │ REST+WS
                                        OpenAI API (key from .env)          MMGIS server
```

- The chat server spawns the MCP server once at startup (`StdioClientTransport`,
  command/env configurable) and keeps the client connected; `listTools()` output is
  converted to OpenAI function schemas (name, description, JSON-schema parameters —
  the MCP SDK already serializes zod shapes to JSON schema).
- Conversation state lives entirely in the browser (a `messages` array resent per
  request). The server is stateless per request — no sessions, no DB.

## Components

### `chat/server.js` — Express app
- `GET /` serves `public/`.
- `GET /api/health` → `{ok, model, mcpConnected, toolCount}`.
- `GET /api/tools` → the discovered tool list (names + descriptions) so the UI can
  render a capabilities sidebar.
- `POST /api/chat` body `{messages: [...]}` → SSE stream of events (below). Runs the
  agent loop: call OpenAI with tools; on `tool_calls`, execute each via the MCP
  client, append tool results, loop (max 15 iterations as a runaway guard); stream
  assistant text deltas as they arrive.

### `chat/lib/mcpBridge.js`
- `connect(config)` → spawns/attaches the MCP client; `getOpenAiTools()` → cached
  OpenAI `tools` array; `callTool(name, args)` → `{text, isError}`.
- Isolated so tests can inject a fake bridge.

### `chat/lib/agentLoop.js`
- `runAgentLoop({messages, openai, bridge, model, onEvent})` — pure orchestration,
  no Express/SSE knowledge; emits events via `onEvent`. Unit-testable with mocked
  OpenAI + bridge.

### `chat/public/` — the UI
- `index.html`, `app.js`, `style.css`. Chat transcript; streaming assistant text;
  each tool call rendered as a collapsible card (name, args, result JSON, error
  styling for `isError`); any `url` field in a successful tool result becomes an
  "Open dashboard →" button (`target="_blank"`); status strip showing model +
  MCP connection from `/api/health`; conversation kept in `localStorage` so a
  reload doesn't lose it; "New chat" button clears it.

### SSE event protocol (one `data:` JSON per event)
- `{type: 'text', delta}` — assistant token(s)
- `{type: 'tool_call', id, name, args}` — model requested a tool
- `{type: 'tool_result', id, name, result, isError}` — bridge answered
- `{type: 'done', usage?}` — turn complete
- `{type: 'error', message}` — fatal turn error (OpenAI/bridge failure)

### System prompt (server-side constant)
Teaches the workflow: call `dashboard_profile_schema` + `dashboard_tool_options`
before generating; find data via `catalog_*`; always report the mission URL after
`dashboard_generate`; use `view_*` to drive an open browser session; mission names
must avoid punctuation; surface tool `hint`s to the user when self-correction fails.

## Configuration (`chat/.env`)

| Var | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | (required) | The stakeholder's key; never sent to the browser |
| `OPENAI_MODEL` | `gpt-4o` | Chat model |
| `CHAT_PORT` | `8895` | Chat app port |
| `MCP_COMMAND` | `node` | MCP server launcher |
| `MCP_ARGS` | `../mcp/dist/index.js` | Relative to `chat/` |
| `MMGIS_URL` / `MMGIS_TOKEN` / `MAPBOX_TOKEN` etc. | — | Passed through into the MCP server's env |

`chat/.gitignore` covers `.env` and `node_modules/`; `chat/.env.example` documents
every var. Root `.gitignore` needs no change (chat/.env handled locally).

## Error Handling

- OpenAI failure (bad key, rate limit) → SSE `error` event → red bubble in chat with
  the OpenAI message; conversation preserved so the user can retry.
- MCP tool errors are already `{error, hint}` content — passed through as normal
  `tool_result`s (with `isError`) so the model self-corrects visibly in the
  transcript; the card renders red.
- MCP process death → bridge reports disconnected on `/api/health`; `/api/chat`
  returns an `error` event advising restart; server attempts one reconnect per
  request.
- Loop guard: after 15 tool iterations the server injects a final "stop and
  summarize" turn and closes the stream.

## Testing

- **Unit (vitest, `chat/tests/`)**: `agentLoop` with a scripted fake OpenAI client
  (returns tool_calls then text) + fake bridge — asserts event sequence, loop guard,
  error paths. `mcpBridge` schema conversion with a fake MCP client.
- **Manual E2E**: real key + running MMGIS deployment; script mirrors the existing
  demo — "create an air-quality dashboard over Atlanta", open URL, "fly to
  Huntsville", watch the open dashboard move.

## Non-Goals

- Not embedded in MMGIS (future: same agent loop behind an in-app panel).
- No auth/multi-user/persistence beyond localStorage; single-operator test harness.
- No Anthropic/other-provider support in v1 (env-swappable later; loop is
  provider-thin by design).
- No streaming of tool *results* token-by-token — results arrive whole.
