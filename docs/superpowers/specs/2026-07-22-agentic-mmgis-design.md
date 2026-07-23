# Agentic MMGIS — Design

**Date:** 2026-07-22
**Status:** Approved by stakeholder (brainstorming session)
**Branch:** `feature/agentic-mmgis`

## Purpose

Let AI agents drive MMGIS and let users build MMGIS dashboards — and eventually
plugins — from natural language. Three capabilities, built in phases on one
umbrella architecture:

1. **Drive MMGIS via an agent** — backend administration (missions, layers,
   geodatasets) plus live control of the map in a connected browser session.
2. **NL → dashboard setup** — a user describes a dashboard ("air-quality
   dashboard for the southeastern US"); the agent finds data, authors a mission
   profile, and generates the mission config.
3. **NL → plugin creation** — the agent scaffolds complete new plugins from a
   description; hot-reload on dev instances, PR review to reach shared
   deployments.

## Decisions Made

| Question | Decision |
| --- | --- |
| Scope | All three capabilities, phased, one umbrella architecture |
| Agent surface | MCP server first; in-app chat can be layered on later reusing the same tools |
| Drive scope | Backend/config plane AND live browser control |
| Data sourcing for generated dashboards | Deployment-local geodatasets/layers first, plus external catalog search (STAC, NASA CMR) |
| Generated-plugin trust model | No sandbox. Hot-reload live on dev-mode instances (requester's own instance); promotion to shared deployments only via normal git/PR review |
| Milestone 1 | End-to-end NL dashboard demo touching all three subsystems shallowly |
| Integration approach | Approach A: standalone MCP server + WebSocket agent bridge (vs. embedding MCP in the Express backend, or driving via browser automation) |

**Why Approach A:** it obeys the vision's decoupling principle (the agent
surface is an external service, not more monolith), the browser bridge dogfoods
the Plugin-Components system (spec 011), and every piece — REST client, bridge,
generators — is independently testable. The same MCP tools later power an
in-app chat client.

## Architecture

```
┌─────────────────┐   MCP (stdio / HTTP)   ┌──────────────────────┐
│  Claude Code /   │◄──────────────────────►│   mcp/  (new pkg)    │
│  Desktop / any   │                        │  MMGIS MCP Server    │
│  MCP client      │                        └──────┬───────┬───────┘
└─────────────────┘                          REST  │       │ WebSocket
                                             +token│       │ "agent-bridge" room
                                          ┌────────▼───┐ ┌─▼──────────────────┐
                                          │ MMGIS API  │ │ MMGIS frontend      │
                                          │ (Express)  │ │ AgentBridge         │
                                          └────────────┘ │ Plugin-Component    │
                                                         └────────────────────┘
```

New surface area:

- **`mcp/`** — standalone TypeScript MCP server (own `package.json`,
  `@modelcontextprotocol/sdk`). Transports: stdio (Claude Code/Desktop) and
  streamable HTTP (remote clients). Configured with `MMGIS_URL` +
  `MMGIS_TOKEN`. Runs beside any MMGIS deployment.
- **`AgentBridge` Plugin-Component** in `src/essence/` — subscribes to a new
  `agent-bridge` WebSocket message type, executes whitelisted view commands,
  reports results and view state.
- **Backend WebSocket routing** — one new `agent-bridge` case in
  `API/Backend/APIs/Websocket.js`, mirroring the existing Draw-sync broadcast
  pattern (authenticate → validate payload → relay within mission room →
  rate-limit).

## Phases

- **Phase 1 — Drive + NL dashboard (milestone demo).** MCP tools for
  missions/layers/geodatasets CRUD; dashboard generation via
  `scripts/generate-mission-config.js`; STAC/CMR catalog search; ~5 browser
  commands (`fly_to`, `toggle_layer`, `open_tool`, `set_time`,
  `get_view_state`). Demo: "set up an air-quality dashboard for the
  southeastern US" → mission appears → agent flies the map to it.
- **Phase 2 — Deep control + ingestion.** Richer browser control (draw, query,
  screenshots for agent vision), data upload/ingestion tools, multi-session
  targeting.
- **Phase 3 — NL plugin generation.** `plugin_scaffold` emits complete
  Tool/Component plugins from templates; hot-reload on dev instances;
  `plugin_promote` opens a branch/PR for shared deployments.

Each phase ships independently; nothing in Phase 1 blocks on Phase 3
decisions.

## Components

### 1. MCP server (`mcp/`) — four tool namespaces

- **Admin plane** (`mission_*`, `layer_*`, `geodataset_*`): thin, validated
  wrappers over the existing REST API (the endpoints Configure already calls).
  No new backend endpoints in Phase 1.
- **Dashboard generation** (`dashboard_*`): `dashboard_generate(profile)`
  validates a mission-profile JSON (the `mission-profiles/*.json` format), runs
  the config generator, and installs the result as a mission. The natural
  language work deliberately lives in the **client LLM, not our code**: tool
  descriptions plus a `get_profile_schema` tool teach the model to author a
  profile from the user's description. The server ships deterministic,
  LLM-free, testable tools.
- **Catalog search** (`catalog_*`): `search_stac(query, bbox, datetime)` and
  `search_cmr(...)` against configurable public endpoints, returning candidate
  layers in a shape that plugs directly into a profile's layer list (tile URL
  templates, GeoJSON assets). External services stay external — pure URL/API
  integration, per the vision.
