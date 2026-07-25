# MMGIS MCP Server

Lets AI agents (any MCP client — Claude Code, Claude Desktop, ...) drive MMGIS:
administer missions, generate dashboards from natural language, search STAC
catalogs for data layers, and control a live browser session.

## Setup

1. `cd mcp && npm install && npm run build`
2. In the MMGIS `.env`, set `ENABLE_MMGIS_WEBSOCKETS=true` (needed for
   browser control) and start MMGIS (`npm start`).
3. Mint a long-term API token (must be done with an admin **session** — tokens
   cannot mint tokens). Log into MMGIS as an admin in a browser, then run in
   the devtools console:

   ```js
   fetch('/api/longtermtoken/generate', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ name: 'mcp', period: 'never' }),
   }).then((r) => r.json()).then(console.log)
   ```

   Copy `body.token`. The token inherits your permission (create missions
   requires a SuperAdmin's token).
4. `export MMGIS_TOKEN=<token>` — the repo `.mcp.json` picks it up, or
   register manually: `claude mcp add mmgis -- node mcp/dist/index.js`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MMGIS_URL` | `http://localhost:8888` | MMGIS base URL (include ROOT_PATH if set) |
| `MMGIS_TOKEN` | (required) | Long-term token, sent as `Authorization: Bearer ...` |
| `MMGIS_WS_URL` | derived from `MMGIS_URL` | Websocket endpoint (`ws://host:port/`) |
| `MMGIS_REPO_ROOT` | auto (this checkout) | MMGIS repo containing `scripts/generate-mission-config.js` |
| `MAPBOX_TOKEN` | empty | Substituted into generated configs' basemap |
| `STAC_CATALOGS` | veda + earth-search | JSON object `{name: stacApiUrl}` |
| `TITILER_URL` | `https://titiler.xyz` | TiTiler used for `catalog_item_to_layer` tile URLs |

## Tools

- `mission_list`, `mission_get` — admin plane
- `dashboard_profile_schema`, `dashboard_tool_options`, `dashboard_generate` (supports `returnConfig` to get the full config JSON back), `dashboard_create_from_config` (install a dashboard from raw config JSON) — NL → dashboard
- `catalog_collections`, `catalog_search`, `catalog_item_to_layer` — STAC data discovery
- `view_fly_to`, `view_toggle_layer`, `view_open_tool`, `view_set_time`, `view_get_state` — live browser control (requires an open browser session on the mission; `dashboard_generate` enables the AgentBridge component automatically)
- `mission_update_config`, `layer_add`, `layer_update`, `layer_remove`, `tool_toggle` — live config editing (in modern mode, the AgentBridge component auto-reloads open sessions on config changes; classic mode applies via MMGIS's native update flow; `view_reload` remains a manual fallback)
- `mission_clone`, `mission_delete`†, `geodataset_list`, `geodataset_ingest`, `geodataset_delete`†, `user_list`, `user_create`†, `user_set_permission`† — admin operations († = requires `confirm: true` after a preview)
- `view_reload` — reload an open session to apply non-layer config changes

## Demo (end-to-end)

Ask your MCP client:

> Set up an MMGIS dashboard called "Air Quality Atlanta" showing NO2 data
> over the southeastern US, then fly the view to Atlanta.

Expected flow: `catalog_collections`(keyword no2) → `catalog_search` →
`catalog_item_to_layer` → `dashboard_generate` → open the returned URL in a
browser → `view_fly_to`.

## Manual E2E checklist

- [ ] `mission_list` returns the deployment's missions
- [ ] `dashboard_generate` creates a mission that loads in the browser
- [ ] With the mission open in a browser: `view_get_state` returns the mission name
- [ ] `view_fly_to` visibly moves the map
- [ ] `view_toggle_layer` flips a layer on/off (check LayerManager)
- [ ] `view_open_tool` opens a tool panel in both classic missions (exclusive
      `ToolController_` panel) and modern missions (`msv.mode: "modern"`,
      shown/loaded via `window.mmgisAPI`); an unknown tool name returns
      `ok: false` rather than a false success
- [ ] `view_*` with no browser open returns the "No browser session" hint

## Security notes

- Bridge commands are view-only and whitelist-validated in the browser
  (`src/essence/MMGIS-Plugin-Components/AgentBridge/commands.js`).
- The MMGIS websocket relay (`API/websocket.js`) is a single unauthenticated
  broadcast: it forwards every frame to every connected client, with no
  per-mission routing at the relay layer. Mission scoping happens only
  client-side (the browser and `BridgeClient` both drop frames whose
  `body.mission` doesn't match). Practically, this means **any** websocket
  peer on the relay can both issue view commands for *any* mission and read
  every mission's view-state acks (mission name, layer visibility, current
  time) — restrict who can reach the relay accordingly; do not expose it
  publicly on deployments where that matters (Phase 2 hardening candidate).
- If more than one browser session has the same mission open, all of them
  receive and execute every command for that mission; `BridgeClient` resolves
  on whichever session's ack arrives first and ignores the rest.
- Each AgentBridge session also broadcasts a `{kind: 'presence', sessionId}`
  frame on connect. Nothing currently consumes it server- or MCP-side — it's
  reserved for a future session-listing tool (Phase 2).
- Same relay-hardening caveat family: because the relay is unauthenticated
  and forwards every frame, any websocket peer can forge a
  `{forceClientUpdate, info, body}` config-mutation frame and force-reload
  every open **modern**-mode session of any mission (AgentBridge treats it as
  a legitimate save broadcast) — restrict relay access accordingly (Phase 2
  hardening candidate).
- `/api/configure/clone` and `/destroy` have no per-permission check upstream — ANY valid long-term token can invoke them (pre-existing MMGIS behavior); scope who gets tokens accordingly. `mission_clone` shells out to a `python` binary on the MMGIS server; hosts with only `python3` will see clone failures.
- `/api/accounts/entries` and `/api/accounts/update` are likewise reachable
  by ANY valid long-term token (pre-existing MMGIS permission-less token
  path, not something this MCP server adds) — so any token holder can list
  every user account and change permissions via `user_list` /
  `user_set_permission`'s underlying endpoints. Scope token issuance
  accordingly; a token is effectively as powerful as an admin session for
  these routes.
