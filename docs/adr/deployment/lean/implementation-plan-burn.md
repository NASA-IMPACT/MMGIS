This is an LLM artifact. It was used during the creation of the ADR to document and track 'settled' topics of future work to provide grounding for planning and understanding feature flux concretely. It should be used as a starting place for both understanding the proposed task and for doing the actual work, but it may not always be correct on the details and should be treated as a draft.

# Implementation plan — burn variant

**Status:** Draft
**Last updated:** 2026-05-20
**Companion to:** [`adr.md`](./adr.md) (D2 = burn). Parallel structure to [`implementation-plan-keep.md`](./implementation-plan-keep.md) — same phase numbering, so the two can be diffed.

This plan deletes the surfaces that don't ship in the lean angle. The repository state after this plan reflects exactly what the team deploys.

The companion features inventory is [`../features.md`](../features.md); per-feature rows are cited as `#NN`.

Each phase has the same structure: **Goal / Files / Operations / Verification / Rollback**.

Conventions:
- All file paths are relative to the repository root.
- "Delete" means `git rm` the file; "Remove" means edit the file to take out a block.
- Code disposition is recorded inline; the dispatcher table contents are deferred to Phase 6.

> **Post-merge baseline (development `4f44d840`).** This plan was re-baselined after merging `development`. See [`merge-impact.md`](./merge-impact.md) for the full delta. Headlines for burn: Phase 6's URL helper **already exists** as `src/essence/Basics/ServiceUrls/ServiceUrls.js` (#63) and the four inline-URL files are **already migrated** to it — consume/adapt it, don't create `serviceUrls.js`; Phase 2's "grep out `/titiler` etc." is now mostly a single point (the `SERVICE_CONFIG` defaults in `ServiceUrls.js`) plus LayerManager's own `lib/utils/titiler.ts`; the build pipeline emits themes to `dist/` and `InterpolateHtmlPlugin` is already wired (Phases 1/6/8); the new `modern-ui` code uses "Dashboard" internally, colliding with Phase 7's "Dashboards" page; the dispatcher count in `calls.js` is **40** (unchanged — the plan's existing count is correct). The backend deletion targets (Phases 2-backend, 3-backend, 4, 5, 9) were untouched by the merge and delete cleanly.

---

## Phase 1 — Pre-work: build flag, env allowlist, baked-config stub

**Goal:** Add the build-time switch that the rest of the plan keys off of, and the empty stub that the publish script will overwrite. No behavior change at this point.

> **Post-merge note:** `InterpolateHtmlPlugin` is already configured in `configuration/webpack.config.js` (it substitutes `%NODE_ENV%` in `public/index.html`) — reuse it for the `SERVER` substitution in Phase 6. The build now also emits a top-level `dist/` of theme assets via `npm run build:themes`, and `webpack.config.js` was reverted toward upstream — start webpack edits from that merged baseline. React is now 19.x with USWDS/TypeScript/Sass added.

**Files:**
- `configuration/env.js`
- `configuration/webpack.config.js`
- `src/pre/staticConfig.js` (new, gitignored)
- `src/essence/Basics/mode.js` (new)
- `.gitignore`

**Operations:**
1. Add the env-var allowlist entries in `configuration/env.js`: `STATIC_MODE`, `STATIC_MISSION_NAME`. (No `STATIC_*_URL` sidecar env vars — no sidecars to point at.)
2. Add a Webpack alias `STATIC_MISSION_CONFIG -> src/pre/staticConfig.js` in `configuration/webpack.config.js`. The file must live under `src/` to satisfy CRA-style `ModuleScopePlugin`.
3. Create `src/pre/staticConfig.js` as a gitignored stub exporting `{}`. The publish script overwrites it; checked-in state is empty.
4. Create `src/essence/Basics/mode.js` exporting a `MODE` constant derived from `window.mmgisglobal.SERVER`. The exported value is `'static'` when `SERVER !== 'node'`, otherwise `'server'`.
5. Add `src/pre/staticConfig.js` and `build-static/` to `.gitignore`.

**Verification:**
- `npm run build` succeeds with no behavior change.
- `import { MODE } from 'src/essence/Basics/mode'` returns `'server'` in dev.

**Rollback:** Revert the four file additions and the env allowlist edit.

---

## Phase 2 — Burn the sidecar proxy

