# Detailed implementation plan: AWS deployment & admin/dashboard split

> Companion to `adr.md`. This document is **not for human reading start-to-finish**.
> It is the dense detail layer the ADR depends on. Its purpose is to (a) ground every
> claim in the ADR in concrete code, (b) give a downstream LLM a high-resolution map
> to either execute or review, and (c) surface contradictions back to the ADR.
>
> If you find this document contradicts the ADR, **the ADR wins** and this plan
> gets the correction. If you find this document contradicts the code, **the code
> wins** and the ADR may need rework.
>
> **Code references use files and function names. No line numbers.** Line numbers
> rot every time someone else lands a change.

## 0. How to read this document

The plan is split into phases. Phases are ordered for execution but reviewable
out of order:

- **Phase A — Code preparation.** No behavioral change. Introduces helpers and
  flags that later phases use.
- **Phase B — Adjacent-service URL indirection.** Mechanical call-site rewrite.
  Admin behavior unchanged because the helper returns same-origin paths today.
- **Phase C — Boot-time config injection.** Replaces the boot fetch with a
  baked import when `STATIC_MODE=true`.
- **Phase D — Static build pipeline.** New script + Webpack branches.
- **Phase E — Feature gating in static.** Per-tool drop / degrade behavior.
- **Phase F — Mission asset S3 migration.** Both admin (middleware fetches from
  S3) and dashboards (bake step rewrites relative paths to absolute).
- **Phase G — Adjacent services on ECS.** Container images, task defs, ALB target
  groups, CORS.
- **Phase H — Provisioning code.** The Publish-button → S3+CloudFront flow.
- **Phase I — Dashboard registry.** New table + endpoints + UI surface.
- **Phase J — Deploy-time gaps.** First-user gap closure, CloudFront Function
  password gate.

Within each phase: **Goal**, **Files touched**, **Specific changes**, **Verification**,
**Rollback**.

## Source-of-truth code references

These are the load-bearing files the plan keeps coming back to. Verified during
research; cite the path, not a line range, when reasoning about behavior.

### Backend

- `scripts/server.js` — composition root. Express assembly, session config,
  helmet, CSP, body parser ordering, `cssoHandler` middleware definition, ALB
  health endpoint registration, WebSocket attachment, sidecar proxy mount, ROOT_PATH
  prefix handling.
- `scripts/init-db.js` — Postgres bootstrap. Creates `mmgis` and `mmgis-stac`
  databases; installs `postgis`, `btree_gist`, `pgstac` extensions; creates the
  session table and indexes.
- `scripts/build.js` — production frontend build entrypoint. Imports
  `configFactory("production")` from `configuration/webpack.config.js`, runs
  `updateTools()` and `updateComponents()` from `API/updateTools.js` before
  Webpack, then drives the build.
- `scripts/middleware.js` — `missions()` function. Static-file serving for
  `/Missions/...` with path-traversal hardening and `_time_` composite handling
  via `sharp`. The S3 migration in Phase F lives here.
- `API/setups.js` — feature-module loader. Iterates `API/Backend/<Feature>/`
  directories and any `*Plugin-Backend*` / `*Private-Backend*` siblings, invoking
  each module's `setup.js`.
- `API/connection.js` — Sequelize connection. Single shared instance.
- `API/database.js` — pg-promise connection. Used only by Draw.
- `API/websocket.js` — WebSocket server. `ws.Server({ noServer: true })` attached
  to HTTP upgrade. No rooms; broadcast bus.
- `API/updateTools.js` — `updateTools()` and `updateComponents()` codegen.
  Writes `src/pre/tools.js`, `src/pre/components.js`, `configure/public/toolConfigs.json`,
  `configure/public/componentConfigs.json`. The Phase C extension hooks here.
- `API/Backend/Users/models/user.js` — user model, bcrypt password hashing,
  permission code field, missions_managing array.
- `API/Backend/Users/routes/users.js` — `first_signup`, `login`, `logout`,
  `signup` handlers. The first-user-becomes-superadmin logic lives in `first_signup`.
- `API/Backend/Accounts/routes/accounts.js` — `/api/accounts/*`, account CRUD,
  permission update.
- `API/Backend/Config/routes/configs.js` — `/api/configure/*`. The
  `get_generaloptions`, `missions`, `get` endpoints feed the boot path.
  `checkMissionPermission` checks per-user `missions_managing` against the
  requested mission.
- `API/Backend/Datasets/routes/datasets.js` — `/api/datasets/upload`. Streams
  CSV in 10000-row chunks (`maxRowsAtATime`), disables timeout
  (`req.setTimeout(0)`).
- `API/Backend/Geodatasets/routes/geodatasets.js` — `/api/geodatasets/upload`.
  Streams GeoJSON to PostGIS dynamic tables.
- `API/Backend/Draw/routes/files.js`, `API/Backend/Draw/routes/filesutils.js`
  — `user_features`, `user_files` tables, owner + public='1' visibility logic.
- `adjacent-servers/adjacent-servers-proxy.js` — `http-proxy-middleware`
  mounting `/stac`, `/tipg`, `/titiler`, `/titilerpgstac`, `/veloserver`.
  Each block wrapped in `ensureAdmin(false, false, true)` — anon GETs pass,
  mutations admin-gated. `isDocker` swaps `localhost`/Compose-service-name.
  `createSwaggerInterceptor` rewrites upstream OpenAPI docs.
- `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.db.yml` —
  service inventory, profile flags (`--profile stac`, `--profile veloserver`).
- `sample.env` — canonical list of MMGIS env vars including `AUTH`, the
  `WITH_*` flags, `ADJACENT_SERVER_CUSTOM_<N>`.

### Frontend

- `src/index.js` — React root render. Mounts `App` into DOM.
- `src/App.js` — boot path. Has 4 `calls.api` calls total: `get_generaloptions` and `missions` are the two config-related ones; the other two are `shortener_expand` (only fire on `?s=…` shortened URLs). Note: the mission-config fetch (`calls.api('get', { mission })`) does **not** live in App.js — it lives in `essence.js` and `LandingPage.js` (see below).
- `src/pre/calls.js` — **single chokepoint** for every named API call in the Essence bundle. Holds the `c[]` table mapping ~30 named endpoints to URL paths. The `api()` function already has a dormant `SERVER != 'node'` escape branch (today: warns + calls error). The static-mode refactor hooks here.
- `src/pre/tools.js`, `src/pre/components.js` — codegen output, gitignored,
  re-imported by the bundle.
- `src/essence/essence.js` — `essence.init(configData, missionsList)`. Calls `L_.init(configData, ...)`. Has 2 `calls.api('get', { mission })` sites (`makeMission` and `swapMission` paths). Injects `_dbMissionName` into `configData` from API response.
- `src/essence/Basics/Layers_/Layers_.js` — `L_` global singleton. `L_.init`
  calls `parseConfig(configData)` to populate `L_.data`, `L_.dataFlat`,
  `L_.layer`, `L_.on`, `L_.opacity`, `L_.filters`, `L_.nameToUUID`. Holds
  `L_.missionPath`, `L_.missionFolderName`. Defines `L_.onceLoaded(cb)`. **Has hardcoded same-origin sidecar URL construction** (one of the four files for Phase B). Also contains the `getSTACLayers` recursion that the bake step must mirror.
- `src/essence/Basics/Map_/Map_.js` — Leaflet + deck.gl glue. **Has hardcoded same-origin sidecar URL construction** (one of the four files for Phase B).
- `src/essence/Basics/Globe_/Globe_.js`, `GlobeRenderer.js` — Cesium glue. **Verified: does NOT construct sidecar URLs directly.** Consumes layer configs from `L_`. Listed here only to note that earlier draft of this plan wrongly included it in the Phase B inventory.
- `src/essence/Basics/MapEngines/IMapEngine.ts`, `MapEngineRegistry.ts` —
  the engine abstraction the dual 2D/3D rendering goes through.
- `src/essence/Tools/Identifier/IdentifierTool.js` — point queries to `/titilerpgstac/collections/…` and `/titiler/cog/point/…`. **Has hardcoded same-origin sidecar URL construction** (one of the four files for Phase B). Also calls `calls.api('getbands', …)` — this hits the **backend** route `/api/utils/getbands`, NOT a sidecar; covered as a backend-route-disappearance, not a URL-helper rewrite.
- `src/essence/Tools/Layers/LayersTool.js` — vector tile, STAC, tipg. **Has hardcoded same-origin sidecar URL construction** (one of the four files for Phase B). Also calls `calls.api('proj42wkt', …)` — backend route `/api/utils/proj42wkt`, NOT in the adjacent-servers proxy.
- `src/essence/Tools/Draw/` — drawing tool. WebSocket + REST writes against
  `/api/draw/*`.
