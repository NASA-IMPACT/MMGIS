This is an LLM artifact. It was used during the creation of the ADR to document and track 'settled' topics of future work to provide grounding for planning and understanding feature flux concretely. It should be used as a starting place for both understanding the proposed task and for doing the actual work, but it may not always be correct on the details and should be treated as a draft.

# Implementation plan — keep variant

**Status:** Draft
**Last updated:** 2026-05-20
**Companion to:** [`adr.md`](./adr.md) (D2 = keep, env-gated). Parallel structure to [`implementation-plan-burn.md`](./implementation-plan-burn.md) — same phase numbering, so the two can be diffed.

This plan leaves the existing surfaces in the codebase and gates each on a deployment-mode environment variable. After this plan, the original NASA-AMMOS deployment continues to work with `MMGIS_DEPLOYMENT_MODE` unset (or `=full`); the lean deployment sets `MMGIS_DEPLOYMENT_MODE=lean` and gets the smaller surface.

The companion features inventory is [`../features.md`](../features.md); per-feature rows are cited as `#NN`.

Each phase has the same structure: **Goal / Files / Operations / Verification / Rollback**.

Conventions:
- All file paths are relative to the repository root.
- "Gate" means add a runtime conditional on `MMGIS_DEPLOYMENT_MODE`.
- Two valid values: `full` (default, preserves today's behavior) and `lean` (the lean mode). The default must remain `full` so upstream users see no change.
- A central helper `API/utils/deploymentMode.js` exports `isLean()`, `isFull()`, `assertLean()`, etc. Use it instead of reading `process.env.MMGIS_DEPLOYMENT_MODE` directly.

---

## Phase 1 — Pre-work: deployment-mode helper, build flag, env allowlist, baked-config stub

**Goal:** Add the deployment-mode gate the rest of the plan keys off of, the build-time switch, and the empty stub the publish script overwrites. No behavior change for full deployments at this point.

**Files:**
- `configuration/env.js`
- `configuration/webpack.config.js`
- `API/utils/deploymentMode.js` (new) — exports `isLean()`, `isFull()`, `assertLean()`, `MODE` constant. Defaults to `full`. Add a frozen object to prevent re-evaluation per call.
- `src/pre/deploymentMode.js` (new) — client-side counterpart, exporting the same constants. Reads from `mmgisglobal.SERVER` (`"node"` → `full`, `"static"` → `lean`-published-dashboard, anything else → error).
- `src/pre/staticConfig.js` (new, gitignored stub)
- `src/essence/Basics/mode.js` (new) — re-exports `src/pre/deploymentMode.js` for older consumers.
- `.gitignore`
- `sample.env`

**Operations:**
1. Add the env-var allowlist entries in `configuration/env.js`: `MMGIS_DEPLOYMENT_MODE`, `STATIC_MODE`, `STATIC_MISSION_NAME`. Keep all existing `WITH_*`, `TITILER_*`, `STAC_*`, `TIPG_*`, `VELOSERVER_*` entries — full mode still needs them.
2. Add a Webpack alias `STATIC_MISSION_CONFIG -> src/pre/staticConfig.js` in `configuration/webpack.config.js`.
3. Create `src/pre/staticConfig.js` as a gitignored stub exporting `{}`. The publish script overwrites it.
4. Create the deployment-mode helpers (`API/utils/deploymentMode.js`, `src/pre/deploymentMode.js`).
5. Add `MMGIS_DEPLOYMENT_MODE=full` to `sample.env` with a comment explaining the two modes and the upstream-compat default.
6. Add `src/pre/staticConfig.js` and `build-static/` to `.gitignore`.

**Verification:**
- `npm run build` succeeds with no behavior change.
- `MMGIS_DEPLOYMENT_MODE` unset: `isFull()` returns `true`, `isLean()` returns `false`.
- `MMGIS_DEPLOYMENT_MODE=lean`: `isLean()` returns `true`.
- Unknown values throw at startup with a clear error.

**Rollback:** Revert the new files and env-allowlist edits.

---

## Phase 2 — Gate the sidecar proxy

**Goal:** Leave the adjacent-server proxy in place. In `lean` mode the proxy front door does not register any routes, and the on-boot spawner is suppressed. The `WITH_*` env vars remain meaningful in `full` mode. (#35, #36, #41 in `features.md`.)

**Files:**
- Edit: `adjacent-servers/adjacent-servers-proxy.js` — wrap the route registration in `if (isFull()) { ... }`. The module's `setup(app, ...)` becomes a no-op in `lean` mode. Add a clear log: `"adjacent-servers proxy disabled (deployment mode = lean)"`.
- Edit: `adjacent-servers/adjacent-servers.js` — same gate around the child-process spawning.
- Edit: `scripts/server.js` — leave the require + setup call intact; the gate is in the module.
- Edit: `API/Backend/Config/setup.js` — the Pug `index.pug` flags (`WITH_STAC`, `WITH_TIPG`, `WITH_TITILER`) continue to be passed; in `lean` mode they are forced to `false` regardless of env. The Configure SPA already honors these flags (it hides the STAC tab when `WITH_STAC=false`); no Configure edit needed.
- Leave `configure/src/pages/STAC/` (the directory — `STAC.js` plus sibling `Modals/`) intact; the page is reached only when the STAC tab is visible.
- Edit: `docker-compose.yml`, `docker-compose.dev.yml` — leave the sidecar services intact under their existing `profiles: ["stac"]` / `profiles: ["veloserver"]` gates. The lean deployment doesn't use docker-compose in production; local dev can still spin up the sidecars when needed.
- Edit: `scripts/init-db.js` — in `lean` mode, skip the `mmgis-stac` database creation and the `pypgstac migrate` shell-out (the `pgstac` extension itself comes from the Postgres image, not from MMGIS). In `full` mode (default) the existing behavior is preserved.

**Operations:**
1. Apply the gates above. Default mode keeps every full path intact.
2. Spot-check that `lean` mode boots without any sidecar warnings, errors, or HTTP route registrations under `/titiler`, `/stac`, `/tipg`, `/titilerpgstac`, `/veloserver`.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean npm start`: `/titiler` etc. return 404.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset) + `WITH_TITILER=true` + a TiTiler at localhost:8883: `/titiler/...` still proxies as before.
- `mmgis-stac` database is not created when `lean` mode is set on a fresh deploy.

**Rollback:** Revert the gate edits; default behavior remains intact regardless because the gates default to `full`.

---

## Phase 3 — Gate the Datasets and Geodatasets modules

**Goal:** In `lean` mode, the Datasets and Geodatasets modules don't mount at all — no upload, no read, no admin UI tab. Both modules operate exclusively on local Postgres tables that get populated by uploads (which lean disables), so without uploads the read paths return empty and are dead weight. In `full` mode, both modules work unchanged. (#32 in `features.md`.)

This mirrors the whole-module gating pattern Phase 5 uses for Shortener. Decision driver: every endpoint in `API/Backend/Datasets/routes/datasets.js` and `API/Backend/Geodatasets/routes/geodatasets.js` operates exclusively on local Postgres — confirmed by inspection (no `fetch`, `axios`, or proxy forwards anywhere in either router). Empty tables in lean = silently-broken features. A clean 404 on the route is better than a "success: []" that the frontend renders as missing data.

**Files:**
- Edit: `API/Backend/Datasets/setup.js` — wrap the route mount in `if (isFull())`. The model still syncs in both modes (Sequelize creates the table on boot), so a future mode flip doesn't need a migration.
- Edit: `API/Backend/Geodatasets/setup.js` — same.
- Edit: `scripts/server.js` — leave the `bodyParser` 500 MB cap in place. The cap is still meaningful in `full` mode for Datasets payloads.
- Edit: `configure/src/pages/Datasets/Datasets.js` and `configure/src/pages/GeoDatasets/GeoDatasets.js` (Configure SPA convention is `pages/<Name>/<Name>.js` per directory) — hide the tabs from the SPA's nav when `DEPLOYMENT_MODE === 'lean'`. The tab nav lives in `configure/src/components/Panel/Panel.js`; page dispatch lives in `configure/src/components/Main/Main.js`. Plumb the `DEPLOYMENT_MODE` hint through `API/Backend/Config/setup.js` as a sibling Pug shell flag (alongside the existing `WITH_*` flags).
- Edit: `configure/src/core/calls.js` — leave the call definitions in place; the routes they target won't mount in lean, but the call defs are harmless dead code.

**Other Configure SPA surfaces to gate in lean** (silently broken otherwise — admins can author layers and features the dashboard can't render):

- **COG fields in the layer modal.** `configure/src/metaconfigs/layer-tile-config.json`, `layer-data-config.json`, `layer-image-config.json` declare COG-related fields. The "Populate from cog/info" button (in `configure/src/core/Maker.js` — grep `Populate from cog`) calls `/api/utils/getbands`, which is dropped in lean. Hide the button in lean mode (it's a Maker render branch keyed on the field type). The fields themselves can stay since externally hosted COGs work — the gating is just about the populate-helper, not the layer type.
- **Velocity layer type.** `configure/src/components/Main/Modals/LayerModal/LayerModal.js` (the `allowed` list of layer types) and `configure/src/metaconfigs/layer-velocity-config.json`. No Configure-side break here, but runtime velocity layers fail unless the URL is static/external (the legacy `/veloserver/...` proxy is dropped). Optional: warn at save-time in lean if a velocity layer's URL points at a sidecar path; non-blocking.
- **APIs page cards.** `configure/src/pages/APIs/APIs.js` renders cards for STAC, TiTiler, TiTiler-PgSTAC, and Tipg. The cards already render as `cardInactive` when their respective `WITH_*` flag is false. Verify Phase 2 actually forces those flags to false in lean (it does — the keep Phase 2 edit forces them at the Pug shell), and add a confirmation verification step.
- **Row-action icons in STAC / Datasets / GeoDatasets pages.** Update (`UploadIcon`), Append (`ControlPointDuplicateIcon`), Import (`UploadIcon`), Export (`DownloadIcon`) buttons in `configure/src/pages/STAC/STAC.js`, `configure/src/pages/Datasets/Datasets.js`, and `configure/src/pages/GeoDatasets/GeoDatasets.js`. Some of these surfaces are already hidden via the whole-page gating above (Datasets/GeoDatasets pages don't render in lean), but STAC's row actions are not — gate the upload/append/import buttons in `STAC/STAC.js` on `DEPLOYMENT_MODE === 'lean'`. The Export button can stay (read-only, harmless).

Note: the Draw module is preserved in lean per the ADR and is not affected by this phase. `API/Backend/Draw/routes/files.js` despite its name does not handle file uploads — it manages drawing-file *metadata records* in Postgres. No Busboy, multipart, or filesystem writes in that router (confirmed by grep).

**Operations:**
1. Apply the whole-module gates in the two `setup.js` files.
2. Add the `DEPLOYMENT_MODE` Pug flag and plumb to the SPA's Redux store at boot.
3. Hide the Datasets and GeoDatasets nav entries when `DEPLOYMENT_MODE === 'lean'`.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean`: every `/api/datasets/*` and `/api/geodatasets/*` endpoint returns 404; Datasets and GeoDatasets tabs not visible in Configure.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset): both modules work as today.

**Rollback:** Revert the `setup.js` gates and the Configure SPA tab-hiding edits. Default mode is `full` so behavior returns to today's.

---

## Phase 4 — Gate the `Missions/` middleware and `_time_` compositor

**Goal:** In `lean` mode, the admin does not mount the `Missions/` static middleware or the `_time_` compositor. In `full` mode the existing 3-middleware stack is unchanged. (#26 in `features.md`.) The compositor logic is preserved for the upstream team and for any future opt-in.

This is the surface slesa flagged at "section 3.2 Time-composited layers in dashboards" — the keep variant preserves the code so the discussion can be revisited.

**Files:**
- Edit: `scripts/server.js` — wrap the three middleware mounts (`ensureUser()`, `missions(ROOT_PATH)`, `express.static('Missions')`) in `if (isFull()) { ... }`.
- `scripts/middleware.js` — unchanged. The factory still exists; it just isn't mounted in `lean` mode.
- Edit: `sample.env` — document that `MISSIONS_*` env vars apply only to `full` mode.
- Edit: `package.json` — `sharp` stays in dependencies (the full-mode compositor uses it).

**Operations:**
1. Apply the mount-time gate in `scripts/server.js`.
2. Document in code comments which features depend on `full` mode.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean`: `GET /Missions/whatever` returns 404 from Express (no middleware mounted).
- `MMGIS_DEPLOYMENT_MODE=full`: existing behavior — file served (or path-traversal error).
- `_time_` URLs in `full` mode still composite via `sharp`.

**Rollback:** Revert the gate edit; `full` mode is the default.

---

## Phase 5 — Trim the link shortener in lean mode

**Goal:** The link shortener has no meaningful role in the lean deployment; gate its route mounting on `full` mode so the admin URL surface is smaller in `lean`.

**Webhooks is kept** in lean (decision reversed from the original draft). Reasons: Draw and Config already fire webhooks; the new Dashboards publish/update/delete flow is the most operationally relevant outbound-event source for lean (external CI/CD, monitoring, audit systems often want to know). Phase 7 wires the Dashboards routes to `triggerWebhooks`. No webhook code is gated.

**Files (link shortener, #34):**
- Edit: `API/Backend/Shortener/setup.js` — wrap the route mount in `if (isFull())`. The model and routes remain in the repo.

**Operations:**
1. Apply the gate.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean`: shortener routes return 404.
- `MMGIS_DEPLOYMENT_MODE=full`: existing behavior.
- Webhooks routes work in both modes.

**Rollback:** Revert the gate edit.

---

## Phase 6 — Frontend refactor: dispatcher, sidecar-URL helper, mission-config bake

**Goal:** Activate the dispatcher's dormant `SERVER != 'node'` branch with a bake/reroute/compute/drop table. Centralize the inline sidecar-URL builders in four files into one helper. Generate the baked mission config at publish time. Disable the WebSocket connect and login form in static mode. The activations are tied to the build mode (`static` vs `server`), independent of the server-side `MMGIS_DEPLOYMENT_MODE`. (#10, #14 in `features.md`.)

**Note:** This phase is structurally identical to the burn variant's Phase 6. The frontend code doesn't need a `full/lean` runtime gate because dashboard builds always run in `static` mode and admin builds always run in `server` mode. The helper's reroute handling table is what holds the runtime difference.

**Files:**
- Edit: `public/index.html` — change the `mmgisglobal.SERVER = "node"` literal to a placeholder substituted at build time. **Use `InterpolateHtmlPlugin`** (the same mechanism that handles the existing `%NODE_ENV%` substitution in this file), not `DefinePlugin` — DefinePlugin only rewrites JS bundles, not HTML. Server-mode build substitutes `"node"`; static-mode build substitutes `"static"`.
- Edit: `src/pre/calls.js` — replace the dormant `if (window.mmgisglobal.SERVER != 'node') { console.warn(…); error() }` block with a dispatch into a `STATIC_HANDLERS` table.
- New: `src/pre/staticHandlers.js` — bake/reroute/compute/drop entries keyed by `c[]` name in `calls.js`. See Operations step 2 for the per-call mapping. Note: `calls.js` has **40 entries** today; every entry needs a disposition. Verify with `grep -E '^    [a-zA-Z0-9_]+: \{$' src/pre/calls.js | wc -l` (a `[a-z_]+` pattern silently misses `ll2aerll` and `proj42wkt` because they have digits).
- New: `src/essence/Basics/serviceUrls.js` — helper exporting per-service URL functions. Server-mode return value: same-origin paths (so full MMGIS admin still hits `/titiler`). Static-mode return value: the absolute URL from the baked config.
- Edit: `src/essence/Basics/Map_/Map_.js`, `src/essence/Basics/Layers_/Layers_.js`, `src/essence/Tools/Identifier/IdentifierTool.js`, `src/essence/Tools/Layers/LayersTool.js` — replace inline interpolations with helper calls.
- Edit: `API/updateTools.js` — add `bakeStaticConfig` codegen.
- Edit: `src/essence/LandingPage/LandingPage.js` — short-circuit `init` in static mode.
- Edit: `src/essence/essence.js` — login modal skipped in static mode.
- Edit: `src/essence/essence.js` — short-circuit the WebSocket layer-update consumer in static mode. Cleanest gate is the existing `ENABLE_MMGIS_WEBSOCKETS` check or the top of `connectWebSocket` (grep for either); avoid wrapping the inner handler bodies.
- Edit: `src/essence/Basics/Viewer_/Viewer_.js` — flip `ajaxWithCredentials` to `false` in static mode for OpenSeadragon image-pyramid loads. Anonymous S3 reads fail with credentials on.
- Edit: `scripts/publish-static.js` (Phase 7) — copy the mission's `Missions/<mission>/Data/mosaic_parameters.csv` to the dashboard's S3 bucket root. Photosphere and ModelViewer fetch this path directly without URL templating; absent it, both panes fail silently. Skipped if the mission doesn't use Photosphere or ModelViewer.

**Additional publish-time bakes** (substitute values for dispatcher calls that drop in dashboards):

- **Bake `cogMin` / `cogMax` per single-band COG layer.** `getminmax` is dropped; single-band COG layers render NaN colormap range without baked values. Two implementation paths:
  - *Server-side at publish:* run `gdalinfo` once per `type === 'image'` layer with a `.tif`-style URL; write `cogMin` / `cogMax` into the layer's baked config. Skip if both present. Requires GDAL in the publish-task image (in burn this conflicts with the Dockerfile strip — Phase 8 needs to retain GDAL or pick the client-side path).
  - *Client-side at runtime:* if every COG in scope is generated with `-co STATISTICS=YES`, `geotiff.js` can read per-band stats from the IFD without GDAL. Requires authoring discipline on COG generation; removes the image-trim conflict.
  - Mission-config call site to silence either way: the `getminmax` call in `src/essence/Basics/Map_/Map_.js` (search for `getminmax`; the previous spec cited lines 2008–2042 — re-grep).

- **Bake the projection WKT per mission CRS.** `proj42wkt` is dropped; shapefile export in Layers and Draw tools fails to emit `.prj`. Two implementation paths:
  - *Server-side at publish:* run `proj42wkt.py` once on the mission's proj4 string and bake the WKT into the mission config. Same GDAL/Python dependency concern as cogMin/cogMax.
  - *Client-side at runtime:* `proj4js` (already a dependency) supports proj4 → WKT conversion; do the conversion in the export handler in static mode.
  - Call sites: shapefile export in `src/essence/Tools/Layers/LayersTool.js` and `src/essence/Tools/Draw/DrawTool_Files.js` (grep for `proj42wkt`).

- **Bake `times.json` per time-enabled tile layer.** `query_tileset_times` is dropped; the TimeUI sparkline histogram bars don't render without the count data. At publish, emit a static `times.json` per time-enabled layer listing per-bin tile counts. In static mode, `TimeUI._makeHistogram` reads from that path instead of calling the endpoint.
  - **Open question for this item:** where does the count data come from at publish time? Today's endpoint reads `Missions/<mission>/Layers/<layer>/<time>/` directory listings. In lean the tile pyramid is external. Three options to pick from before this item is implementable: (a) list the external bucket/prefix at publish time (requires bucket-read perms; works only for S3-hosted pyramids); (b) read a manifest the mission owner provides (push the work upstream to mission authoring); (c) derive from explicit time settings in the mission config if those carry enough information. None of these is settled — flag for the implementer or whoever owns mission authoring conventions.
  - Call site to silence: `src/essence/Basics/TimeControl_/TimeUI.js` `_makeHistogram` (grep for `query_tileset_times` or `_makeHistogram`).

**Posture for the three items above:** all three have a "GDAL/Python at publish" vs "compute client-side" choice. The plan does not pre-pick; implementer should make a single decision for all three to keep the image story coherent. If client-side wins, Phase 8's `Dockerfile` strip can stay aggressive in burn and the keep image trim is feasible too. If server-side wins, both Phase 8 plans must retain GDAL/Python in the publish-task image.

**Additional frontend behavior in static mode:**

- **Fix `transformStacUrl` to honor the layer's actual URL.** The Animation tool's offscreen renderer calls `transformStacUrl(...)` which today builds same-origin `/titilerpgstac/...` paths from `window.location`. Dashboards have no such route; the regular layer renderers already honor external URLs, but the animation pathway does not. Make `transformStacUrl` read the STAC endpoint from the layer config instead. After this, any layer whose mission config points at an external TiTiler-pgSTAC works in the Animation tool unchanged. **Side benefit:** also unbreaks the Animation tool for any full-mode deployment where STAC happens to not be same-origin.
  - Files: `src/essence/Basics/Layers_/Layers_.js` (the `transformStacUrl` function — previous spec cited line 282; re-grep); `src/essence/Tools/Animation/OffscreenMapManager.js` (the callers — previous spec cited lines 499 and 526; re-grep).

- **Mission-deeplink override in static mode.** A dashboard URL with `?mission=other-mission` would attempt to fetch `Missions/other-mission/config.json`, 404, and show "mission not found." `?forcelanding=true` produces an empty mission picker. In static mode (`mmgisglobal.SERVER !== 'node'`) with `MAIN_MISSION` set, ignore both params and force-load the baked mission. Strip the params with `history.replaceState` so they don't propagate to share links. Other URL params (`?on=`, `?mapLat=`, etc.) continue to work.
  - File: `src/essence/LandingPage/LandingPage.js` (the mission-resolution path; previous spec cited lines 11–47 and 324–378; re-grep for `mission` and `forcelanding`).

- **Coordinates-bar elevation column behavior in static mode.** `getbands` is dropped; the coordinates bar's elevation column shows empty per-mousemove. If the Measure-profile gap is resolved with client-side `geotiff.js` against a baked DEM COG, the coordinates bar uses the same code path. Otherwise hide the elevation column in static mode. **Status: blocked on the Measure-tool decision** — implementer should resolve Measure first, then mirror the disposition here.
  - File: `src/essence/Ancillary/Coordinates.js` (the elevation-readout code; previous spec cited lines 600–647; re-grep for `getbands`).

**Operations:**
1. Wire `InterpolateHtmlPlugin` in `configuration/webpack.config.js` to substitute `mmgisglobal.SERVER` in `public/index.html`. Match the existing `%NODE_ENV%` substitution pattern.
2. Implement `STATIC_HANDLERS`. Per-call handling for the 40 entries in `calls.js`:
   - **Bake**: `get`, `get_generaloptions`, `missions` (the mission-config calls)
   - **Compute**: `query_tileset_times` (use baked `tilesetTimes`)
   - **Reroute** (mission-config-driven, optional): `getbands`, `getprofile`, `proj42wkt` can point at the full admin's same-origin endpoints if a dashboard's audience happens to host one nearby. The table gives the mission the option; it's not a hard route.
   - **Drop** (everything else): `login`, `signup`, `logout`, all 7 `draw_*` (`draw_add`, `draw_edit`, `draw_remove`, `draw_undo`, `draw_merge`, `draw_split`, `draw_aggregations`), all 10 `files_*` (`files_getfiles`, `files_getfile`, `files_make`, `files_remove`, `files_restore`, `files_change`, `files_modifykeyword`, `files_compile`, `files_publish`, `files_gethistory`), both `shortener_*`, `datasets_get`, all 4 `geodatasets_*` (`geodatasets_get`, `geodatasets_intersect`, `geodatasets_aggregations`, `geodatasets_search`), `spatial_published`, `tactical_targets`, `clear_test`, plus remaining Utils (`getminmax`, `ll2aerll`, `chronice`). Re-grep `calls.js` before locking the table; these counts are a snapshot.
3. Implement `serviceUrls.js`.
4. Implement `bakeStaticConfig`.
5. Implement the LandingPage short-circuit, the login skip, the WebSocket skip.

**Verification:**
- Server-mode build (today's `npm run build`) works unchanged.
- Static-mode build produces a `build-static/` that loads without `/api/*` calls.
- `full` admin still uses same-origin sidecar paths.
- Refactored URL builders in the four files use the helper.

**Rollback:** `git revert` the phase. Server mode is unaffected.

---

## Phase 7 — Publish flow: backend module + spawned ECS task + CloudFormation template

**Goal:** Add the admin's Publish and Delete endpoints, the spawned-ECS-task that runs the static build and provisions a per-dashboard CloudFormation stack, and the new `dashboards` Postgres table. (#53, #54, #55 in `features.md`.)

**Note:** This phase is mode-aware. The Dashboards backend module is always loaded but the route mounts are gated on `isLean()` — full deployments do not need or expose the publish endpoints because they're not the deployment that publishes dashboards. The model and migrations still run in both modes (so a full admin can adopt `lean` mode later without a schema migration step).

**Files:**
- New: `API/Backend/Dashboards/setup.js` — `onceSynced`/`onceInit` lifecycle. The `synced` step (Sequelize sync) runs in both modes; the `init` step (route mounting) gates on `isLean()`.
- New: `API/Backend/Dashboards/models/dashboard.js` — Sequelize model. Columns as in burn-variant Phase 7: `id`, `name`, `mission`, `created_by`, `status`, `stack_arn`, `stack_name`, `cloudfront_url` (cached), `settings`, `last_error`, timestamps. Stack outputs come from `DescribeStacks` at read time, not from the row.
- New: `API/Backend/Dashboards/routes/dashboards.js` — endpoints: `POST /api/dashboards/publish`, `POST /api/dashboards/:id/update`, `DELETE /api/dashboards/:id`, `GET /api/dashboards`, `GET /api/dashboards/:id`. All admin-only via `s.ensureAdmin()`. Mounted only when `isLean()`. The Update endpoint re-bakes the bundle from the current mission config and PutObjects new assets to the existing bucket; the CloudFront distribution is not replaced. `GET` paths merge Postgres rows with `DescribeStacks` live state. **Fire `triggerWebhooks(...)` from the Publish, Update, and Delete handlers** after the terminal row update — this is the most operationally relevant outbound-event source in lean (external CI/CD, monitoring, audit systems often want to know when dashboards change). Use the same call shape as the existing call sites in `API/Backend/Config/setup.js` and `API/Backend/Draw/routes/draw.js` — `require('../../Webhooks/processes/triggerwebhooks')` then call with an event-type and payload.
- New: `scripts/publish-static.js`, `scripts/lib/cfn-template.js`, `scripts/lib/aws-provision.js` — same as burn variant. The publish task calls `CreateStack` and polls `DescribeStacks` until terminal state, then uploads the bundle. `DeleteStack` is called inline from the admin's `DELETE` handler (no separate teardown script).
- New: `configure/src/pages/Dashboards/Dashboards.js` (Configure SPA convention is `pages/<Name>/<Name>.js` per directory) — admin UI. The Dashboards tab is hidden from the SPA's nav (`configure/src/components/Panel/Panel.js`) when `DEPLOYMENT_MODE === 'full'`; page dispatch is in `configure/src/components/Main/Main.js`.
- Edit: `configure/src/core/calls.js` — add `getDashboards`, `publishDashboard`, `deleteDashboard`, `getDashboard` entries.
- Edit: `configure/src/components/Main/Main.js` (page-switch dispatch) and `configure/src/components/Panel/Panel.js` (nav buttons) — register the Dashboards page. Note: `configure/src/core/Configure.js` is a layout component, not the route table.

**Operations:**
1. Implement the model. `setups.synced(s)` syncs on boot in both modes — keep the model passive in full mode (the table is created, but nothing writes to it).
2. Implement the router with the `isLean()` mount gate.
3. Implement the CloudFormation template renderer (`cfn-template.js`) and the publish wiring (`publish-static.js`, `aws-provision.js`). The publish task lives for the ~10 min `CreateStack` → `CREATE_COMPLETE` → upload sequence. The `DELETE` handler empties the bucket, calls `DeleteStack`, and returns immediately.
4. Plumb `DEPLOYMENT_MODE` through Configure as a Pug-rendered flag (already added in Phase 3); hide the Dashboards tab in full mode.
5. Render the CloudFront Function source into the template body with the password baked in as a base64-encoded constant (not as a CFN parameter, which would surface in `DescribeStacks`).

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean` + admin deploy: Dashboards page appears, Publish works end-to-end (stack reaches `CREATE_COMPLETE`, bundle uploads, row reaches `published`), Delete works (`DeleteStack` returns immediately, row reaches `deleted` on the next read once `DescribeStacks` returns "no such stack").
- `MMGIS_DEPLOYMENT_MODE=full`: Dashboards tab not visible, `/api/dashboards/*` returns 404, but the `dashboards` table exists in Postgres (silently) so a mode flip later doesn't need a migration.

**Rollback:** `git revert` the phase. Existing stacks need manual cleanup via the AWS console (list stacks under the `mmgis-dashboard-*` prefix, delete each); the `dashboards` table is benign (no FK pressure) and can be left or dropped manually.

---

## Phase 8 — ECS task definitions, IAM, GitHub Actions deploy

**Goal:** Land the AWS infrastructure for the lean deployment. Define IAM scopes. Add a GitHub Actions workflow for the lean deployment. (Note: CI/CD already runs on GHA today — `docker-build.yml`, `bump-version.yml`, `playwright-tests.yml`, `security-scan.yml`. This phase adds a new deploy workflow alongside them; nothing "moves.")

**Note:** This phase is `lean`-deployment-only. The full deployment continues to use whatever CI/CD it uses today (the original NASA-AMMOS pipeline). Our `infrastructure/` directory is for the VEDA AWS deployment; upstream contributors don't need to touch it.

**Conventions for this phase:**

- **`MMGIS_DEPLOYMENT_MODE=lean` injection: runtime ECS env var only.** Set it in the task definition's `environment[]` array, *not* as a Dockerfile build-time arg. Current `Dockerfile` is single-stage; do not introduce multi-stage just for this. The previous draft contradicted itself on this point; one model is enough.
- **ECS requires two separate roles per task.** Define them separately:
  - **Task execution role** — used by ECS itself to pull the image, write log streams, and inject env vars from Secrets Manager. Permissions: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, `logs:CreateLogStream`, `logs:PutLogEvents`, `secretsmanager:GetSecretValue` on the DB-credentials and session-secret secrets.
  - **Task role** — used by code in the container for SDK calls. Permissions vary per task; listed below.
- **Resource ARNs.** Permissions below describe *intent*. At implementation time, write explicit ARN templates: `arn:aws:ecs:<region>:<account>:task-definition/<family>:*`, `arn:aws:cloudformation:<region>:<account>:stack/mmgis-dashboard-*/*`, `arn:aws:s3:::mmgis-dashboard-*` (and `/*` variant for object actions).
- **Outbound HTTPS egress.** The admin ECS task fires `triggerWebhooks(...)` to user-configured external URLs (Draw events, Config saves, and the new Dashboards Publish/Update/Delete events per Phase 7). If the ECS task runs in a private subnet (the standard pattern when CloudFront fronts the ALB), it needs **either a NAT gateway in the VPC, or VPC endpoints for whatever destinations webhooks will fire at**. Without this, webhook calls hang and time out silently — a common "wait, why aren't my webhooks firing" production bug.

**Files:**

- New: `.github/workflows/deploy-lean.yml` — GitHub Actions workflow specific to the VEDA AWS deployment. Triggers on push to a release branch (or tag — pick the convention; existing workflows trigger on `master`/`development`/PR/tag/release). Steps: build the MMGIS image, push to ECR, update ECS service. Reuses action versions/patterns from `docker-build.yml` for consistency.
- New: `infrastructure/ecs/admin-task.json` — admin task definition. Environment variables include `MMGIS_DEPLOYMENT_MODE=lean` and references to DB URL / session secret from Secrets Manager. References admin task execution role and admin task role separately.
- New: `infrastructure/ecs/publish-task.json` — publish-task task definition. Same image as admin (publish script lives in the same repo) but invoked with `node scripts/publish-static.js`. References its own execution role and a separate (broader) task role.
- New: `infrastructure/iam/admin-task-execution-role.json` — execution-role permissions per "Conventions" above.
- New: `infrastructure/iam/admin-task-role.json` — admin's runtime SDK permissions:
  - `ecs:RunTask` on the publish task definition ARN.
  - `iam:PassRole` on both the publish task execution role and the publish task role (required for `RunTask` to attach roles to the spawned task; common gotcha).
  - `cloudformation:DescribeStacks` on `mmgis-dashboard-*` (for live-state merge).
  - `cloudformation:DeleteStack` on `mmgis-dashboard-*` and `s3:DeleteObject`/`s3:ListBucket` on `mmgis-dashboard-*` (for the inline delete handler's empty-then-delete).
  - `secretsmanager:GetSecretValue` on the dashboards-shared-password secret (only if the admin reads it at runtime; if it only flows through ECS `secrets[]` injection, this belongs on the execution role).
- New: `infrastructure/iam/publish-task-execution-role.json` — execution-role permissions per "Conventions."
- New: `infrastructure/iam/publish-task-role.json` — publish task's runtime SDK permissions: `cloudformation:CreateStack|DescribeStacks|DescribeStackEvents|DeleteStack` on `mmgis-dashboard-*`, plus the resource-creation permissions CloudFormation acts on behalf of: `s3:CreateBucket|PutObject|DeleteBucket|PutBucketPolicy|GetBucketLocation` on `mmgis-dashboard-*`, `cloudfront:CreateDistribution|GetDistribution|UpdateDistribution|DeleteDistribution|CreateFunction|PublishFunction|DescribeFunction|DeleteFunction|GetFunction`. Also `secretsmanager:GetSecretValue` on the dashboards-shared-password secret (read at runtime to bake into the CFN template). **Drop the previous draft's `rds-db:connect`** — it only applies under RDS IAM authentication, and the current code (in `scripts/server.js`) uses password auth via `DB_USER`/`DB_PASS`. If a future switch to RDS IAM auth happens, add it then.
- New: `infrastructure/cloudfront-admin.json` — CloudFront distribution config. CF→ALB hop is HTTPS. Attach the AllViewer origin request policy (forwards cookies, headers, query strings — required for login, sessions, and WebSocket headers) and the CachingDisabled cache policy (admin responses must not be cached). Defaults forward nothing; without these, login breaks silently.
- Edit: `scripts/server.js` — change `app.set('trust proxy', 1)` to `app.set('trust proxy', 2)` to match the CF→ALB→ECS hop count. Without this, Express treats CloudFront's IP as the client and `Secure` cookies, rate-limiting, and `X-Forwarded-For` logging all go wrong.
- New: `infrastructure/cloudfront-function.js` — reference source for the password-gate Function; embedded into the rendered CloudFormation template at publish time.
- `Dockerfile` — **no edits** (the env var flows in via ECS `environment[]` per Conventions). Current `Dockerfile` is single-stage; keep it that way.
- Optional: lean image trim. The production `Dockerfile` installs Python micromamba and copies `adjacent-servers/` for full-mode use. In lean those are dead weight at runtime. A separate `Dockerfile.lean` (or a `--target lean` if multi-stage is later adopted) that skips the micromamba install and `COPY adjacent-servers/` reduces image size and CI time. Source stays in the repo for upstream-compat; only the image differs. Defer this until the lean image size is actually a problem.

**Operations:**
1. Author task definitions, IAM roles, CloudFront config.
2. Author the GitHub Actions workflow.
3. Document the prereqs (VPC, subnets, ACM cert, Secrets Manager entries).
4. Document the dual-deployment posture in README: "this repo deploys two ways — `MMGIS_DEPLOYMENT_MODE=full` (the upstream path, default) and `MMGIS_DEPLOYMENT_MODE=lean` (our AWS deployment, via the workflow in `.github/workflows/deploy-lean.yml`)."

**Verification:**
- Deploy to a staging AWS account with `MMGIS_DEPLOYMENT_MODE=lean`. Hit the admin URL; login; configure a mission referencing a public COG URL; publish a dashboard; open the dashboard URL.
- On the same admin image, locally run `MMGIS_DEPLOYMENT_MODE=full npm start` and confirm all sidecar proxies, upload routes, Missions middleware, and dashboards-route 404 behave per the full contract.

**Rollback:** Tear down the staging environment.

---

## Phase 9 — Hardening: DB-down boot, first-signup, superadmin

**Goal:** Address the two open concerns from the ADR that survive the move to CloudFormation, plus the latent WebSocket idle-timeout footgun in the existing code. Apply uniformly to both modes (full and lean) where the change makes sense — `init-db.js` retry, `first_signup` disable, superadmin seed, WebSocket heartbeat. The teardown-reliability concern is dropped because CloudFormation owns the resource-lifecycle dance; the live-reads pattern from Phase 7 surfaces stuck stacks in the UI without a separate reconcile job.

**Files:**
- Edit: `scripts/init-db.js` — **introduce** a bounded retry loop on the initial Sequelize connect. Current code is single-shot — there's no existing loop to wrap. Applies to both modes; upstream benefits too.
- Edit: `scripts/init-db.js` — when `SEED_SUPERADMIN_USERNAME` + `SEED_SUPERADMIN_PASSWORD` env are present, seed a superadmin. Applies to both modes. Note: `init-db.js` does not import the `User` model today; the seed needs to either import the model (new dependency) or run raw SQL against `users`.
- Edit: `API/Backend/Users/routes/users.js` — gate the `POST /api/users/first_signup` route on a new env var `DISABLE_FIRST_SIGNUP=true`. The lean deployment sets this; full-mode deployments leave it unset to preserve today's behavior. Document the security implication for full mode.
- Edit: `public/adminlogin.js` — this public bootstrap page calls `/api/users/first_signup` directly. Gate the call client-side on the same `DISABLE_FIRST_SIGNUP` signal (plumb through the Pug shell as a window flag, or have the call gracefully handle the 404 the gated route now returns). `grep -n first_signup public/adminlogin.js` to confirm before editing.
- Edit: `API/websocket.js` — add a server-side ping/pong heartbeat on `wss`. On each tick (default 30s, configurable via `WEBSOCKET_PING_INTERVAL_MS`), iterate `wss.clients`: if a client did not pong since the previous tick, `ws.terminate()`; otherwise mark it unresponsive and call `ws.ping()`. Register a `pong` handler on each connection that clears the unresponsive mark. Clear the interval on `wss.close`. Applies to both modes — the existing code has no heartbeat, leaving the WS vulnerable to any 60s-idle intermediary (ALB default, NAT, corporate proxy, mobile carrier).
- Optional: rename the misleading `webSocketPingInterval` field in `src/essence/essence.js` (line 137) and `configure/src/core/Websocket.js` (line 12) to `webSocketReconnectInterval`. Both are reconnect timers despite the name — the rename is documentation, no functional change. No client-side ping code is needed; the browser `WebSocket` API answers server pings automatically.

**Operations:**
1. Implement the retry loop.
2. Implement the seed mechanism.
3. Gate `first_signup` on the env var.
4. Implement the server-side heartbeat. Document `WEBSOCKET_PING_INTERVAL_MS` in `sample.env`.

**Verification:**
- Postgres-down restart: bounded retry, clean failure, ECS handles.
- Fresh deploy: superadmin user exists after init-db with `SEED_*` env vars.
- `DISABLE_FIRST_SIGNUP=true` deploy: `POST /api/users/first_signup` returns 404. Unset: returns the existing behavior.
- Open the admin, leave Configure idle for 10+ minutes behind the ALB. WS stays connected; no "Websocket disconnected" banner; Essence's `LayerUpdatedControl` does not enter the `DISCONNECTED` state. ALB CloudWatch `IdleTimeoutClosedConnectionCount` does not increment for the admin target group on the WS path.
- Local repro behind a deliberate 60s-idle reverse proxy (e.g. nginx with `proxy_read_timeout 60s`): the heartbeat keeps the connection alive across the 60s window.

**On stuck stacks.** Same as burn variant: failed publishes (`CREATE_FAILED`, `ROLLBACK_COMPLETE`) and failed deletes (`DELETE_FAILED`) surface in the Dashboards page via the live-state pattern from Phase 7. The default escape hatch is the Delete affordance, which retries `DeleteStack`. If failures recur, follow up with a stack-events-via-SNS update path (out of scope for this plan).

**Rollback:** `git revert` the phase.

---

## Phase 10 — Cleanup pass

**Goal:** Catch what the gating left rough. Re-audit, update docs, ensure both modes are covered in tests.

**Operations:**
1. `git grep -E 'isLean|isFull|MMGIS_DEPLOYMENT_MODE'` — confirm every consumer reads through the helper, not directly from `process.env`.
2. Audit test coverage for both modes. Add a CI matrix that runs `npm test` with `MMGIS_DEPLOYMENT_MODE=full` and `=lean`.
3. Update README.md and `AGENTS.md` to document the dual-mode posture.
4. Update `docs/` Jekyll site to document the new env var and the deployment shapes.
5. Add an upstream-contribution note: changes that touch a gated surface should be authored in `full` mode first, then verified to not break `lean` mode.

**Verification:**
- CI passes in both modes.
- Documentation renders correctly.

**Rollback:** N/A — cleanup is incremental.

---

## Cross-mode invariants

The keep variant introduces complexity that has to be enforced over time. The following invariants need to be held to avoid drift.

- **Default mode is `full`.** Upstream contributors who clone the repo and run `npm start` get today's behavior. `MMGIS_DEPLOYMENT_MODE=lean` is opt-in.
- **No silent breakage when mode is unknown.** The helper throws at startup on unrecognized values.
- **Frontend code does not branch on the runtime mode.** The dashboard bundle is built in `static` mode; the admin bundle is built in `server` mode. Build mode and deployment mode are orthogonal but in practice tightly correlated: a `lean`-mode admin serves a `server`-mode bundle; a published dashboard is a `static`-mode bundle.
- **`isLean()` is *additive*, not *destructive*.** A `lean`-only feature gets gated on `if (isLean())`. A *full*-only feature gets gated on `if (isFull())`. Never use `if (!isFull())` — write the explicit `if (isLean())` so the read is unambiguous.
- **CI runs both modes.** A pull request that breaks `full` mode should fail CI.
- **Gates apply at the smallest unit that makes sense** — usually route mounts, occasionally individual handlers, rarely entire files.

## What this plan does *not* cover

- A migration path from `full` to `lean` mode in an existing deployment. Both modes share the same database schema in this plan, but a long-running `full` admin would have `Missions/` filesystem state that `lean` mode can't read; the migration tooling for that is out of scope.
- Mission-config validation that flags configs referencing sidecar URLs in `lean` mode.
- Cross-account audit logging for dashboards published outside our AWS organization.
- A planned removal date for the `full` mode gates, if the keep variant proves vestigial. (See `adr.md` D2 for the "revisit and burn" criterion.)

These are tracked outside this plan.