**Goal:** Remove the adjacent-server proxy front door, the spawner, the env-flagged `WITH_*` switches, and the four sidecar directories. After this phase the codebase has no concept of TiTiler / STAC / tipg / veloserver / TiTiler-pgSTAC as in-process services. (#35, #36, #41 in `features.md`.)

> **Post-merge note:** `adjacent-servers/` and the backend proxy were **untouched** by the merge — they delete cleanly as written. But the front-end side of "grep out `/titiler`, `/stac`, …" (Operations step 3) changed shape: #63 **consolidated** the formerly-inline sidecar-URL construction in `Map_.js`/`Layers_.js`/`IdentifierTool.js`/`LayersTool.js` into `src/essence/Basics/ServiceUrls/ServiceUrls.js`. So the same-origin `/<service>` strings now live mainly in that one file's `SERVICE_CONFIG` defaults, plus LayerManager's separate `src/essence/Tools/LayerManager/lib/utils/titiler.ts`. Burn's intent (no same-origin sidecar paths in production) is better served by making `ServiceUrls` resolve **config-only** (return external URL, never construct a local path) than by deleting the helper — the four files depend on it now. Reconcile, don't `git rm`. Also note: the merge added `titiler-url` sourceType + an "External Service URLs" field section to `layer-tile-config.json` — **keep these** (they are how lean missions point at external sidecars); see Phase 3.

**Files:**
- Delete: `adjacent-servers/adjacent-servers-proxy.js`
- Delete: `adjacent-servers/adjacent-servers.js`
- Delete: `adjacent-servers/titiler/`, `adjacent-servers/titiler-pgstac/`, `adjacent-servers/stac/`, `adjacent-servers/tipg/` (note: veloserver is proxy-only and has no vendored directory — only its proxy route needs removing).
- Edit: `scripts/server.js` — remove the `require('../adjacent-servers/adjacent-servers-proxy.js')` and the line(s) where its `setup(app, ...)` is called.
- Edit: `scripts/server.js` — remove the `require('../adjacent-servers/adjacent-servers.js')` spawn-on-boot block.
- Edit: `configuration/env.js` — remove `WITH_TITILER`, `WITH_STAC`, `WITH_TIPG`, `WITH_TITILER_PGSTAC`, `WITH_VELOSERVER`, every `TITILER_*`, `STAC_*`, `TIPG_*`, `VELOSERVER_*` env, and the `ADJACENT_SERVER_CUSTOM_<N>` registry.
- Edit: `API/Backend/Config/setup.js` — the Pug `index.pug` rendering passes `WITH_STAC` / `WITH_TIPG` / `WITH_TITILER` flags into the Configure shell template; remove those passes.
- Delete: `configure/src/pages/STAC/` (the whole directory — `STAC.js` plus its sibling `Modals/`). Also remove the page's registration in `configure/src/components/Main/Main.js` and nav entry in `configure/src/components/Panel/Panel.js`. The STAC tab in Configure exists for the embedded STAC sidecar.
- Delete: `docker-compose.yml` — remove the `stac`, `titiler`, `tipg`, `titiler-pgstac`, `veloserver` services and their `profiles: ["stac"]` / `profiles: ["veloserver"]` entries. The MMGIS app + Postgres services stay.
- Delete: `docker-compose.dev.yml` — same edits as `docker-compose.yml`.
- Delete: `docker-compose.db.yml` mentions of the STAC database initialization. (The `mmgis-stac` database is not created in this angle.)
- Edit: `scripts/init-db.js` — remove the `mmgis-stac` database creation and the `pypgstac migrate` shell-out (the `pgstac` extension itself is provided by the Postgres image, not installed by MMGIS). Leave `btree_gist` alone (it's installed on the main MMGIS DB regardless).
- Edit: `sample.env` — remove all `WITH_*`, `TITILER_*`, `STAC_*`, `TIPG_*`, `VELOSERVER_*`, `TITILER_PGSTAC_*` entries.

**Operations:**
1. Delete the listed files and directories.
2. Edit the listed files to remove proxy mounting, spawning, env-var allowlisting, Pug-flag passing, and Configure UI surface.
3. Grep the repository for any remaining mention of `/titiler`, `/stac`, `/tipg`, `/veloserver`, `/titilerpgstac`, `WITH_TITILER`, etc., and remove. Spot-check known consumers:
   - `src/essence/Basics/Map_/Map_.js`
   - `src/essence/Basics/Layers_/Layers_.js`
   - `src/essence/Tools/Identifier/IdentifierTool.js`
   - `src/essence/Tools/Layers/LayersTool.js`
4. Remove the `API/Backend/Stac/` backend module entirely (the per-route handler that decorates STAC responses with mission/layer occurrences — that decoration runs on the proxy path that no longer exists).

**Verification:**
- `git grep -E 'WITH_TITILER|WITH_STAC|WITH_TIPG|WITH_VELOSERVER|/titiler|/stac|/tipg|/veloserver|adjacent-servers'` returns no hits outside `docs/adr/deployment/preserve/` (which we leave for reference) and `features.md` (the inventory, also kept for reference).
- `npm start` boots without any sidecar-related warnings or errors.
- `npm run build` succeeds.
- `npm test` passes; remove any tests that exist solely for the deleted modules.

**Rollback:** `git revert` the phase. The deleted directories return as-was.

---

## Phase 3 — Burn the Datasets and Geodatasets modules

**Goal:** In lean, the Datasets and Geodatasets modules cease to exist — no routes, no models, no admin UI tabs, no frontend dispatcher entries. Both modules operate exclusively on local Postgres tables that the upload paths populated; with uploads gone, the read paths return nothing useful. Cleaner to delete the surface entirely than to leave dead reads mounted. (#32 in `features.md`.)

This mirrors Phase 5's deletion of the link shortener. Decision driver: every endpoint in both routers operates exclusively on local Postgres — confirmed by inspection (no `fetch`, `axios`, or proxy forwards anywhere in either router). Empty tables = silently-broken features in the frontend.

**Files:**
- Delete: `API/Backend/Datasets/` (the full module — routes, model, setup).
- Delete: `API/Backend/Geodatasets/` (the full module).
- Delete: `configure/src/pages/Datasets/` and `configure/src/pages/GeoDatasets/` (the full subdirectories — Configure SPA convention is `pages/<Name>/<Name>.js` plus any sibling `Modals/`, not a bare `<Name>.js`).
- Edit: `configure/src/components/Panel/Panel.js` (nav buttons) and `configure/src/components/Main/Main.js` (page-switch dispatch) — remove the Datasets and GeoDatasets entries. Note: `configure/src/core/Configure.js` is a layout component, not the route table.
- Edit: `configure/src/core/calls.js` — remove the Datasets and GeoDatasets call definitions entirely.
- Edit: `src/pre/calls.js` — remove `datasets_get`, `geodatasets_get`, `geodatasets_intersect`, `geodatasets_aggregations`, `geodatasets_search`.
- Edit: `src/essence/Basics/Layers_/MetadataCapturer.js` — remove the `calls.api('datasets_get', ...)` call site at line 139 (and any other datasets/geodatasets call sites).
- Edit: `package.json` — remove `busboy`, `csvtojson` if no other consumers; re-run `npm install`.
- Edit: `scripts/server.js` — reduce the `bodyParser` 500 MB cap to the framework default. Draw is the remaining write workload; its JSON payloads fit comfortably.

Note: the Draw module is preserved in lean per the ADR. `API/Backend/Draw/routes/files.js` despite its name does not handle file uploads — it manages drawing-file metadata records in Postgres. No Busboy or multipart parsing in that router (confirmed by grep).

**Other Configure SPA surfaces to handle in burn** (mostly covered by other-phase deletions; called out so the implementer doesn't miss them):

- **COG fields in the layer modal.** `configure/src/metaconfigs/layer-tile-config.json`, `layer-data-config.json`, `layer-image-config.json` declare COG-related fields. The populate-from-cog/info button in `configure/src/core/Maker.js` calls `/api/utils/getbands` (and `/titiler/cog/info`), which don't exist after Phase 2's sidecar burn cleans `getbands` out of the dispatcher. Remove the button from Maker; the fields themselves stay since externally hosted COGs work.
  - **Post-merge note:** grep by line anchor, not the literal "Populate from cog" (that string isn't in the source). The inline same-origin call is at `configure/src/core/Maker.js:1854` (`${origin}/titiler/cog/info?url=...`); the button's result copy is at `Maker.js:579`/`:587`. The merge also added an "External Service URLs" section + `titiler-url` sourceType to `layer-tile-config.json` — **keep those fields**; they are how missions reference external sidecars. Only the populate-helper is removed.
- **Velocity layer type.** `configure/src/components/Main/Modals/LayerModal/LayerModal.js` `allowed` list and `configure/src/metaconfigs/layer-velocity-config.json`. With veloserver excluded, runtime velocity layers fail unless the URL is external. Optional: remove velocity from the `allowed` list, or leave it for advanced operators who supply external URLs. Pick at implementation time.
- **APIs page cards.** `configure/src/pages/APIs/APIs.js` renders cards for STAC, TiTiler, TiTiler-PgSTAC, Tipg. With Phase 2's `WITH_*` env-allowlist deletion, these cards render as `cardInactive` permanently in burn. Either delete the entire page (cleaner, since the underlying services are deleted) or leave it as-is (cards render inactive harmlessly).
- **STAC / Datasets / GeoDatasets row-action icons.** The STAC, Datasets, and GeoDatasets pages are all deleted in burn (Datasets/GeoDatasets in this phase; STAC in Phase 2), so the row-action icons go with them. Nothing extra to do.

**Operations:**
1. Delete the listed directories.
2. Strip the dispatcher entries and the MetadataCapturer call site.
3. Strip the SPA nav entries, pages, and call definitions.
4. Remove the COG-populate button from `Maker.js`; decide velocity-type fate; decide APIs-page fate.
5. Update `package.json`; run `npm install`.
6. Run `npm test`; drop any tests pinned to deleted Datasets/Geodatasets paths.

**Verification:**
- `git grep -E '/api/datasets|/api/geodatasets|datasets_get|geodatasets_'` returns no hits outside the preserve folder and `features.md`.
- `npm start` boots without errors. `/api/datasets/*` and `/api/geodatasets/*` return 404.
- Configure SPA renders without the Datasets and GeoDatasets nav entries.

**Rollback:** `git revert` the phase. Re-install the removed npm deps.

---

## Phase 4 — Burn the `Missions/` middleware and `_time_` compositor

**Goal:** Remove the static-file middleware that serves `/Missions/*`, the path-traversal hardening, and the `sharp`-driven `_time_` time-window compositing. (#26 in `features.md`.) The admin no longer serves mission assets at all.

This is the surface slesa flagged at "section 3.2 Time-composited layers in dashboards" — the server-side compositing logic.

**Files:**
- Delete: `scripts/middleware.js` (the file contains the `missions(ROOT_PATH)` factory and the `_time_` compositor).
- Edit: `scripts/server.js` — remove the import of `./middleware` and the three middleware mounts (`ensureUser()`, `missions(ROOT_PATH)`, `express.static('Missions')`).
- Edit: `package.json` — remove `sharp` from dependencies if no other code consumes it. (Grep first; some legend-rendering paths may.)
- Edit: `sample.env` — remove any `MISSIONS_*` env vars.
- Delete: any `Missions/Demo/` checked-in mission data (the only mission data in the repo is for local dev examples; if `npm run start:prod:with_examples` references them, that path also goes).
- Edit: `package.json` — remove `start:prod:with_examples` if it relied on the checked-in `Missions/` data.

**Operations:**
1. Delete `scripts/middleware.js`.
2. Edit `scripts/server.js`.
3. Audit `package.json` for `sharp` consumers; only delete if no others.
4. Delete or trim the Missions example data; update `.gitignore` to remove `Missions/` if it was tracked.

**Verification:**
- `GET /Missions/whatever` returns 404 from Express.
- `npm test` passes after removing tests targeting `missions()`.
- The local dev server boots and the admin UI works without any `Missions/` content (the mission picker is empty unless seeded via Configure).

**Rollback:** `git revert` the phase. Restore `sharp`.

---

## Phase 5 — Burn the link shortener

**Goal:** Remove the link shortener — no consumers in the lean angle, and the burn variant's value proposition is "the codebase reflects the deployment."

**Webhooks is kept** in lean (decision reversed from the original draft). Reasons: Draw and Config already fire webhooks; the new Dashboards publish/update/delete flow is the most operationally relevant outbound-event source for lean. Phase 7 wires the Dashboards routes to `triggerWebhooks`. No webhook code is deleted, no `triggerwebhooks` call sites are touched.

**Files (link shortener, #34):**
- Delete: `API/Backend/Shortener/`
- Edit: `API/setups.js` — confirm autoload uses directory scan; no edit needed.
- Edit: `sample.env` — remove `DISABLE_LINK_SHORTENER`.

**Operations:**
1. Delete the link-shortener directory.
2. Run `npm test` and drop any tests for the removed module.

**Verification:**
- Routes `/api/shortener/*` return 404 (actual mount path; the plan previously said `/short/*`).
- Webhooks routes (`/api/webhooks`) continue to work; Draw and Config webhook firing is unchanged.

**Rollback:** `git revert` the phase.

---

## Phase 6 — Frontend refactor: dispatcher, sidecar-URL helper, mission-config bake

**Goal:** Activate the dispatcher's dormant `SERVER != 'node'` branch with a bake/reroute/compute/drop table. Adapt the centralized sidecar-URL helper (`ServiceUrls`, already in place and consumed by the four builder files per #63 — see note below) for config-only/static resolution. Generate the baked mission config at publish time. Disable the WebSocket connect and login form in static mode. (#10, #14 in `features.md`.)

**Runtime behavior is variant-invariant — see [`api.md`](./api.md) Frontend dispatcher for the per-call disposition table (all 40 entries with one-line reasons and gap cross-references). The work below is the source-level wiring; burn vs keep only differ in code-cleanup style** (burn removes Drop-disposition entries from `calls.js` and their handlers from `staticHandlers.js`; keep leaves them in place and the dispatcher drops at runtime).

> **Post-merge note — the service-URL helper already exists (#63).** `src/essence/Basics/ServiceUrls/ServiceUrls.js` implements the resolver this phase planned to create (per-layer field → global `mmgisglobal.options.services` → local `/<service>` default, all five sidecars), and the four files below are **already migrated** to it. Remaining burn work is *adapt*, not *create*: (1) make `ServiceUrls` resolve **config-only** in production/static mode (no same-origin `/<service>` fallback — burn has no sidecars to fall back to); (2) add the missing **TiPG/Veloserver builders** (`getTipgUrl`/`getVeloserverUrl` exist at `ServiceUrls.js:80-81` but have no `build*Url` companions); (3) `transformStacUrl` (`src/essence/Basics/Layers_/Layers_.js:322`) is **already migrated by #63** — it resolves via `ServiceUrls.getTiTilerPgStacUrl(layerData)`, so the Animation fix below is done; only the config-only/static behavior in (1) remains; (4) **LayerManager bypasses `ServiceUrls`** via `src/essence/Tools/LayerManager/lib/utils/titiler.ts:1` (same-origin `${origin}${pathname}/titiler`) — route it through `ServiceUrls`/baked config or skip its COG colormap fetch in static mode. The dispatcher core is intact: dormant `if (window.mmgisglobal.SERVER != 'node')` at `src/pre/calls.js:169`; `c` has **40** entries (`calls.js:4-162`) before any burn excision — `api: api` at `calls.js:214` is an export, not a call entry.

**Files:**
- Edit: `public/index.html` — change the `mmgisglobal.SERVER = "node"` literal to a placeholder substituted at build time. **Use `InterpolateHtmlPlugin`** (the same mechanism that handles the existing `%NODE_ENV%` substitution in this file), not `DefinePlugin` — DefinePlugin only rewrites JS bundles, not HTML, and won't work here. In server-mode builds the substituted value is `"node"` (no change); in static-mode builds it's `"static"`.
- Edit: `src/pre/calls.js` — replace the dormant `if (window.mmgisglobal.SERVER != 'node') { console.warn(…); error() }` block with a dispatch into a `STATIC_HANDLERS` table. In the burn variant, also remove every `c[]` entry that gets a Drop disposition per the api.md table.
- New: `src/pre/staticHandlers.js` — one handler per remaining `c[]` entry in `calls.js`, mirroring the disposition table in [`api.md`](./api.md) Frontend dispatcher. Re-grep `calls.js` before locking; today's count is 40 in keep, fewer in burn (Drop entries are excised).
- ~~New: `src/essence/Basics/serviceUrls.js`~~ **Already exists as `src/essence/Basics/ServiceUrls/ServiceUrls.js` (#63).** It already exports `getTiTilerUrl`/`getStacUrl`/`getTipgUrl`/`getVeloserverUrl`/`getTiTilerPgStacUrl` plus `build*Url` helpers (TiPG/Veloserver builders still missing). Burn adapts it to be **config-only in production**: return the external URL from the layer/mission config and never construct a same-origin `/<service>` path (burn has no in-process sidecars). Server-mode same-origin returns remain valid for local dev only.
- ~~Edit the four URL-builder files~~ **Already migrated to `ServiceUrls` by #63:** `src/essence/Basics/Map_/Map_.js`, `src/essence/Basics/Layers_/Layers_.js`, `src/essence/Tools/Identifier/IdentifierTool.js`, `src/essence/Tools/Layers/LayersTool.js`. No re-wiring needed; the remaining work is the static/config-only behavior of `ServiceUrls` itself (above) plus the `transformStacUrl` and LayerManager fixes noted at the top of this phase.
- Edit: `API/updateTools.js` — add a `bakeStaticConfig({ configData, missionsList, generalOptions, mission })` codegen function that writes `src/pre/staticConfig.js` with the mission config frozen as `export default {...}`.
- Edit: `src/essence/LandingPage/LandingPage.js` — short-circuit `init` when `MODE === 'static'`. Skip the mission-picker grid, immediately call `essence.init(...)` with the baked config.
- Edit: `src/essence/essence.js` — when `MODE === 'static'`, don't render the login modal in any flow; treat the user as anonymous read-only.
- Edit: `src/essence/essence.js` — short-circuit the WebSocket setup in static mode. The cleanest gate is the existing `ENABLE_MMGIS_WEBSOCKETS` check (grep for it) or the top of `connectWebSocket` — adding a `MODE === 'static'` short-circuit there beats wrapping the inner handler bodies. This is the layer-update-notification consumer for the main map client. The Configure SPA's WebSocket consumer is admin-only and doesn't ship in dashboards, so no separate edit needed. Draw is not a WebSocket subscriber.
- Edit: `src/essence/Basics/Viewer_/Viewer_.js` — flip `ajaxWithCredentials` to `false` in static mode for OpenSeadragon image-pyramid loads. Anonymous S3 reads fail with credentials on.
- Edit: `scripts/publish-static.js` (Phase 7) — copy the mission's `Missions/<mission>/Data/mosaic_parameters.csv` to the dashboard's S3 bucket root. Photosphere and ModelViewer fetch this path directly without URL templating; absent it, both panes fail silently. Skipped if the mission doesn't use Photosphere or ModelViewer.

**Additional publish-time bakes** (substitute values for dispatcher calls that drop in dashboards):

- **Bake `cogMin` / `cogMax` per single-band COG layer.** `getminmax` is dropped; single-band COG layers render NaN colormap range without baked values. Two implementation paths:
  - *Server-side at publish:* run `gdalinfo` once per `type === 'image'` layer with a `.tif`-style URL; write `cogMin` / `cogMax` into the layer's baked config. Requires GDAL in the publish-task image — **conflicts with Phase 8's Dockerfile strip of micromamba/`adjacent-servers/`**. If this path is chosen, Phase 8 must retain GDAL in the publish-task image.
  - *Client-side at runtime:* if every COG in scope is generated with `-co STATISTICS=YES`, `geotiff.js` can read per-band stats from the IFD without GDAL. Requires authoring discipline on COG generation; preserves the image trim.
  - Call site to silence: `getminmax` call in `src/essence/Basics/Map_/Map_.js` (grep `getminmax`).

- **Bake the projection WKT per mission CRS.** `proj42wkt` is dropped; shapefile export in Layers and Draw tools fails to emit `.prj`. Two implementation paths:
  - *Server-side at publish:* run `proj42wkt.py` once on the mission's proj4 string and bake the WKT into the mission config. Same GDAL/Python dependency concern as cogMin/cogMax.
  - *Client-side at runtime:* `proj4js` (already a dependency) supports proj4 → WKT conversion; do the conversion in the export handler in static mode.
  - Call sites: shapefile export in `src/essence/Tools/Layers/LayersTool.js` and `src/essence/Tools/Draw/DrawTool_Files.js` (grep for `proj42wkt`).

- **Bake `times.json` per time-enabled tile layer.** `query_tileset_times` is dropped; the TimeUI sparkline histogram bars don't render without the count data. At publish, emit a static `times.json` per time-enabled layer listing per-bin tile counts. In static mode, `TimeUI._makeHistogram` reads from that path instead of calling the endpoint.
  - **Open question for this item:** where does the count data come from at publish time? Today's endpoint reads `Missions/<mission>/Layers/<layer>/<time>/` directory listings. In lean the tile pyramid is external. Three options: (a) list the external bucket/prefix at publish time (requires bucket-read perms; works only for S3-hosted pyramids); (b) read a manifest the mission owner provides (push the work upstream); (c) derive from explicit time settings in the mission config. None of these is settled — flag for the implementer or whoever owns mission authoring conventions.
  - Call site to silence: `src/essence/Basics/TimeControl_/TimeUI.js` `_makeHistogram` (grep for `query_tileset_times`).

**Posture for the three items above:** all three have a "GDAL/Python at publish" vs "compute client-side" choice. The plan does not pre-pick; the implementer should make a single decision for all three to keep the image story coherent. **For the burn variant specifically:** if any of the three picks the server-side path, Phase 8's `Dockerfile` strip of micromamba/`adjacent-servers/` has to back off enough to retain GDAL/Python in the publish-task image; this defeats much of the image-size win burn was after. Client-side is the better-aligned default for burn.

**Additional frontend behavior in static mode:**

- **Fix `transformStacUrl` to honor the layer's actual URL.** **✓ Done by #63** — `transformStacUrl` (`Layers_/Layers_.js:322`) already resolves via `ServiceUrls.getTiTilerPgStacUrl(layerData)`; the Animation path inherits it. Only the config-only/static behavior of `ServiceUrls` remains. Original context: the offscreen renderer calls `transformStacUrl(...)` which *previously* built same-origin `/titilerpgstac/...` from `window.location`.
  - Files: `src/essence/Basics/Layers_/Layers_.js` (the `transformStacUrl` function — previous spec cited line 282; re-grep); `src/essence/Tools/Animation/OffscreenMapManager.js` (the callers — previous spec cited lines 499 and 526; re-grep).

- **Mission-deeplink override in static mode.** A dashboard URL with `?mission=other-mission` would attempt to fetch `Missions/other-mission/config.json`, 404, and show "mission not found." `?forcelanding=true` produces an empty mission picker. In static mode (`mmgisglobal.SERVER !== 'node'`) with `MAIN_MISSION` set, ignore both params and force-load the baked mission. Strip the params with `history.replaceState` so they don't propagate to share links.
  - File: `src/essence/LandingPage/LandingPage.js` (the mission-resolution path; previous spec cited lines 11–47 and 324–378; re-grep for `mission` and `forcelanding`).

- **Coordinates-bar elevation column behavior in static mode.** `getbands` is dropped; the coordinates bar's elevation column shows empty per-mousemove. If the Measure-profile gap is resolved with client-side `geotiff.js` against a baked DEM COG, the coordinates bar uses the same code path. Otherwise hide the elevation column in static mode. **Status: blocked on the Measure-tool decision** — implementer should resolve Measure first, then mirror the disposition here.
  - File: `src/essence/Ancillary/Coordinates.js` (the elevation-readout code; previous spec cited lines 600–647; re-grep for `getbands`).

- **Identifier tool: force `trueValue=false` in static mode for plain-`.tif` layers.** `getbands` is dropped; the recursive numeric-value query at `src/essence/Tools/Identifier/IdentifierTool.js:820` 404s. Skip the recursive call when `mmgisglobal.SERVER !== 'node'`. Legend-matched RGB fallback preserves the cursor readout; COG/STAC layers continue to work via external TiTiler / TiTiler-pgSTAC. The tool stays usable; only plain-`.tif` numeric precision is lost.
  - File: `src/essence/Tools/Identifier/IdentifierTool.js` (around the `getbands` call site).

**Operations:**
1. Wire `InterpolateHtmlPlugin` in `configuration/webpack.config.js` to substitute the build mode into `public/index.html`'s `mmgisglobal.SERVER` assignment. Match the existing `%NODE_ENV%` substitution pattern. (`DefinePlugin` doesn't work for HTML — it only rewrites JS bundles.)
2. Implement `STATIC_HANDLERS`.
3. Adapt the existing `src/essence/Basics/ServiceUrls/ServiceUrls.js` to config-only production resolution (the four files are already wired to it per #63, and `transformStacUrl` is already migrated); add TiPG/Veloserver builders; reconcile LayerManager's `lib/utils/titiler.ts`. Grep verifies the only remaining `/titiler|/stac|/tipg` references in `src/` are the intentional `SERVICE_CONFIG` dev defaults in `ServiceUrls.js` (and reconciled LayerManager util) — not scattered inline construction.
4. Implement `bakeStaticConfig`.
5. Implement the LandingPage short-circuit, the `essence.js` login skip, and the WebSocket skip.

**Verification:**
- Server-mode `npm run build` + `npm start` works exactly as today.
- A unit spec: set `STATIC_MODE=true` and a fixture `staticConfig.js`, run the static build, serve `build-static/` with `npx serve`, observe that the page loads without any `/api/*` network calls.
- The dispatcher returns the baked mission config when `get`, `get_generaloptions`, or `missions` is called in static mode.
- The mission picker is not rendered in static mode.
- A WebSocket connection attempt is not made in static mode (DevTools Network shows no ws upgrade).

**Rollback:** `git revert` the phase. Server mode is unaffected; static mode wasn't deployed yet.

---

## Phase 7 — Publish flow: backend module + spawned ECS task + CloudFormation template

**Goal:** Add the admin's Publish and Delete endpoints, the spawned-ECS-task that runs the static build and provisions a per-dashboard CloudFormation stack, and the new `dashboards` Postgres table. (#53, #54, #55 in `features.md`.)

> **Post-merge note — "Dashboards" naming collision (decide before building this page).** The merged `modern-ui` work uses "Dashboard" *internally* for its panel-layout config: `src/essence/Validators/DashboardConfigValidator.js`, `src/essence/Basics/PanelManager_/DashboardConfigFactory.js`, `src/essence/types/dashboard.ts`. User-facing copy was renamed to "Interface," but the code symbols remain. This phase's unrelated "Dashboards" concept (publish page, `dashboards` table, `API/Backend/Dashboards/`) collides. **Open decision:** (a) name the publish concept distinctly — "Publish" / "Deployments" / "Published Apps" — and leave modern-ui untouched (recommended, lower risk), or (b) rename modern-ui's `Dashboard*` symbols to `PanelConfig*`. **Burn-specific:** burn would normally rename to keep the tree clean, but these symbols are freshly merged core code, not lean-only cruft — prefer (a) so burn isn't churning unrelated modern-ui code.
>
> **Post-merge note — published dashboards must boot the modern interface.** A baked mission with `msv.mode: "modern"` boots through `src/essence/modern.js` / `PanelManager_`, not classic. The `static`-mode publish bundle (Phase 6) must support the modern layout path. Add an end-to-end check: publish a `modern`-mode mission and confirm panels render.

**Files:**
- New: `API/Backend/Dashboards/setup.js`
- New: `API/Backend/Dashboards/models/dashboard.js` — Sequelize model. Columns: `id (PK)`, `name (string, unique per mission)`, `mission (string)`, `created_by (FK users)`, `status (enum: provisioning, published, deleting, deleted, failed)`, `stack_arn (string, unique, nullable until CreateStack returns)`, `stack_name (string, derived from id)`, `cloudfront_url (string, cached for list rendering)`, `settings (JSONB)`, `last_error (text, nullable)`, `created_at`, `updated_at`, `deleted_at`. Stack outputs (`bucket_name`, `cloudfront_id`, `function_arn`) are not duplicated into the row — they come from `DescribeStacks` at read time. The password value is not stored per-dashboard; it lives in Secrets Manager and is baked into the Function source at template-render time.
- New: `API/Backend/Dashboards/routes/dashboards.js` — endpoints: `POST /api/dashboards/publish`, `POST /api/dashboards/:id/update`, `DELETE /api/dashboards/:id`, `GET /api/dashboards`, `GET /api/dashboards/:id`. Admin-only via `s.ensureAdmin()` (no-args, matches the precedent in every other JSON router). If long-term-token callers should be blocked too, use `s.ensureAdmin(false, true)` instead (matches the `LongTermToken/setup.js` precedent). **Do not use `s.ensureAdmin(true, false, false)` as previously drafted** — the signature is `(toLoginPage, denyLongTermTokens, allowGets, allowPosts, disallow)`, so those args mean "render login HTML, *allow* long-term tokens, *disallow* GETs," which is the opposite of what's intended for a JSON API. The Update endpoint re-bakes the bundle from the current mission config and PutObjects new assets to the existing bucket; the CloudFront distribution is not replaced. The `GET` paths call `DescribeStacks` for each row's `stack_arn` (batched into one `DescribeStacks` call for the list endpoint) and merge live status into the response. **Fire `triggerWebhooks(...)` from the Publish, Update, and Delete handlers** after the terminal row update — this is the most operationally relevant outbound-event source in lean. Use the same call shape as the existing call sites in `API/Backend/Config/setup.js` and `API/Backend/Draw/routes/draw.js` (`require('../../Webhooks/processes/triggerwebhooks')` then call with an event-type and payload).
- New: `scripts/publish-static.js` — CLI invoked by the spawned ECS task. Arguments: `--dashboard-id` and `--action=publish|update`. Publish sequence: read the dashboard row + mission config from RDS, run `bakeStaticConfig`, spawn Webpack with `STATIC_MODE=true`, render the CloudFormation template via `cfn-template.js`, call `CreateStack`, poll `DescribeStacks` until terminal state, upload `build-static/` contents to the stack's bucket on success, update the row to `published` (or `failed` with the rollback reason surfaced from `DescribeStackEvents`). Update sequence: same up through Webpack, then skip CFN and PutObject the new bundle into the existing bucket, with optional `/index.html` invalidation; update `updated_at`.
- New: `scripts/lib/cfn-template.js` — pure function that returns the CloudFormation template JSON for a dashboard. Inputs: `stackName`, `passwordBase64`. Outputs declared on the stack: `BucketName`, `DistributionDomainName`, `DistributionId`, `FunctionArn`. The Function source is rendered into the template as an inline string with the `EXPECTED_BASIC_AUTH` base64 constant pre-baked. Keep the template in JSON (not YAML) so it round-trips through `JSON.stringify` cleanly.
- New: `scripts/lib/aws-provision.js` — thin wrappers over the AWS SDK so the publish script stays declarative and unit-testable. Functions: `createStack(stackName, templateBody)`, `pollStackUntilTerminal(stackArn, { timeoutMs })`, `describeStack(stackArn)`, `describeStackEvents(stackArn)`, `uploadBundle(bucketName, buildDir)`, `deleteStack(stackArn)`. Modules: `@aws-sdk/client-cloudformation`, `@aws-sdk/client-s3`, `@aws-sdk/client-ecs` (the last used by `routes/dashboards.js` to spawn the publish task). No direct `@aws-sdk/client-cloudfront` use — CloudFormation owns the CloudFront and Function lifecycle.
- New: `configure/src/pages/Dashboards/Dashboards.js` (Configure SPA convention is `pages/<Name>/<Name>.js` per directory) — the admin UI. List dashboards (status from merged Postgres + `DescribeStacks` response), Publish modal (mission picker + name field), Delete confirmation, status-polling indicator.
- Edit: `configure/src/core/calls.js` — add `getDashboards`, `publishDashboard`, `deleteDashboard`, `getDashboard`.
- Edit: `configure/src/components/Main/Main.js` (page-switch dispatch) and `configure/src/components/Panel/Panel.js` (nav buttons) — register the Dashboards page and its nav entry. Note: `configure/src/core/Configure.js` is a layout component, not the route table.

**CloudFormation details to handle in `cfn-template.js` / `aws-provision.js`:**

- The S3 bucket needs `DeletionPolicy: Delete` and the stack template needs to declare it as such, so `DeleteStack` can clean up an empty bucket. Buckets with objects can't be deleted by CFN — the publish task is responsible for clearing the bucket as part of `deleteStack` if rollback is mid-publish; otherwise the dashboard's bucket only has the bundle, and CFN handles it once the publish task empties it. For the lean case (small bundle, no per-dashboard layer data), use a CloudFormation Custom Resource (a one-shot Lambda) declared in the stack template that empties the bucket on stack delete. Alternative: the admin's `DELETE` handler calls `emptyBucket` before `DeleteStack`. We choose the latter — simpler, no Lambda.
- CloudFront Functions in CloudFormation: declare via `AWS::CloudFront::Function` with the source inlined under `FunctionConfig`. CFN handles the two-step `CreateFunction`/`PublishFunction` dance internally.
- The CloudFront distribution declares `FunctionAssociations` pointing at the Function. CFN handles the ordering (Function published before distribution references it).
- Stack create can take 10+ minutes and CFN doesn't always emit `CREATE_COMPLETE` immediately after all resources are ready (final propagation buffer). `pollStackUntilTerminal` should treat any of `CREATE_COMPLETE`, `CREATE_FAILED`, `ROLLBACK_COMPLETE`, `ROLLBACK_FAILED` as terminal and exit promptly.
- Use `Capabilities: ['CAPABILITY_IAM']` on `CreateStack` if the template declares any IAM resources (none in the current shape, but the Custom Resource alternative above would need it).

**Operations:**
1. Implement the Sequelize model. `setups.synced(s)` auto-syncs new models on boot.
2. Implement the router with admin guards. The `publish` endpoint inserts the row in status `provisioning`, computes a deterministic `stack_name` from the dashboard ID (e.g., `mmgis-dashboard-<id>`), calls `ECSClient.runTask({...})` with the dashboard ID as an environment variable, returns the row immediately. The `delete` endpoint marks the row `deleting`, empties the bucket via `aws-provision.js`, calls `DeleteStack`, returns immediately — no spawned task needed because `DeleteStack` itself returns in milliseconds; CloudFormation handles the long teardown asynchronously.
3. Implement `cfn-template.js`. Validate the rendered template against `cfn-lint` in CI so syntax errors don't reach AWS.
4. Implement `publish-static.js` end-to-end. The publish task lives for the duration of the `CreateStack` → `CREATE_COMPLETE` → upload sequence (~10 min). Cross-AWS-account considerations: the spawned task runs under the admin's ECS execution role; that role is scoped per Phase 8.
5. Implement the Configure UI page. The status-polling pattern is net-new for Configure — no other page has it. Poll every 5s while any visible row is in `provisioning` or `deleting`; the response merges row state with `DescribeStacks` output.
6. Render the CloudFront Function source into the template body. Use base64-encoded `username:password` baked into a constant at template-render time so the password isn't passed in as a CloudFormation parameter (CFN parameters are stored on the stack as plaintext and surfaced by `DescribeStacks`).

**Verification:**
- Manual: publish a small mission from Configure, observe the stack reaches `CREATE_COMPLETE` and the dashboard URL appears in the list, open the URL in a browser, see the basic-auth challenge, enter the shared password, see the map render.
- Manual: delete the dashboard, observe the row transition to `deleting`, wait ~30 min, refresh the Dashboards page, observe the row reaches `deleted` once `DescribeStacks` returns "no such stack."
- Manual: introduce a deliberate template error (e.g., reference a missing resource), publish, observe the stack reaches `ROLLBACK_COMPLETE` and the row reflects `failed` with the rollback reason surfaced from `DescribeStackEvents`. Click Delete on the failed row; the rolled-back stack deletes cleanly.
- Integration test: mock the AWS SDK calls in `lib/aws-provision.js` and verify the publish endpoint inserts the row, the task is spawned with the right env vars, and a `getDashboard` response shape merges row + stack outputs correctly.

**Rollback:** `git revert` the phase. Existing stacks in AWS need manual cleanup via the AWS console (list stacks under the `mmgis-dashboard-*` prefix, delete each — CFN handles the teardown ordering).

---

## Phase 8 — ECS task definitions, IAM, GitHub Actions deploy

**Goal:** Land the AWS infrastructure that runs the admin and the publish-task. Define IAM scopes. Add a GitHub Actions workflow for the lean deployment. (Note: CI/CD already runs on GHA today — `docker-build.yml`, `bump-version.yml`, `playwright-tests.yml`, `security-scan.yml`. This phase adds a new deploy workflow alongside them; nothing "moves.")

> **Post-merge note — theme assets.** The merge added a `dist/` theme step: `npm run build:themes` (`scripts/build-themes.sh`) emits `dist/{theme}.css` + fonts/images, and `scripts/build.js` copies `dist/` → `build/dist/`. Both the admin image build **and** the static dashboard publish build (Phase 7's `scripts/publish-static.js`) must run `build:themes` and bake `dist/` into their output, or themed missions ship without CSS/fonts. The Dockerfile strip below removes micromamba/`adjacent-servers/` but must **retain** the theme-build step.

**Conventions for this phase:**

- **`MMGIS_DEPLOYMENT_MODE` injection: runtime ECS env var only.** Set it in the task definition's `environment[]`, not as a Dockerfile build-time arg. The current `Dockerfile` is single-stage; do not introduce multi-stage. Burn doesn't actually need the env var at all (burn = no mode flag), so the admin-task entry below omits it.
- **ECS requires two separate roles per task.** Define them separately:
  - **Task execution role** — used by ECS itself to pull the image, write log streams, and inject env vars from Secrets Manager. Permissions: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `logs:CreateLogStream`, `logs:PutLogEvents`, `secretsmanager:GetSecretValue` (on the DB-credentials and session-secret secrets, for ECS `secrets[]` injection).
  - **Task role** — used by code running inside the container for SDK calls. Permissions vary per task (admin vs publish); listed per role below.
- **Resource ARNs.** The bullets below describe permission *intent*. At implementation time, write explicit ARN templates: `arn:aws:ecs:<region>:<account>:task-definition/<family>:*`, `arn:aws:cloudformation:<region>:<account>:stack/mmgis-dashboard-*/*`, `arn:aws:s3:::mmgis-dashboard-*` (and the `/*` variant for object actions).
- **Outbound HTTPS egress.** The admin ECS task fires `triggerWebhooks(...)` to user-configured external URLs (Draw events, Config saves, and the new Dashboards Publish/Update/Delete events per Phase 7). If the ECS task runs in a private subnet (the standard pattern when CloudFront fronts the ALB), it needs **either a NAT gateway in the VPC, or VPC endpoints for whatever destinations webhooks will fire at**. Without this, webhook calls hang and time out silently — a common "wait, why aren't my webhooks firing" production bug.

**Files:**

- New: `.github/workflows/deploy-lean.yml` — GitHub Actions workflow. Triggers on push to a release branch (or tag — pick the convention; the existing workflows trigger on `master`/`development`/PR/tag/release). Steps: build the MMGIS image, push to ECR, update ECS service. Reuses the action versions/patterns from `docker-build.yml` for consistency.
- New: `infrastructure/ecs/admin-task.json` — admin task definition. Environment variables (database URL from Secrets Manager, session secret from Secrets Manager, admin URL), log driver to CloudWatch. References the admin task execution role and admin task role separately.
- New: `infrastructure/ecs/publish-task.json` — publish-task task definition. Same image as admin (the publish script is in the same repo) but invoked with `node scripts/publish-static.js`. References its own task execution role and a separate (broader) task role.
- New: `infrastructure/iam/admin-task-execution-role.json` — execution-role permissions per "Conventions" above.
- New: `infrastructure/iam/admin-task-role.json` — admin's runtime SDK permissions:
  - `ecs:RunTask` on the publish task definition ARN (so the admin can spawn publish tasks).
  - `iam:PassRole` on both the publish task execution role and the publish task role (required for `RunTask` to attach those roles to the spawned task; missing this is a common gotcha).
  - `cloudformation:DescribeStacks` on `mmgis-dashboard-*` (for the `GET /api/dashboards/*` live-state merge).
  - `cloudformation:DeleteStack` on `mmgis-dashboard-*` and `s3:DeleteObject`, `s3:ListBucket` on `mmgis-dashboard-*` (for the `DELETE` handler's empty-then-delete sequence).
  - `secretsmanager:GetSecretValue` on the dashboards-shared-password secret (if the admin reads it at runtime; if it only flows through ECS `secrets[]` injection, this belongs on the execution role only).
- New: `infrastructure/iam/publish-task-execution-role.json` — execution-role permissions per "Conventions."
- New: `infrastructure/iam/publish-task-role.json` — publish task's runtime SDK permissions: `cloudformation:CreateStack|DescribeStacks|DescribeStackEvents|DeleteStack` on `mmgis-dashboard-*`, plus the resource-creation permissions CloudFormation acts on behalf of: `s3:CreateBucket|PutObject|DeleteBucket|PutBucketPolicy|GetBucketLocation` on `mmgis-dashboard-*`, `cloudfront:CreateDistribution|GetDistribution|UpdateDistribution|DeleteDistribution|CreateFunction|PublishFunction|DescribeFunction|DeleteFunction|GetFunction`. Also `secretsmanager:GetSecretValue` on the dashboards-shared-password secret (read at runtime to bake into the CFN template). **Note:** the previous draft included `rds-db:connect` here — drop it. That permission only applies under RDS IAM authentication, which the current code (in `scripts/server.js`) doesn't use; it relies on `DB_USER`/`DB_PASS` env vars (password auth via Secrets Manager). If the admin ever switches to RDS IAM auth, add `rds-db:connect` then.
- New: `infrastructure/cloudfront-admin.json` — CloudFront distribution config in front of the admin ALB. CF→ALB hop is HTTPS. Attach the AllViewer origin request policy (forwards cookies, headers, query strings — required for login, sessions, and WebSocket headers) and the CachingDisabled cache policy (admin responses must not be cached). Defaults forward nothing; without these, login breaks silently.
- Edit: `scripts/server.js` — change `app.set('trust proxy', 1)` to `app.set('trust proxy', 2)` to match the CF→ALB→ECS hop count. Without this, Express treats CloudFront's IP as the client and `Secure` cookies, rate-limiting, and `X-Forwarded-For` logging all go wrong.
- New: `infrastructure/cloudfront-function.js` — reference source for the password-gate Function. Read by `cfn-template.js` at publish time, embedded as a string into the rendered CloudFormation template with the password constant baked in. Checked in to make the auth logic reviewable independently of the template render.
- Edit: `Dockerfile` — strip the Python micromamba install and the `COPY adjacent-servers/` lines. In burn those directories no longer exist (per Phase 2); the image shrinks accordingly and CI build time drops. Keep the `Dockerfile` single-stage. (Unrelated to `MMGIS_DEPLOYMENT_MODE`, which doesn't apply in burn.)

**Operations:**
1. Author the task definitions. The admin task is a long-running ECS service; the publish task is a one-off `runTask` invocation per publish.
2. Author the IAM roles. Test by simulating a publish with the AWS SDK locally against a staging AWS account.
3. Author the GitHub Actions workflow. The minimum is build-image, push-to-ECR, update-service. Add a deploy-gate (e.g., manual approval on prod) per the team's CI/CD norms.
4. Document the manual prereqs: VPC ID, subnet IDs, hosted zone ID (if D3 = B/C), ACM cert ARN, Secrets Manager entries.

**Verification:**
- Deploy to a staging AWS account. Hit the admin URL; login; configure a mission referencing a public COG URL; publish a dashboard; open the dashboard URL.
- Roll forward and back via the GitHub Actions workflow; observe ECS service updates cleanly.

**Rollback:** Tear down the staging environment by listing stacks under the `mmgis-dashboard-*` prefix and deleting each via the AWS console or `aws cloudformation delete-stack` from a workstation.

---

## Phase 9 — Hardening: DB-down boot, first-signup, superadmin

**Goal:** Address the two open concerns from the ADR that survive the move to CloudFormation — admin boot when Postgres is unreachable, and the first-superadmin / `first_signup` security gap — plus the latent WebSocket idle-timeout footgun in the existing code. The teardown-reliability concern is dropped because CloudFormation owns the resource-lifecycle dance; the live-reads pattern from Phase 7 surfaces stuck stacks in the UI without a separate reconcile job.

**Files:**
- Edit: `scripts/init-db.js` — **introduce** a bounded retry loop on the initial Sequelize connect (e.g., 10 attempts × 5s = 50s), then exit non-zero with a clear log on exhaustion. Current code is single-shot (`new Sequelize(...)` + serial `.authenticate()`/`.query()`); there is no existing loop to "wrap." The ECS task definition's restart policy then takes over; ECS will mark the task unhealthy and the service will retry, giving RDS room to recover.
- Edit: `scripts/init-db.js` — when `process.env.SEED_SUPERADMIN_USERNAME` and `SEED_SUPERADMIN_PASSWORD` are present (injected from Secrets Manager), create the user with permission `"111"` if no users exist. Idempotent — does nothing if a user with that username already exists. Note: `init-db.js` does not import the `User` model today; the existing `User.count()` / first-user logic lives in `API/Backend/Users/routes/users.js`. The seed implementation needs to either import the model into `init-db.js` (new dependency) or run raw SQL against the `users` table.
- Edit: `API/Backend/Users/routes/users.js` — delete the `POST /api/users/first_signup` route entirely. The seed mechanism above replaces it.
- Edit: `public/adminlogin.js` — remove the `/api/users/first_signup` call. This is a public bootstrap page (separate from the Configure SPA) that historically hit `first_signup` to create the very first admin; with the seed mechanism it's no longer needed. `grep -n first_signup public/adminlogin.js` to confirm before editing.
- Edit: `API/websocket.js` — add a server-side ping/pong heartbeat on `wss`. On each tick (default 30s, configurable via `WEBSOCKET_PING_INTERVAL_MS`), iterate `wss.clients`: if a client did not pong since the previous tick, `ws.terminate()`; otherwise mark it unresponsive and call `ws.ping()`. Register a `pong` handler on each connection that clears the unresponsive mark. Clear the interval on `wss.close`. The existing code has no heartbeat, leaving the WS vulnerable to any 60s-idle intermediary (ALB default, NAT, corporate proxy, mobile carrier).
- Optional: rename the misleading `webSocketPingInterval` field in `src/essence/essence.js` (line 137) and `configure/src/core/Websocket.js` (line 12) to `webSocketReconnectInterval`. Both are reconnect timers despite the name — the rename is documentation, no functional change. No client-side ping code is needed; the browser `WebSocket` API answers server pings automatically.

**Operations:**
1. Implement the retry loop in `init-db.js`. Test with Postgres down; observe bounded retries; observe the ECS service marks the task unhealthy after the retries fail.
2. Implement the superadmin seed. Test on a fresh database.
3. Delete `first_signup`. Spot-check that the Configure SPA's signup flow doesn't reference it (it shouldn't; the public route was for the bootstrap case only).
4. Implement the server-side heartbeat. Document `WEBSOCKET_PING_INTERVAL_MS` in `sample.env`.

**Verification:**
- Bring Postgres down, restart the admin ECS task, observe the bounded retry and the clean failure mode.
- Verify `POST /api/users/first_signup` returns 404.
- Verify the superadmin user exists in Postgres after a fresh deploy.
- Open the admin, leave Configure idle for 10+ minutes behind the ALB. WS stays connected; no "Websocket disconnected" banner; Essence's `LayerUpdatedControl` does not enter the `DISCONNECTED` state. ALB CloudWatch `IdleTimeoutClosedConnectionCount` does not increment for the admin target group on the WS path.
- Local repro behind a deliberate 60s-idle reverse proxy (e.g. nginx with `proxy_read_timeout 60s`): the heartbeat keeps the connection alive across the 60s window.

**On stuck stacks.** Failed publishes (`CREATE_FAILED`, `ROLLBACK_COMPLETE`) and failed deletes (`DELETE_FAILED`) surface in the Dashboards page via the live-state pattern from Phase 7. The default escape hatch is: an admin clicks Delete on the failed row, which calls `DeleteStack`; CloudFormation either succeeds (rolled-back stacks are deletable) or returns `DELETE_FAILED`, in which case the admin opens the AWS console and resolves manually. If this becomes a recurring operational burden, follow up with a stack-events-via-SNS update path (out of scope for this plan).

**Rollback:** `git revert` the phase. The system returns to today's "hard gate on DB" and the now-deleted `first_signup`.

---

## Phase 10 — Cleanup pass

**Goal:** Catch what the burn left behind. Re-grep, prune docs, prune dead code paths discovered during the implementation.

**Operations:**
1. `git grep -E 'WITH_|ADJACENT|adjacent-server|titiler|stac|tipg|veloserver|busboy|csvtojson|sharp|Missions/'` over the whole tree. Each hit is either a) intentional (this plan, the `features.md` inventory, the preserve folder, comments) or b) cleanup. Resolve each. **Post-merge note:** `titiler`/`stac`/`tipg`/`veloserver` now legitimately appear in merged core code that burn does **not** delete — `src/essence/Basics/ServiceUrls/ServiceUrls.js` (the external-service resolver, kept; reconciled to config-only per Phase 6) and `src/essence/Tools/LayerManager/lib/utils/titiler.ts` (kept; reconciled). Treat those as intentional, not cleanup targets — burn removes the in-process sidecars, not the ability to reference external ones.
2. Audit the `configure/` SPA for orphaned routes after removing STAC, Datasets-upload, Dashboards-WebHooks pages. The router will silently 404 on a navigation to a removed page; better to remove the route entries.
3. Audit `sample.env` and `.env.example` files; remove every env that no longer has a consumer.
4. Update README.md and `AGENTS.md` to reflect the post-burn deployment posture. Remove the "Docker Compose" section's references to optional sidecar profiles.
5. Update `docs/` Jekyll site references. Same edits.
6. **Known dead-code candidate: `spatial_published`.** Only call site is `src/essence/Ancillary/QueryURL.js:145` (in the `rmcxyzoom` URL-param branch). Success callback is `console.log(d)`; error callback is `console.warn(d)`. Response is never consumed — no state mutation, no map move, no `L_.FUTURES` update. Backend handler is plugin-provided (no `API/Backend/Spatial/` in repo). Safe to remove the entire `rmcxyzoom` block in `QueryURL.js` and the `spatial_published` entry from `src/pre/calls.js`; no production behavior depends on it.

**Verification:**
- `git grep -E '...'` returns zero unintended hits.
- README rebuilds; Jekyll docs build.
- `npm start` + `npm run build` + `npm test` all green on a fresh clone.

**Rollback:** N/A — cleanup is incremental.

---

## What this plan does *not* cover

- Mission-config validation tooling for lean configs (a mission with sidecar URL references should fail validation early). Suggest a separate small feature later.
- Mission-config schema migration tooling for missions authored against today's MMGIS data model (raster filesystem references, sidecar URLs).
- VEDA-microservice URL conventions and per-feature client-side adapters (these are mission-config authoring concerns, not MMGIS deployment).
- Data-residency / cross-account audit logging for dashboards published outside our AWS organization.

These are tracked outside this plan.