- `src/essence/Tools/Measure/MeasureTool.js` — elevation profile uses `calls.api('getprofile', …)`. **Verified: not a direct TiTiler URL** — `getprofile` is the backend route `/api/utils/getprofile`, which internally may delegate to TiTiler. In static, the backend route disappears; the feature needs a per-disposition decision (call TiTiler directly cross-origin, replace with client-side computation over baked DEM tiles, or hide).
- `src/essence/Ancillary/Search.js` — server-side search UI. Calls into `/api/datasets/search` (Express, not a sidecar). **Verified path: `Ancillary/`, not `Tools/`.**
- `src/essence/Basics/TimeControl_/TimeControl.js`, `TimeUI.js` — time-control UI. **Verified path: `Basics/TimeControl_/`, not `Tools/TimeControl/`.** Calls `query_tileset_times` server-side; static needs the time list baked into the config.
- `src/essence/Basics/Layers_/LayerCapturer.js` — **Verified path: `Basics/Layers_/`, not `Tools/Identifier/`.** Has un-guarded boot fetches per the v3 plan; check for these during Phase C work.
- `src/essence/LandingPage/LandingPage.js` — mission picker. `.init(generalOptions, missionsList)`. Has 2 `calls.api('get', { mission })` sites that fire after a mission is selected. Also injects `_dbMissionName`.
- `src/essence/Ancillary/Login/Login.js` — login UI. Hidden in static.

### Static-mode-relevant existing infrastructure (dormant but present)

- `public/index.html` — sets `mmgisglobal.SERVER = "node"` **unconditionally** (outside the `NODE_ENV` switch). The dual-render (Pug `#{}` for production, InterpolateHtmlPlugin `%%` for default) of the switch is the natural place to add a third static-mode branch that sets `SERVER` differently.
- `src/pre/calls.js` line ~169 — the dormant `SERVER != 'node'` escape branch (currently warns + errors).
- `src/essence/essence.js` (`swapMission`) — non-node branch that does `$.getJSON('Missions/<name>/config.json')`. Currently unreachable.
- `src/essence/LandingPage/LandingPage.js` (3 sites) — non-node branches that load config from `Missions/<name>/config.json` directly. Currently unreachable.
- `FORCE_CONFIG_PATH` env hook — plumbed through `scripts/server.js` → `public/index.html` → consumed in `src/App.js`. When set, the landing page skips the missions-list API call and loads config from that path.

### Build/config

- `configuration/webpack.config.js` — Webpack 5 config. `entry` points at
  `src/index.js`. `output.path` is `build/`. `HtmlWebpackPlugin` produces
  `build/index.html`. `MiniCssExtractPlugin`, `CopyWebpackPlugin` (Cesium
  assets), `DefinePlugin` (env var injection via `getClientEnvironment`).
  `ModuleScopePlugin` restricts imports outside `src/` — relevant when
  introducing the baked-config alias.
- `configuration/env.js` — `getClientEnvironment()`. The env-var allow-list:
  `REACT_APP_*` plus a curated MMGIS list. New env vars for static mode must
  be added here to reach the browser.
- `configuration/paths.js` — path constants used by the build (paths.appSrc,
  paths.appBuild, paths.appPublic).
- `configuration/modules.js` — module resolution config.
- `configure/package.json` — Configure SPA. React 17 + react-scripts +
  MUI 5 + Redux Toolkit. Builds with `react-scripts build`.
- `configure/scripts/make-pug-index.js` — wraps CRA's `index.html` into a
  pug template Express can render with injected variables (user, permission,
  AUTH mode, etc.).
- `public/index.html` — HTML template processed by HtmlWebpackPlugin. Contains
  `%REACT_APP_*%` placeholders.

---

## Phase A — Code preparation

**Goal:** Lay the foundations the later phases need without changing runtime
behavior. After Phase A, `npm run build` and `npm start` work identically.

> **Open decision before Phase A starts:** Do we introduce a fresh
> `STATIC_MODE` env var (recommended below for clarity), OR reuse the existing
> `mmgisglobal.SERVER` flag by setting it to `"static"` in the static build's
> `public/index.html` render branch? `STATIC_MODE` is cleaner for the
> build-time DefinePlugin substitutions and Webpack tree-shaking; reusing
> `SERVER` activates the existing dormant non-node code branches in
> `calls.js`, `essence.js`, and `LandingPage.js` for free. Recommended: use
> **both** — `STATIC_MODE` as the build-time flag for Webpack
> DefinePlugin / DCE, and set `mmgisglobal.SERVER = "static"` in the static
> `index.html` so the dormant branches activate at runtime. Pin during
> execution.

### A.1 Introduce `STATIC_MODE` and `STATIC_*` env vars in the allow-list

**File:** `configuration/env.js` (`getClientEnvironment`).

Add to the curated allow-list:

- `STATIC_MODE` — string, `"true"` or unset.
- `STATIC_CONFIG_PATH` — string, optional; path to the baked config JSON
  emitted by the static publish step. Defaulted by `scripts/publish-static.js`.
- `STATIC_TITILER_URL`, `STATIC_STAC_URL`, `STATIC_TIPG_URL`,
  `STATIC_TITILER_PGSTAC_URL`, `STATIC_VELOSERVER_URL` — absolute URLs of
  shared admin-stack adjacent services in static mode.
- `STATIC_MISSION_NAME` — the mission baked into the dashboard.

**Verification:** `npm run build` still produces a working admin bundle (the
flag is unset). Inspect `build/static/js/main.*.js` for the new env vars
appearing in the `process.env` shim — they should be `undefined` in the admin
build.

### A.2 Introduce the service-URL helper

**New file:** `src/essence/Basics/serviceUrls.js`.

**Exports:** `getTitilerBaseUrl()`, `getStacBaseUrl()`, `getTipgBaseUrl()`,
`getTitilerPgstacBaseUrl()`, `getVeloserverBaseUrl()`. Each returns a string.

**Body:** Reads `process.env.STATIC_*_URL` when `process.env.STATIC_MODE === 'true'`,
otherwise returns the same-origin path it returns today (e.g. `/titiler` for
TiTiler). No trailing slash. Result is memoized.

**Verification:** In the admin build, every call to the helper must return
the same string as the current hardcoded path. Unit test in
`src/essence/Basics/serviceUrls.test.js` covering both branches.

### A.3 Introduce the baked-config module stub

**New file:** `src/pre/staticConfig.js`. Gitignored alongside `src/pre/tools.js`.

**Body in admin (stub) form:**

```js
export default null;
export const STATIC_MODE = false;
```

**Body when emitted by static publish (later, Phase D):** populated with
`{ configData, missionsList, generalOptions, mission }`.

**`API/updateTools.js`** writes this file at the same time it writes
`src/pre/tools.js`. In the admin case it emits the stub form. The Phase D
work overrides this when `STATIC_MODE=true`.

**Webpack alias:** `STATIC_MISSION_CONFIG -> src/pre/staticConfig.js`. Must
live under `src/` because of `ModuleScopePlugin` (`configuration/webpack.config.js`).

**Verification:** `npm run build` produces a build whose `staticConfig.js`
import resolves to the stub. Bundle behavior unchanged.

### A.4 Introduce the `MODE` constant for runtime branching

**New file:** `src/essence/Basics/mode.js`.

**Exports:** `MODE` — string, `'admin'` or `'static'`.

**Body:** `export const MODE = process.env.STATIC_MODE === 'true' ? 'static' : 'admin';`.

Anywhere that needs to branch on mode imports `MODE` and compares. Avoids
re-reading `process.env` at every call site.

---

## Phase B — Adjacent-service URL indirection

**Goal:** Replace every hardcoded `'/titiler'` / `'/stac'` / `'/tipg'` /
`'/titilerpgstac'` / `'/veloserver'` in the frontend with a call to the
Phase A.2 helper. After Phase B, the admin build behaves identically (the
helper returns same-origin paths in admin mode); dashboards become wireable
to absolute URLs by changing env vars.

### B.1 Inventory call sites

Verified by `grep '/titiler\|/stac\|/tipg\|/titilerpgstac\|/veloserver'` — **exactly four files** have direct same-origin sidecar URL construction:

- `src/essence/Basics/Map_/Map_.js` — TiTiler raster layer URLs.
- `src/essence/Basics/Layers_/Layers_.js` — `parseConfig` and the STAC fetch branch (the v3 plan flagged this STAC boot fetch as the most consequential edge case).
- `src/essence/Tools/Identifier/IdentifierTool.js` — `/titiler/cog/point/…` and `/titilerpgstac/collections/…`.
- `src/essence/Tools/Layers/LayersTool.js` — `/titiler/cog/info`, `/titiler/cog/bounds`, vector-tile URLs.

