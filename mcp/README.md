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
- `dashboard_profile_schema`, `dashboard_tool_options`, `dashboard_generate` — NL → dashboard
- `catalog_collections`, `catalog_search`, `catalog_item_to_layer` — STAC data discovery
- `view_fly_to`, `view_toggle_layer`, `view_open_tool`, `view_set_time`, `view_get_state` — live browser control (requires an open browser session on the mission; `dashboard_generate` enables the AgentBridge component automatically)

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
- [ ] `view_open_tool` opens a tool panel (if not: wire `ToolControllerModern_` — see Task 7 note)
- [ ] `view_*` with no browser open returns the "No browser session" hint

## Security notes

- Bridge commands are view-only and whitelist-validated in the browser
  (`src/essence/MMGIS-Plugin-Components/AgentBridge/commands.js`).
- The MMGIS websocket relay is unauthenticated upstream; do not expose it
  publicly on deployments where that matters (Phase 2 hardening candidate).