- **Browser control** (`view_*`): publish commands onto the agent bridge and
  await acknowledgment.

### 2. AgentBridge Plugin-Component

A small component (`init()` only, per spec 011) that joins the `agent-bridge`
room for its mission. It executes a fixed whitelist of commands against
internal APIs (`Map_`, `L_`, `ToolController_`) — never evaluates payload code
— and answers each command with `{ok/error, viewState}`. It announces session
presence so the MCP server can report connected browsers per mission.

### 3. WebSocket routing (backend)

New `agent-bridge` message type in `Websocket.js` following the Draw pattern:
authenticate, validate message shape, relay between MCP server connections and
browser sessions in the same mission room, rate-limited (constitution VII).

### 4. Plugin generator (Phase 3)

`plugin_scaffold(spec)` renders a complete plugin directory from templates
(existing Tool/Component skeletons + SDK conventions) including `config.json`,
entry module, and a smoke test. Dev-mode webpack hot-reload picks it up live;
`plugin_promote` creates a branch + commit for PR review. Templates are code we
write and test once; the agent only fills declared slots.

## Milestone Data Flow

1. Claude calls `catalog_search` → candidate datasets with tile/asset URLs.
2. Claude authors a mission profile (guided by `get_profile_schema` and tool
   docs) → `dashboard_generate` validates it, runs the config generator,
   creates/updates the mission via REST.
3. Claude calls `view_fly_to` / `view_toggle_layer` → MCP server publishes to
   the `agent-bridge` room → AgentBridge executes → ack + fresh view state
   returns to the model.

## Error Handling

- Every MCP tool returns structured errors (`{error, detail, hint}`) — never
  stack traces — so the model can self-correct (e.g., "profile invalid: layer 3
  missing `url`").
- Profile validation happens before any mission is touched; generation is
  atomic (write to temp, install on success).
- Browser commands time out (5s); "no connected sessions" is distinguished from
  "command failed".
- Catalog searches degrade gracefully: endpoint down → tool reports it and
  suggests deployment-local data.

## Security

- MCP server authenticates to MMGIS with a long-lived API token (existing token
  support in `User.js`); it holds the privileges of the issuing account.
- The agent bridge carries only whitelisted command names + JSON args; the
  frontend component validates against a schema before executing. No code, no
  selectors, no eval.
- WebSocket messages authenticated and rate-limited per constitution VII.
- Generated plugins: hot-reload only on dev-mode instances; shared deployments
  only via reviewed PRs. A sandboxed plugin runtime is explicitly out of scope
  and only reconsidered if an unreviewed third-party marketplace install flow
  is ever wanted.

## Testing

- **Unit (Jest, existing setup):** each MCP tool against a mocked REST API;
  profile validation; bridge command schema validation; plugin template
  rendering.
- **Integration:** MCP server against a real dev deployment (the
  `mmgis-deployment` skill's docker setup) — create mission, generate
  dashboard, assert config in DB.
- **E2E (Playwright; CI workflow exists):** connect a browser, send
  `view_fly_to` through the real bridge, assert the map moved.
- **Coverage target:** 80% per constitution.

## Out of Scope / Non-Goals

- In-app chat UI (future; will reuse these MCP tools).
- Sandboxed plugin runtime.
- Operating external data services (STAC/CMR/TiTiler) — integration only.
- Unreviewed plugin installation into shared/production deployments.