**Files that earlier drafts incorrectly listed in this inventory** (verified to have NO direct sidecar URL construction):

- `Globe_.js`, `GlobeRenderer.js` — zero hits; consume layer configs from `L_`.
- `MeasureTool.js` — uses `calls.api('getprofile')` (backend route, not a TiTiler URL).
- `Tools/Identifier/LayerCapturer.js` — doesn't exist at that path; real path is `Basics/Layers_/LayerCapturer.js`. Its un-guarded boot fetches are not sidecar URLs.

**Validation step (executing agent):** re-run `grep '/titiler\|/stac\|/tipg\|/titilerpgstac\|/veloserver' -r src/essence/` before editing to confirm the four-file list still holds.

### B.2 Rewrite each call site

Pattern: where a constructed URL today is `` `/titiler/cog/info?url=${u}` ``,
the new form is `` `${getTitilerBaseUrl()}/cog/info?url=${u}` ``.

Notes:

- **Helpers return no trailing slash.** Call sites must add one.
- **Phase B does not cover `getbands`, `getprofile`, or `proj42wkt`** — these are `calls.api(...)` to **backend Express routes** (`/api/utils/getbands`, `/api/utils/getprofile`, `/api/utils/proj42wkt`), not sidecar URLs. They cannot be rewritten through `getTitilerBaseUrl()` because the frontend never constructs a TiTiler URL for them. In static, the backend routes are gone — see Phase E per-feature disposition decisions.

### B.3 The `adjacent-servers-proxy.js` change for direct-target mode

If §4.1 of the ADR's "preserve the Express proxy" default holds, no proxy
change is needed in Phase B. The proxy continues to mount `/titiler`, `/stac`,
etc., and the admin frontend keeps hitting same-origin paths.

If the alternative ("ALB direct routing per service") is adopted, the changes
are in `adjacent-servers/adjacent-servers-proxy.js`:

- Each `app.use('/titiler', ...)` block becomes optional, gated on a `PROXY_ENABLED`
  env var (default true).
- The `ensureAdmin(false, false, true)` wrapping moves to a different mechanism
  (Lambda authorizer on the ALB, or service-side basic auth).

### B.4 Verification

- Admin `npm start` — Identifier, Measure, Layers, and base map layers all
  work. The helper returns same-origin paths and the proxy serves them as
  today.
- Adversarial unit spec (Playwright TS unit format — see cross-cutting Tests): temporarily set `STATIC_MODE=true` and `STATIC_TITILER_URL=https://example.invalid`. Confirm that `getTitilerBaseUrl()` returns `https://example.invalid` and that one Identifier code path constructs the correct absolute URL. Reset afterwards.

### B.5 Rollback

Phase B is a single mechanical refactor. To roll back, revert the helper
file and the call-site rewrites. No data migration or config impact.

---

## Phase C — Boot-time config injection

**Goal:** In static mode, fulfill the config-related `calls.api` invocations from a baked source instead of hitting Express. Admin mode unchanged.

> **Architectural choice for Phase C: stub `calls.api` at the chokepoint vs. branch each call site.** Recommended approach is to stub `calls.api`'s existing non-node branch with a baked-response-map-plus-dispatch (see C.4). The alternative — branching each individual call site on `STATIC_MODE` — would require touching **six sites across three files** (`App.js` x2, `essence.js` x2, `LandingPage.js` x2) for the config path alone, plus the call-site branching for everything else. The chokepoint approach changes one function. *Open question Q-CALLS-API.*

### C.1 Codegen function (sibling to `updateTools`)

**File:** `API/updateTools.js`.

Add an exported function `bakeStaticConfig({ configData, missionsList, generalOptions, mission })` (sibling to the existing `updateTools()` / `updateComponents()` codegens, not an extension — the existing ones are disk-scan with no inputs; this one takes inputs).

The function writes `src/pre/staticConfig.js` with the form:

```js
export const STATIC_MODE = true;
export const CONFIG_DATA = /* JSON-serialized config */;
export const MISSIONS_LIST = /* JSON-serialized list */;
export const GENERAL_OPTIONS = /* JSON-serialized options */;
export const MISSION_NAME = /* string */;
// Per-call static-response handlers used by calls.api stub (Phase C.4).
export const STATIC_HANDLERS = {
  get_generaloptions: (data, success) => success({ options: GENERAL_OPTIONS }),
  missions: (data, success) => success({ missions: MISSIONS_LIST }),
  get: (data, success) => success({ mission: MISSION_NAME, config: CONFIG_DATA }),
  // shortener_expand, login, etc. — drop with graceful error or omit entirely
};
export default { configData: CONFIG_DATA, missionsList: MISSIONS_LIST, generalOptions: GENERAL_OPTIONS, mission: MISSION_NAME };
```

In admin builds, `updateTools` writes the stub form (no change to admin).

`scripts/publish-static.js` (Phase D.1) invokes `bakeStaticConfig` after fetching the live mission config from the admin.

The bake step must also handle **server-injected fields**: `_dbMissionName` is set into `configData` at runtime by `essence.js` and `LandingPage.js` from `response.mission`. The baked `STATIC_HANDLERS.get` should embed `_dbMissionName` in its response either explicitly (preferred — set it to the source mission name) or accept the `msv.mission` fallback path at `Layers_.js:3916`. Verify the fallback produces the same `L_.mission` value per mission before committing to that path.

### C.2 Boot-path coverage

Verified config-related `calls.api` call sites (6 sites across 3 files):

| File | Calls |
|---|---|
| `src/App.js` | `get_generaloptions`, `missions` |
| `src/essence/essence.js` | 2 × `calls.api('get', { mission })` (makeMission and swapMission paths) |
| `src/essence/LandingPage/LandingPage.js` | 2 × `calls.api('get', { mission })` (init and post-pick fetch) |

Plus `shortener_expand` (App.js x2, only on `?s=` URLs) and any tool-level `calls.api(...)` per-feature.

**With the chokepoint approach (C.4 below), none of these six sites get touched.** The stub in `calls.api` handles them all. The alternative per-site branching would require touching each.

### C.3 LandingPage behavior

Per the ADR's §5 resolution of Q-LANDING, dashboards are strictly one-mission-per-deploy. When `STATIC_MODE === true`, `LandingPage.init` should short-circuit and call `essence.init(configData, missionsList)` directly without rendering the picker. The picker UI and `?mission=` URL inspection paths are dead code in dashboard mode — leaving them in the bundle is harmless (tree-shaking will likely drop them) but no code path in `STATIC_MODE` should reach them.

This is a minimal client-side change (one branch in `LandingPage.init`) and is necessary even with the C.4 chokepoint approach, since the *control flow* of "show picker → wait for user click → fetch config" needs to be short-circuited.

### C.4 The `calls.api` chokepoint stub

**File:** `src/pre/calls.js`.

The dormant `SERVER != 'node'` branch is the natural insertion point. Replace the current warn-and-error with a dispatch into `STATIC_HANDLERS` from the baked config module:

```js
if (window.mmgisglobal.SERVER != 'node') {
  const handler = staticHandlers[call];
  if (handler) return handler(data, success, error);
  // Calls with no static disposition: drop gracefully.
  console.warn('calls.api("' + call + '") not available in static mode');
  if (typeof error === 'function') error();
  return;
}
```

Each named call in the `c[]` table gets a per-call decision at bake time:

- **Bake a static response** — `get_generaloptions`, `missions` (single-element list — the baked mission), `get` (single mission, single response).
- **Reroute to a shared admin-stack service over CORS** — any call that maps to a sidecar (uncommon at this layer since the URL-helper already handles sidecar URL construction; mostly applies to legacy `calls.api` entries that conflate backend and sidecar URLs).
- **Replace with a parameter-aware client-side computation** — small dataset queries that bake to client-side indices.
- **Drop gracefully** — `shortener_expand` (arbitrary tokens, can't bake), `login`, draw writes, etc.

Per the ADR's resolution of Q-LANDING, `STATIC_HANDLERS.get` is a single baked response, not a map. The bake step asserts that exactly one mission is configured per dashboard build.

### C.5 The Layers_.js boot-time STAC fetch (v3-flagged edge case)

**File:** `src/essence/Basics/Layers_/Layers_.js`.

The v3 plan flagged a synchronous-at-boot STAC fetch in `Layers_.js` (the
`getSTACLayers`-style recursion). This must be guarded by `STATIC_MODE`:

- In admin mode: unchanged.
- In static mode: the STAC results are either (a) pre-recursed and baked into
  the config by `scripts/publish-static.js`, mirroring `getSTACLayers`
  semantics at bake time; or (b) fetched at runtime from the shared STAC
  service over CORS, requiring the helper from Phase B already to be in
  place.

Default: pre-recurse at bake time. Reasoning: avoids a runtime dependency on
the STAC service for first paint of the dashboard. The bake step must mirror
`getSTACLayers`-style recursion exactly — name this as a load-bearing detail
of `scripts/publish-static.js`.

### C.6 Verification

- Admin: every boot path takes the existing fetch route. No console errors
  about static.
- Static (after Phase D): bundle loads, mission picker skipped (single mission, baked), `L_.init` runs with `staticConfig.configData`.

### C.7 Rollback

Revert Phase C and Phase A.3 / A.4 together. Phase B and lower can stay.

---

## Phase D — Static build pipeline

**Goal:** Produce a dashboard bundle on demand. Triggered by Phase H's
provisioning code; usable standalone via CLI for testing.

### D.1 `scripts/publish-static.js`

**Inputs (CLI flags or env):**

- `--mission` (string, required).
- `--config` (path to a JSON file, optional; if omitted, the script queries
  the admin's Postgres via Sequelize).
- `--output` (path, default `build-static/`).
- `--titiler-url`, `--stac-url`, `--tipg-url`, `--titiler-pgstac-url`,
  `--veloserver-url` (strings; baked into `STATIC_*_URL` env vars during the
  Webpack invocation).

**Sequence:**

1. Resolve mission config (`configData`), missions list, general options.
   When called from the admin Publish handler (Phase H), these come from the
   handler's RDS query. When called standalone, the script makes an authenticated
   admin API call.
2. Recurse any STAC references in `configData.layers` to materialize the layer
   tree (Phase C.5 baking).
3. For each layer in `configData`, decide where its data will live: (a) leave
   it in the admin's shared S3 bucket (most raster tiles, DEMs); (b) copy it
   to the dashboard's own bucket (small per-mission data); (c) point it at
   a shared sidecar (large queryable data, COG mosaics, PostGIS-backed
   layers). Rewrite each layer's URL in `configData` accordingly (Phase F.2).
4. Call `bakeStaticConfig({ configData, missionsList, generalOptions, mission })`
   from `API/updateTools.js` (introduced in Phase C.1).
5. Spawn Webpack with `STATIC_MODE=true`, `STATIC_MISSION_NAME=<mission>`,
   `STATIC_*_URL=<values>`. Use `configuration/webpack.config.js` unchanged
   (env vars flow via `configuration/env.js`).
6. After Webpack succeeds, copy the output directory to `--output`.
7. Restore `src/pre/staticConfig.js` to its stub form so the next admin build
   does not accidentally ship a baked config.

**Concurrency:** The script must hold a build lock (e.g. file lock under
`/tmp/mmgis-static-build.lock`) because it mutates `src/pre/staticConfig.js`
in the working tree. Two concurrent publishes corrupt each other. In ECS
deployment (one task per publish), tasks run in their own filesystem — the
lock is intra-task only.

### D.2 Webpack changes

**File:** `configuration/webpack.config.js`.

- Add the `STATIC_MISSION_CONFIG` alias pointing at `src/pre/staticConfig.js`.
- Confirm `ModuleScopePlugin` does not block (the file lives in `src/`).
- Confirm `DefinePlugin` receives `STATIC_MODE`, `STATIC_*_URL`, `STATIC_MISSION_NAME`
  via `configuration/env.js`.
- The `HtmlWebpackPlugin` template `public/index.html` may contain `%REACT_APP_*%`
  placeholders that need a static-mode branch. v3 noted an unquoted `%HOSTS%`
  substitution gotcha — hardcode `HOSTS = {}` for static builds, or set
  `process.env.HOSTS = '{}'` at script invocation.
- Configure SPA (`configure/...`) is **not** built by the static pipeline. It
  is admin-only. The static pipeline only runs the Essence webpack.

### D.3 `package.json` scripts

Add:

```json
{
  "scripts": {
    "build:static": "node scripts/publish-static.js",
    "publish:static": "node scripts/publish-static.js --upload"
  }
}
```

`--upload` mode adds the post-build S3 sync step. Phase H.4 handles the
production publish; `npm run build:static` is the dev/manual path.

### D.4 Output layout

The output of `npm run build:static` is a directory containing exactly what
goes into the dashboard's S3 bucket:

```
build-static/
  index.html
  asset-manifest.json
  static/
    js/
    css/
    media/
    cesium/
  staticConfig.json   (also baked into the bundle; emitted separately for inspection)
```

S3 sync uploads the whole directory. CloudFront invalidates `/index.html`
and `/asset-manifest.json`; everything else is fingerprinted.

### D.5 Verification

- `STATIC_MODE=true npm run build:static -- --mission Test ...` produces a
  `build-static/` directory.
- Serve `build-static/` with a static file server (e.g. `npx serve`) and
  verify the bundle boots, loads the baked mission, and renders the map.
- Confirm no `/api/configure` network calls in the browser DevTools network
  tab during boot.
- Confirm the adjacent-service calls (Identifier, Layers) go to the
  configured `STATIC_*_URL` absolute URLs, not same-origin paths.

**Mission-config source for testing:** There is no example mission config checked into the repo today (verified: `Missions/Demo/` has `Data/` and `Layers/` subdirectories but no `config.json` — real configs live only in Postgres). Three options for getting a test mission config:

- Export from a running admin's Postgres (`GET /api/configure/get?mission=…` against a dev admin).
- Hand-craft a minimal config that exercises the bundle (also serves as schema documentation).
- Check in `Missions/Demo/config.json` as a permanent test fixture — recommend doing this regardless of the static refactor; useful for smoke tests, useful as schema documentation.

See Q-MISSION-FIXTURE in the ADR.

### D.6 Rollback

Delete `scripts/publish-static.js` and the package.json script entries.
Phases A–C are unaffected.

---

## Phase E — Feature gating in static

**Goal:** Where features cannot work in a dashboard, either gracefully degrade
or disable. Per `decisions.md` and the ADR §5.3 drop list.

For each feature: file, branching point, and behavior in each mode.

### E.1 Draw tool

- **Files:** `src/essence/Tools/Draw/DrawTool.js` (and submodules).
- **In admin:** unchanged. Reads/writes against `/api/draw/*`; WebSocket
  collaboration via `mmgisAPI` event bus → server WebSocket.
- **In static:** **disabled** by default. Implementation:
  - In the tool's `make()` (or equivalent registration), short-circuit when
    `MODE === 'static'` and the dashboard's baked config does not include a
    Draw feature flag.
  - Open question Q-DRAW: read-only display of baked features is a future
    enhancement; not in scope for the first static build.
- The tool's entry in the codegen output (`src/pre/tools.js`) can be filtered
  out at bake time by the publish script if Q-DRAW resolves to "drop entirely."

### E.2 Real-time collaboration

- **Files:** `mmgisAPI` event bus subscribers across multiple tools that
  subscribe to draw/sync/presence events.
- **In static:** the WebSocket connect call (in essence boot or `mmgisAPI`
  bootstrap) must short-circuit on `MODE === 'static'`. Subscribers see no
  events, which is acceptable.

### E.3 Measure tool — elevation profile

- **File:** `src/essence/Tools/Measure/MeasureTool.js`.
- **Correction:** Measure does **not** construct a TiTiler URL directly. It calls `calls.api('getprofile', …)` which routes to the **backend** route `/api/utils/getprofile`. The backend route in turn may delegate to TiTiler (verify), but the frontend never builds `/titiler/…` URLs for this feature.
- **In static:** the backend route disappears. Three dispositions:
  - **Hide the elevation profile affordance.** Default if the cost of the alternatives is too high.
  - **Call TiTiler directly cross-origin** from the static frontend. Requires writing new client code that does what the backend's `getprofile` does (sample TiTiler line-string endpoint along the user's drawn line).
  - **Replace with client-side computation over baked DEM tiles.** The Measure tool already does DEM-tile reads for its other features; in static the elevation profile could sample the same baked DEM tiles directly.
- Recommended default: **hide the elevation profile in static**, revisit if stakeholders ask. The client-side-from-DEM-tiles path is a real future option.
- This is **not** covered by the Phase B URL-helper rewrite — it's a backend-route-disappearance pattern.

### E.4 Identifier tool

- **File:** `src/essence/Tools/Identifier/IdentifierTool.js`.
- **Two distinct call shapes here:**
  - **Direct sidecar URL construction** (`/titiler/cog/point/…`, `/titilerpgstac/collections/…`) — Phase B URL-helper rewrite handles these. Hit the shared admin-stack TiTiler / TiTiler-pgSTAC over CORS in static.
  - **`calls.api('getbands', …)`** — backend route `/api/utils/getbands`, NOT a TiTiler URL. In static the backend route disappears. Dispositions:
    - Hide the band-list affordance in static (default).
    - Write new client code that calls TiTiler's `/cog/info` (or similar) directly to get band metadata.
  - Recommended: hide for the first cut.

### E.5 Shade tool

- **File:** `src/essence/Tools/Shade/ShadeTool.js`.
- **In static:** if Shade depends on a server-rendered shadow texture, the
  feature is hidden. If it is pure-client over DEM tiles, it survives via
  the baked DEM tiles. **Verify against code** — this is open. Mark
  `Q-SHADE` and resolve during implementation.

### E.6 TimeControl

- **Files:** `src/essence/Basics/TimeControl_/TimeControl.js` and `TimeUI.js`. (Verified path: TimeControl lives in `Basics/`, not `Tools/` — corrected from an earlier draft.)
- **In static:** v3 flagged `query_tileset_times` as a server call. Two
  paths:
  - **Bake the times into the config.** `scripts/publish-static.js` queries
    the admin for the time list and inlines it into a `times` field of the
    layer config. Frontend reads from config; no runtime fetch.
  - **Hit the admin's endpoint at runtime.** Adds a runtime dependency on
    the admin; rejected by default.
  Default: bake.

### E.7 Layers tool

- **File:** `src/essence/Tools/Layers/LayersTool.js`.
- **In static:**
  - Direct sidecar URL constructions (TiTiler info/bounds, vector tiles) — Phase B URL-helper rewrite.
  - `calls.api('proj42wkt', …)` — backend route `/api/utils/proj42wkt`, disappears in static. Disposition: hide the affordance, or port Proj4js to do projection conversion in the browser (the v3 plan flagged this option).
  - "Fetch layer info from server" affordances (if any) hide in static.
  - Basic layer toggles and filters work off `L_` and continue.

### E.8 Search

- **Files:** `src/essence/Ancillary/Search.js` (the UI — verified path: `Ancillary/`, not `Tools/Search/`); server side `API/Backend/Datasets/routes/datasets.js` `search` handler.
- **In static:** server-side search is not available. Three sub-options
  (Q-SEARCH):
  - Hide the tool entirely. **Default.**
  - Build a client-side index over baked data at bake time and ship it.
    Adds work; revisit if customers demand it.
  - Point at a shared search service. No such service exists today.

### E.9 Login UI

- **File:** `src/essence/Ancillary/Login/Login.js`.
- **In static:** hidden. The CloudFront Function password gate is the only
  auth mechanism.

### E.10 Configure entry point

- **File:** `src/essence/LandingPage/LandingPage.js`.
- **In static:** the "Configure" button (admin-only affordance) hides.

### E.11 Verification

- Manual: load the dashboard. Confirm each feature in §E either works
  (Identifier, Measure, time control) or is absent (Draw, Search, Login,
  Configure entry).
- Automated: a new Playwright spec under `tests/e2e/static-mode/` that boots
  the static bundle and walks the feature list.

### E.12 Rollback

Each E sub-step is an isolated branch on `MODE`. Reverting any one does not
break the others.

---

## Phase F — Mission asset S3 migration

**Goal:** Move `Missions/` from local disk to S3. Admin reads/writes via
middleware that fetches from S3; dashboards have relative paths rewritten
to absolute S3+CloudFront URLs at bake time.

### F.1 Admin-side middleware change

**Files:** `scripts/middleware.js` (the `missions()` function) and `scripts/server.js` (the 3-middleware stack that mounts `/Missions/...`).

Today's mount is a **stack of three middlewares**, not a single `express.static`:

```js
app.use(
  `${ROOT_PATH}/Missions`,
  ensureUser(),                                    // 1. auth
  middleware.missions(ROOT_PATH),                  // 2. _time_ compositing
  express.static(path.join(rootDir, "/Missions"))  // 3. static fallback
);
```

The S3 refactor addresses each layer separately:

**Layer 1 — `ensureUser()`.** Keeps gating admin-side access to mission assets. No change.

**Layer 2 — `middleware.missions(ROOT_PATH)` (the `_time_` compositing path).** Server-side `sharp` compositing of time-windowed tiles. No cheap static equivalent. Three options for the admin:
- Continue server-side compositing: admin streams constituent tiles from S3, composites with `sharp`, returns. Works but expensive (each request fetches N tiles).
- Bake all time slices at publish time and serve statically. Admin-side this would mean precomputing on every config save — heavy.
- Hide the feature in the admin. Loses functionality.

Recommended default for the admin: **continue server-side compositing.** Dashboards pre-bake or hide per layer (Q-TIME).

**Layer 3 — `express.static('./Missions')`.** This is the layer that moves to S3:
- **CloudFront-fronted S3, with the admin redirecting `/Missions/...` to the CloudFront URL.** Simplest. The browser fetches direct from CloudFront. Drawback: admin auth no longer gates mission assets. Acceptable because assets are already semi-public (they go into dashboards). If true privacy is needed, use signed URLs.
- **Admin proxies through to S3 (Express → S3 GetObject → stream back).** Preserves auth gating; pins bandwidth to the admin task; loses CloudFront caching for admin users.

Recommended default for the static fallback: **CloudFront-fronted S3 with redirect.**

**Refactor structure:** Worth splitting `middleware.missions(ROOT_PATH)` itself in the refactor — pull the `_time_` compositing into a separate `middleware.timeComposite(ROOT_PATH)` and leave path-translation as a thin layer the S3 backend can replace independently.

### F.2 Dashboard layer URL rewriting

**File:** `scripts/publish-static.js` (introduced in Phase D).

The publish step makes a per-layer decision about where each layer's data
will live in the dashboard, then rewrites the layer's URL in `configData`
accordingly. Three destinations (per ADR §9.2):

- **Leave in admin's S3 bucket** — for raster tiles, DEMs, and basemap
  imagery already uploaded by admins. The URL is rewritten to the admin's
  CloudFront-fronted S3 URL (e.g.
  `https://mission-assets.<admin-domain>/Missions/<mission>/Layers/...`).
  No data copy needed.
- **Copy to the dashboard's own bucket** — for small per-mission data the
  publish step decides to bake (small GeoJSON, lookup tables, baked search
  indices). The script reads the source data from Postgres or admin S3,
  serializes if needed, writes the static file into the dashboard's S3
  bucket alongside the JS bundle, and rewrites the URL to a relative path
  (e.g. `/data/sites.geojson`) that resolves against the dashboard's own
  CloudFront origin.
- **Point at a shared sidecar** — for data that needs dynamic querying
  (TiTiler-served COG mosaics, tipg-served PostGIS layers, a custom search
  endpoint). The URL is rewritten to an absolute sidecar URL (e.g.
  `https://titiler.<admin-domain>/cog/tiles/{z}/{x}/{y}?url=s3://...`).

The heuristic for which destination a layer ends up at lives in the publish
script. First-pass defaults: raster-tile and DEM layers default to "leave
in admin S3"; small vector/tabular layers default to "copy to dashboard
bucket"; layers backed by COG mosaics or PostGIS tables default to "point
at sidecar." The mission config may eventually grow a per-layer override.

**Sub-decision: shared mission-asset bucket vs per-dashboard copy** (for
the "leave in admin's S3" case). Shared is cheaper and immediate, but the
dashboard is "live" against admin's S3 — if admins re-upload, the dashboard
sees the change. Per-dashboard copy preserves immutability at the cost of
duplicating large rasters per dashboard. Default: **shared bucket**, with
per-dashboard copy as a future option for missions that need
frozen-at-publish-time guarantees.

### F.3 Single-file upload path migration

**File:** Upload handlers in `API/Backend/...` that today write to disk under
`Missions/<mission>/`.

For **single-file uploads** (sample media, individual rasters, individual
files an admin pushes through the UI), the path is straightforward:

- Browser → Express → disk: replaced by
- Browser → presigned S3 POST → S3, with Express only handing back the
  presigned URL.

Presigned URL generation: AWS SDK v3 (`@aws-sdk/client-s3` +
`@aws-sdk/s3-request-presigner`). Express handler signs a POST policy with
size and prefix constraints (e.g. only `Missions/<mission>/Data/` prefix,
max size from a config var).

For **tile-pyramid uploads** — the canonical big-file workflow — the
mechanism is open (ADR Q-BIG-UPLOAD). See F.4 for the implementation
sketches; whichever option the ADR resolves to becomes the execution plan.

**Affected upload endpoints:**

- Single-file mission-asset uploads (media, individual rasters): switch to
  presigned.
- Tile-pyramid uploads: see F.4 (Q-BIG-UPLOAD).
- Dataset (CSV) uploads — these go to Postgres, not disk; **no change**.
- Geodataset uploads — same; **no change**.

### F.4 Tile-pyramid upload workflow (Q-BIG-UPLOAD)

**Status:** open — ADR §4.5 has not picked a workflow. This subsection
sketches the implementation path for each of the three options so
execution can start once the choice is made. Once stakeholders pick, the
corresponding subsection below becomes the execution plan and the others
can be deleted.

The problem: today's tile-pyramid workflow (`gdal2customtiles.py` produces
a folder of thousands of tiles; operator `scp`s the folder into `Missions/`)
doesn't survive AWS, and admin users don't have direct AWS credentials, so
the upload has to go through the admin UI.

**Option A — Upload as a single archive, extract server-side.**

Operator zips or tars the pyramid on their workstation before upload. The
browser uploads one archive file via presigned to a *staging prefix* in S3
(e.g. `s3://mmgis-staging/<upload-id>.zip`). A spawned ECS task then:

- Downloads the archive from staging.
- Extracts it.
- Writes the individual tile files into the canonical mission prefix in
  admin's S3 (`s3://mmgis-missions/<mission>/Layers/<layer-name>/<z>/<x>/<y>.png`).
- Deletes the staging archive.
- Notifies the admin UI when complete.

**Files:** new `API/Backend/Uploads/routes/uploads.js` for the
orchestration endpoint; new spawned task definition (similar to the publish
task in Phase H) for the extract job. The existing admin upload UI gets a
"zip your pyramid first" instruction and the new endpoint flow.

**Trade:** operator UX is one upload action; reintroduces a backend step
in the upload path; the extract job needs its own memory/disk allocation
for big archives.

**Option B — Bulk multi-file presigned upload.**

The browser fires off many parallel presigned uploads — one per tile.
Workflow:

- Operator selects the pyramid folder in the file picker (HTML5
  `webkitdirectory` attribute on `<input type="file">`).
- Browser enumerates files, requests a presigned URL per file from a new
  batch endpoint (`POST /api/uploads/presign-batch`).
- Browser PUTs each file to its presigned URL with bounded parallelism
  (e.g. 8 concurrent).
- Browser tracks progress, retries individual failures, reports completion
  to the admin server.

**Files:** new `API/Backend/Uploads/routes/uploads.js` for batch presign
generation; substantial new frontend logic in the admin UI for upload
orchestration, progress, retry, and recovery from page reloads.

**Trade:** no new backend processing; brittle at scale (browser memory
holds the file list, dropped connections lose individual uploads, no
cross-file resumability across page reloads); presign generation is one
admin round-trip per file.

**Option C — Shift production format to COGs.**

The operator workflow changes: `tifs2cogs` (already in `auxiliary/stac/`)
instead of `gdal2customtiles`. The output is a single COG file. The browser
uploads one file via presigned multipart (5GB single-PUT, 5TB multipart
ceiling). The TiTiler sidecar (already in our adjacent-services set)
serves tiles from the COG on demand over HTTP.

**Files:**

- `scripts/publish-static.js` — when rewriting URLs (F.2), recognize
  COG-backed layers and emit TiTiler URLs
  (`https://titiler.<admin-domain>/cog/tiles/{z}/{x}/{y}?url=s3://...`).
- Mission config schema — add a layer-type or field marking the layer as
  COG-backed.
- Configure UI — surface the new layer type for admins setting up a COG
  layer.
- Documentation — operator runbook updates for the `tifs2cogs` workflow.
- **Migration:** existing tile-pyramid layers in production mission
  configs need per-layer re-baking. The publish script could fail-loud on
  layers pointing at legacy tile-pyramid URLs to force the migration
  rather than silently shipping broken dashboards.

**Trade:** clean single-file upload aligned with AWS object storage;
requires updating both production data and operator workflow per-layer;
existing layers need migration scoping against the mission backlog.

### F.5 Verification

- Admin: create a new mission, upload a sample tile pyramid via the new
  presigned flow, render the layer in the admin map. Assets should be
  served by CloudFront URLs (verifiable in DevTools network tab).
- Dashboard: publish a dashboard. Open the dashboard URL. The map renders
  layers from the rewritten absolute URLs.
- The `_time_` admin behavior (if a mission uses it) still composites
  correctly.

### F.6 Rollback

Disk-backed storage and admin proxying mode can be re-enabled with a env
flag (`MISSIONS_STORAGE=disk` vs `MISSIONS_STORAGE=s3`). Keep both code
paths during transition for at least one production cycle.

---

## Phase G — Adjacent services on ECS

**Goal:** Each Python sidecar runs as its own ECS Fargate service, behind
the admin ALB. The Express proxy continues to forward (per ADR §4.1 default).

### G.1 ECS task definitions

For each of TiTiler, TiTiler-pgSTAC, STAC API, tipg, veloserver:

- One Fargate service per image. Same image tags as today
  (`ghcr.io/developmentseed/titiler:0.22.2`, `ghcr.io/stac-utils/stac-fastapi-pgstac:5.0.2`,
  etc. — verified by the adjacent-services research).
- CPU/memory sized to current docker-compose hints; refine based on load
  testing.
- Environment variables: as per the docker-compose entries — DB credentials,
  GDAL config (`CPL_TMPDIR`, `GDAL_CACHEMAX`, `GDAL_DISABLE_READDIR_ON_OPEN`,
  `VSI_CACHE`), `TILEMATRIXSET_DIRECTORY`, AWS credentials (optional for S3
  COG fetching).
- The `./adjacent-servers/resources/tilematrixsets/planetcantile_v4`
  directory is **a host-filesystem dependency** in the docker-compose setup;
  for ECS, either bake into a custom image or ship it via a mounted EFS.
  Default: bake. Custom Dockerfile that COPYs the directory into the image.
- The Missions/ path is also mounted today; in AWS this becomes an S3 read
  (the Python services pass S3 URLs to GDAL; GDAL supports `s3://...` paths
  natively with proper config).

### G.2 ALB target groups

One target group per sidecar service. The admin's Express task continues to
have its own target group. ALB listener rules route by path:

- `/api/*`, `/configure*`, `/`, `/docs*` → admin Express target.
- `/stac*`, `/titiler*`, `/titilerpgstac*`, `/tipg*`, `/veloserver*` → admin
  Express target (which proxies internally — Phase G keeps the Express proxy
  per ADR default).

The optional "ALB direct routing" alternative would route those sidecar
paths to their own target groups; defer per ADR §4.1.

### G.3 Service discovery

The admin Express task needs to resolve sidecar service names. Today
`isDocker` in `adjacent-servers-proxy.js` swaps `localhost` for the
docker-compose service name. In ECS:

- Use **ECS Service Discovery** (Cloud Map). Each sidecar service registers
  a private DNS name like `titiler.mmgis.internal`.
- The Express proxy resolves sidecar URLs by DNS, not by `isDocker` env.
- Update `adjacent-servers-proxy.js` to read sidecar hostnames from env
  vars (`TITILER_TARGET_URL`, `STAC_TARGET_URL`, etc.) — already a sensible
  parameterization regardless of deployment.

### G.4 CORS for cross-origin dashboard access

For each sidecar, configure CORS to allow:

- The admin's CloudFront origin (`https://admin.mmgis.example`).
- Every published dashboard's CloudFront origin (or a wildcard like
  `*.dashboards.mmgis.example` if a subdomain scheme is used).

Implementation per service:

- **TiTiler / TiTiler-pgSTAC:** CORS via the FastAPI/Starlette middleware
  built into the image. Settable via `TITILER_API_CORS_ALLOW_ORIGINS` env
  var (verify exact var name when building the image).
- **STAC API (`stac-fastapi-pgstac`):** similarly Starlette-based; CORS env
  vars exist.
- **tipg:** has its own CORS config.
- **veloserver:** unknown until Q-VELO resolves.

### G.5 Database wiring

- TiTiler-pgSTAC, STAC API, tipg all need a connection to the `mmgis-stac`
  database. RDS endpoint, credentials via Secrets Manager. Same connection
  string structure as today.
- TiTiler is filesystem-only (no DB) — same as today.
- Veloserver — unknown.

### G.6 Veloserver — verify before provisioning

Verified: **zero frontend code paths in `src/essence/` construct `/veloserver` URLs today** (grep returned nothing). The backend proxies it (`adjacent-servers-proxy.js`), but no current Essence code reaches for it. Before allocating ECS capacity for veloserver:

1. Check whether any production mission config references a veloserver-backed layer (Q-VELO from the ADR).
2. If no, drop the service from the AWS deployment entirely.
3. If yes, document its DB / env / mount requirements (the docker-compose entry has no DB, env vars, or init config, so this is a real research task).

This is cheap to defer until Phase G execution time.

### G.7 Verification

- Each sidecar reachable from the admin task via its Service Discovery name.
- Each sidecar reachable from a dashboard's CloudFront origin via its public
  ALB path. CORS-allow-listed.
- Express proxy continues to gate admin-origin requests through `ensureAdmin`.
- Open question Q-AUTH-2: cross-origin dashboard requests bypass `ensureAdmin`
  by design (they hit the sidecar via ALB path, not via the proxy). This is
  the trade-off the ADR called out; revisit if security review requires
  signed requests.

### G.8 Rollback

Each sidecar's ECS service can be scaled to zero and the corresponding
docker-compose entry re-enabled for local development. The ALB listener
rules can be removed.

---

## Phase H — Provisioning code

**Goal:** Implement the "Publish" button path: admin Express receives the
request, kicks off a build + provision + upload sequence, returns the URL.

### H.1 New Express endpoint

**File:** `API/Backend/Publish/routes/publish.js` (new module under
`API/Backend/Publish/`). Loaded by `API/setups.js` automatically.

**Endpoints:**

- `POST /api/publish` — body `{ mission, dashboardName, settings }`.
  Authenticated, admin-only (`ensureAdmin(true, false, false)`).
- `DELETE /api/publish/:id` — tears down a dashboard.
- `GET /api/publish` — lists dashboards.
- `GET /api/publish/:id` — returns one dashboard's metadata.

### H.2 The publish handler

**Sequence (Phase H.2):**

1. Validate request. Confirm `req.user` has permission for `mission`
   (`checkMissionPermission` from `configs.js`).
2. Create a `dashboards` row (Phase I.1) with status `provisioning`.
3. Trigger the build + provision job:
   - **Option A (in-process):** synchronous; admin task ties up CPU. Bad.
   - **Option B (spawned ECS task — RECOMMENDED):** call the ECS RunTask API
     with a task definition that runs `scripts/publish-static.js` plus the
     provisioning steps below.
   - **Option C (CodeBuild):** trigger a CodeBuild project. Adds CodeBuild
     as a managed surface.
4. The spawned task does:
   - Read the mission config from RDS (via the same Sequelize models the
     admin uses).
   - Run `scripts/publish-static.js` (Phase D).
   - **Create S3 bucket** (`s3:CreateBucket`, `s3:PutBucketEncryption`,
     `s3:PutBucketPublicAccessBlock`).
   - **Upload the build artifacts** (`s3:PutObject`).
   - **Create CloudFront distribution** (`cloudfront:CreateDistribution`).
     Origin = the S3 bucket. Behaviors = SPA fallback to `/index.html` for
     404s, aggressive caching for `/static/*` (fingerprinted), no cache for
     `/index.html`.
   - **Create CloudFront Function** (`cloudfront:CreateFunction`,
     `cloudfront:PublishFunction`). The Function checks an Authorization
     header against an embedded password. The password value is generated
     per dashboard (Q-AUTH-1).
   - **Attach the Function** to the distribution's viewer-request event.
   - **Create the DNS record** (`route53:ChangeResourceRecordSets`) under
     the configured hosted zone.
   - **Update the `dashboards` row** with the resulting URL and status
     `published`.
5. The admin endpoint returns immediately with `{ dashboard_id, status: "provisioning" }`.
6. The Configure UI polls `GET /api/publish/:id` until `status === "published"`,
   then shows the URL.

### H.3 IAM policy

The spawned task's IAM role needs exactly:

- `s3:CreateBucket`, `s3:PutBucketEncryption`, `s3:PutBucketPolicy`,
  `s3:PutBucketPublicAccessBlock`, `s3:DeleteBucket`, `s3:PutObject`,
  `s3:DeleteObject`, `s3:ListBucket` — scoped to a bucket-name prefix
  (`mmgis-dashboard-*`).
- `cloudfront:CreateDistribution`, `cloudfront:UpdateDistribution`,
  `cloudfront:DeleteDistribution`, `cloudfront:GetDistribution`,
  `cloudfront:CreateInvalidation`, `cloudfront:CreateFunction`,
  `cloudfront:UpdateFunction`, `cloudfront:DeleteFunction`,
  `cloudfront:PublishFunction`, `cloudfront:GetFunction`.
- `route53:ChangeResourceRecordSets`, `route53:GetHostedZone` — scoped to
  the configured hosted zone.
- `rds-db:connect` — scoped to the dashboards database user, for reading
  the mission config.
- `secretsmanager:GetSecretValue` — for any per-dashboard secrets.

### H.4 Teardown

`DELETE /api/publish/:id` runs the reverse:

1. Mark `dashboards` row `status: deleting`.
2. Spawned task:
   - Invalidate CloudFront (optional; deletion implies it).
   - **Disable** the distribution (a delete only works after disable). Wait
     for the disable to propagate.
   - Delete the distribution.
   - Delete the Function.
   - Empty and delete the bucket.
   - Delete the DNS record.
   - Delete the `dashboards` row.

The distribution-disable wait is a real wrinkle — disabling a distribution
takes 15–30 minutes. The teardown task must handle the asynchronous
completion (poll the distribution status until `Enabled === false`, then
delete).

### H.5 Verification

- Functional: publish a dashboard. Wait. URL appears. Visit URL. Map loads.
- Functional: delete the dashboard. After ~30 min, the bucket and
  distribution are gone.
- IAM least-privilege: confirm the spawned task cannot create resources
  outside the documented scope.

### H.6 Rollback

The provisioning code can be removed or its endpoint disabled with a config
flag. Existing dashboards are not affected.

---

## Phase I — Dashboard registry

**Goal:** Persist the set of published dashboards.

### I.1 The `dashboards` table

**Migration:** MMGIS doesn't have a separate `API/Backend/Databases/` migrations directory — feature directories under `API/Backend/` each own their own models alongside their routes, and Sequelize `.sync()` (run during the main server's boot via `setups.synced(s)`) creates tables from those models. So this is a new feature module following the existing pattern (Accounts, Datasets, Draw, etc.).

**Schema (Sequelize model):**

```
id            INTEGER PRIMARY KEY AUTOINCREMENT
name          STRING NOT NULL UNIQUE     -- subdomain-safe
mission       STRING NOT NULL            -- the source mission
created_by    INTEGER REFERENCES users(id)
status        STRING                     -- provisioning|published|deleting|failed|deleted
url           STRING                     -- final dashboard URL once published
cloudfront_id STRING                     -- for invalidate/delete
bucket_name   STRING                     -- for delete
function_arn  STRING                     -- for delete
password_hash STRING                     -- bcrypt of the gate password
settings      JSONB                      -- arbitrary publish-time settings
created_at    TIMESTAMP
updated_at    TIMESTAMP
deleted_at    TIMESTAMP                  -- soft delete
```

**File:** `API/Backend/Dashboards/models/dashboard.js`.

### I.2 Configure UI surface

In `configure/src/` add a new "Dashboards" section showing:

- The list (from `GET /api/publish`).
- A "Publish" button that opens a dialog and POSTs.
- A "Delete" button per row.
- A "Copy URL" affordance.
- Real-time status (polling) during provisioning.

**Effort note:** Verified that the existing Configure pages (`configure/src/pages/`: APIs, APITokens, Datasets, GeneralOptions, GeoDatasets, STAC, Users, WebHooks) are all CRUD-over-forms. **There is no existing "async backend job, poll for status, surface result URL" pattern in Configure.** The Redux Toolkit and `core/calls.js` plumbing carries over for state and API calls; the async-job state machine is net-new UX. Plan accordingly.

### I.3 Verification

- The registry stays consistent across publish/delete cycles.
- A published dashboard's URL works when its row status is `published` and
  fails open when status is `deleting` (404 from CloudFront after distribution
  delete).

---

## Phase J — Deploy-time gaps

### J.1 First-user-becomes-superadmin gap

**File:** `API/Backend/Users/routes/users.js`, `first_signup` handler.

The handler creates a permission-`111` user when `User.count() === 0`. In an
AWS deployment, the admin is exposed publicly during the gap between deploy
and first login. Options:

- **Operational runbook:** restrict ALB ingress to a known IP during initial
  provisioning. The admin operator logs in, then ingress opens up. Cheapest;
  human discipline required.
- **Seed a superadmin during init-db:** the ECS init-db one-shot task creates
  a superadmin from credentials in Secrets Manager. The `first_signup`
  handler no longer fires for the first request. Removes the race entirely;
  adds the operational task of putting a credential in Secrets Manager.
- **Disable `first_signup` behind a config flag** in AWS deployments.
  Combined with the Secrets Manager seed, this is the safe form.

Recommended default: **seed via init-db + disable `first_signup` in AWS**.

### J.2 CloudFront Function password gate

The Function source (JavaScript, runs at viewer-request):

```js
function handler(event) {
  var req = event.request;
  var auth = req.headers.authorization;
  var expected = "Basic " + EXPECTED_BASE64;  // baked at function publish
  if (!auth || auth.value !== expected) {
    return {
      statusCode: 401,
      statusDescription: "Unauthorized",
      headers: {
        "www-authenticate": { value: 'Basic realm="dashboard"' }
      }
    };
  }
  return req;
}
```

The Function is generated at publish time by Phase H.2, with `EXPECTED_BASE64`
substituted from the per-dashboard password.

**Limitations:**

- Basic auth re-presents on every browser session. Acceptable for the use
  case.
- The password is visible in the Function's published source to anyone with
  IAM access to CloudFront — not a leak path of concern.
- Per-dashboard password rotation requires republishing the Function. Not a
  hot path; acceptable.

### J.3 Rollback

J.1 changes are reversible by re-enabling `first_signup`. J.2 changes only
affect dashboards; admin is unaffected.

---

## Cross-cutting implementation notes

### CSP and helmet config

**File:** `scripts/server.js` (helmet configuration).

**Correction:** today's CSP is **already permissive**. Verified in `scripts/server.js`: `connectSrc: ["*"]`, `imgSrc: ["*", ...]`, `styleSrc: ["*", ...]`, `fontSrc: ["*", ...]`, `mediaSrc: ["*", ...]`. The browser is already permitted to fetch from any origin. Earlier draft framing of "today's CSP assumes single-origin" was wrong.

What's actually env-controlled is `frame-ancestors` (`FRAME_ANCESTORS`) and `frame-src` (`FRAME_SRC`) — both for iframe embedding, not for cross-origin fetches.

So the frontend CSP needs no changes for cross-origin dashboard → sidecar fetches. The cross-origin concern is **CORS configuration on each sidecar** (Q-AUTH-2), not the frontend CSP.

For dashboards: the static bundle's `index.html` (or CloudFront response headers) should set:

- `connectSrc` permissive enough to reach the shared admin-stack service URLs and the mission-asset CloudFront origin. The admin's value of `["*"]` is one option; tightening to specific origins is the more secure default.
- `frame-ancestors` matching the embedder allow-list expected for the dashboard.

### Logging

- Admin: CloudWatch Logs (default for ECS). Winston JSON output flows directly.
- Sidecars: CloudWatch Logs.
- Dashboards: CloudFront standard logs to a logs S3 bucket. No application
  logs — dashboards do not have a backend.

### Secrets

- RDS password, session secret, sidecar tokens, dashboard gate passwords,
  any AWS API keys — Secrets Manager. Rotation can be enabled per-secret.
- Sample env vars like `DB_PASS` continue to be read at runtime by the admin
  task — but their values come from Secrets Manager bindings on the task
  definition, not from a checked-in `.env`.

### Local development

- Docker-compose remains the local-dev environment, unchanged. Phase G's
  ECS task definitions are not used locally.
- `npm run build:static` works locally for testing the static pipeline.

### Tests

- **Playwright covers both unit and e2e** — verified `package.json` has no `jest` configuration; the Playwright suite is the single test runner. The recent commit `chore: extend Playwright to parse TS unit test files` (in branch history) made this explicit. Earlier drafts referencing Jest were stale.
- Existing Playwright suite continues to run against the admin.
- New static-mode Playwright spec: `tests/e2e/static-mode/` boots the
  static bundle and exercises the surviving features per §E.
- Add unit specs (Playwright TS unit format) for `serviceUrls.js` (Phase A.2), the `calls.api` stub branch (Phase C.4), and the publish handler (Phase H).

---

## Open implementation questions (deferred from the ADR)

These are too detailed for the ADR but block execution. Resolve before
starting the corresponding phase.

- **Q-IMPL-1 (Phase A):** Are there existing build-time path constants
  besides those listed in `configuration/paths.js`? Need to verify before
  introducing `STATIC_MISSION_CONFIG` to avoid name collision.
- **Q-IMPL-2 (Phase B):** Exact call-site count for each adjacent service.
  Run a grep before estimating refactor effort.
- **Q-IMPL-3 (Phase C):** Does `LandingPage.js` perform any synchronous computation in its pre-picker init that needs to happen in the short-circuit path? Audit `LandingPage.init` for side effects that fire before the picker renders, since the short-circuit must preserve them. (Scope narrowed by Q-LANDING resolution: no longer need to worry about missions-list computation — there's exactly one mission.)
- **Q-IMPL-4 (Phase C):** The Layers_.js boot-time STAC fetch — does the
  `getSTACLayers` recursion logic need to match exactly in
  `scripts/publish-static.js`, or can it diverge? Audit the function in
  `Layers_.js` for behavior the frontend depends on.
- **Q-IMPL-5 (Phase D):** Webpack's `HtmlWebpackPlugin` interaction with
  `%REACT_APP_*%` placeholders and the v3-flagged unquoted `%HOSTS%` —
  verify behavior under STATIC_MODE before assuming the hardcode workaround
  is sufficient.
- **Q-IMPL-6 (Phase E.5):** Shade tool's data dependencies — pure-client
  over DEM tiles, or server-rendered shadows? Audit `ShadeTool.js`.
- **Q-IMPL-7 (Phase F.1):** Whether to keep `_time_` server-side compositing
  in the admin. Performance / cost evaluation.
- **Q-IMPL-8 (Phase F.2):** Shared mission-asset bucket vs per-dashboard
  copy — pin a default. ADR says shared; verify acceptable for stakeholders.
- **Q-IMPL-9 (Phase G.1):** Custom Dockerfiles for TiTiler / TiTiler-pgSTAC
  to bake in `tilematrixsets/planetcantile_v4` vs. mounted EFS. Default:
  bake.
- **Q-IMPL-10 (Phase G.4):** Exact CORS env-var name for each sidecar image
  version. Verify by inspecting the upstream images.
- **Q-IMPL-11 (Phase H.2):** ECS-spawned-task vs CodeBuild for the publish
  job. Default: ECS RunTask; revisit if CodeBuild ergonomics win out.
- **Q-IMPL-12 (Phase J.1):** Seed-superadmin mechanism — Secrets Manager
  binding, hardcoded credential in IaC, or interactive setup step. Default:
  Secrets Manager.
- **Q-IMPL-13 (Phase A / C):** `STATIC_MODE` env var (clean build-time flag) vs. reusing `mmgisglobal.SERVER = "static"` (activates existing dormant non-node branches in `calls.js` / `essence.js` / `LandingPage.js`). Recommendation: use both — `STATIC_MODE` for build-time DefinePlugin / DCE, `SERVER = "static"` for runtime activation.
- **Q-IMPL-14 (Phase C.4):** Each named call in `src/pre/calls.js`'s `c[]` table needs a per-call static disposition (bake / reroute / drop). The exhaustive disposition table is part of Phase C execution and should be documented in `STATIC_HANDLERS` itself.
- **Q-IMPL-15 (Phase E.3 / E.4):** Confirm whether the backend `/api/utils/getprofile` and `/api/utils/getbands` routes internally delegate to TiTiler (and therefore a direct-to-TiTiler client port is feasible) or do something more complex.
- **Q-IMPL-16 (Phase F.1):** Splitting `middleware.missions(ROOT_PATH)` into a path-translation middleware and a separate `_time_` compositing middleware before the S3 refactor — refactor-style decision, doesn't affect functionality.

---

## Cross-reference

- `adr.md` — the ADR this plan implements. Authority on every "what" and "why."
- `working-plan.md` — workflow doc for this branch.
- `features.md` — per-feature inventory and open questions.
- `decisions.md`, `aws-mapping.md`, `overview.md` — prior decision artifacts;
  this plan absorbs their content into Phase F and Phase G mostly.
- `z-do-not-read/static-mode-plan-v3.md` — prior detailed plan. Not updated on
  this branch. Where it disagrees with this plan, this plan is newer.
