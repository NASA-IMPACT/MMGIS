# Lean (keep) — PR overview & sequencing

This is the index for the [`prs/`](.) folder: it slices the lean (keep) implementation work into reviewable pull requests and records the dependency graph. Each `pr-NN-*.md` is the per-PR implementation doc. Where a per-PR doc and this overview disagree on a detail, **the per-PR doc wins** (it is code-verified); this file is the sequencing map.

**Principle:** every PR leaves `full` mode (the default) working. Gates are additive. PR 1 is the foundation everything keys off; after that, backend-gate PRs are mutually independent and can land in any order / in parallel.

## PRs

### PR 1 — Deployment-mode foundation <a id="pr-1"></a>
- `API/Backend/Utils/deploymentMode.js` backend helper (`isLean`/`isFull`, defaults to `full`, throws on unknown). The client-side counterparts (`src/pre/deploymentMode.js`, `src/essence/Basics/mode.js`) and `assertLean()` are speculative — PR 7 branches directly on `mmgisglobal.SERVER`; add them only when a consumer exists.
- `SERVER`/`STATIC_*` build flags, env allowlist, gitignored baked-config stub.
- No behavior change. **Blocks: everything.**

### PR 2 — Gate sidecar proxy <a id="pr-2"></a>
- `adjacent-servers` proxy + spawner no-op in lean; `WITH_*` forced false at the Pug shell.
- `init-db.js` skips `mmgis-stac` DB in lean.
- _Depends: PR 1._

### PR 3 — Gate Datasets & Geodatasets + Configure mode flag <a id="pr-3"></a>
- Whole-module gate on `Datasets`/`Geodatasets` `setup.js`.
- Plumb `DEPLOYMENT_MODE` through the Pug shell to the Configure SPA via `window.mmgisglobal` (reused by later PRs).
- Hide Datasets/GeoDatasets nav tabs in lean.
- _Depends: PR 1._

### PR 4 — Gate Draw <a id="pr-4"></a>
- Gate `/api/draw` + `/api/files` mounts (both under `API/Backend/Draw/`).
- Drop Draw tool from the Essence bundle and Configure; draw_*/files_* calls → Drop.
- _Depends: PR 1 (Configure side uses PR 3's mode flag)._

### PR 5 — Gate Missions middleware, `_time_` compositor, link shortener & Missions-bound Utils endpoints <a id="pr-5"></a>
- Gate the three `Missions/` mounts and the `sharp` `_time_` compositor in lean (`full` unchanged).
- Gate the link-shortener route mount.
- Gate the `Missions/`-dependent `/api/utils` endpoints in lean: `getprofile`, `getbands`, `getminmax`, `queryTilesetTimes` (all LOCAL-ONLY — Python/GDAL or `fs` against the on-disk `Missions/` tree, which is removed in lean). `proj42wkt` and `healthcheck` stay (pure compute); `ll2aerll`/`chronice` are SPICE compute (non-`Missions/`, but non-Earth and frontend-dropped — gate optional). Gating also closes the unauth exposure (`ensureUser()` short-circuits open when `AUTH != "local"`).
- _Depends: PR 1._

### PR 6 — Configure SPA lean polish <a id="pr-6"></a>
- Hide the populate-from-COG button; keep External Service URL fields visible.
- STAC page row-action (upload/append/import) gate; APIs-cards inactive check; optional velocity save-warn.
- _Depends: PR 3._

### PR 7 — Static frontend: SERVER flag + dispatcher + ServiceUrls static mode <a id="pr-7"></a>
- `InterpolateHtmlPlugin` substitutes `mmgisglobal.SERVER`; activate the dormant `calls.js` branch with a `STATIC_HANDLERS` table (all 40 entries per [`api.md`](../api.md)).
- Extend `ServiceUrls` for static no-fallback resolution (+ TiPG/Veloserver builders, LayerManager titiler.ts).
- Static-mode short-circuits: login skip, WebSocket skip, LandingPage deeplink override, Viewer credentials off.
- _Depends: PR 1. **Largest PR** — consider splitting dispatcher vs ServiceUrls if review is heavy._

### PR 8 — Publish flow: backend + Deployments Configure page <a id="pr-8"></a>
- `API/Backend/Deployments/` model + routes (`/api/deployments/*`: publish/update/delete/get), route-mount gated on `isLean()`, model syncs in both modes. (Feature symbols use "Deployments" to avoid colliding with modern-ui's `Dashboard*` code; the published artifact is still a "dashboard".)
- `publish-static.js` + `cfn-template.js` + `aws-provision.js` (CreateStack → poll → upload; inline DeleteStack).
- Configure Deployments page; fire webhooks on publish/update/delete a dashboard.
- _Depends: PR 3 (mode flag), PR 7 (static build)._

### PR 9 — Static-mode COG range, projection WKT & histogram disable <a id="pr-9"></a>
- COG min/max: **reroute to the external TiTiler** (lean always serves COG externally) — not a bake.
- Projection WKT: compute client-side via `proj4js` (already bundled).
- Time-slider histogram: **disabled in lean** (not needed) — removes the old `times.json` bake and its open count-source question.
- Frontend-only; no publish-time generation. _Depends: PR 7._

### PR 10 — S3 asset upload repoint <a id="pr-10"></a>
- Swap `Upload/uploadRouter.js` storage from local `Missions/` to S3 PutObject in lean; return a root-relative `/assets/…` path.
- The `/assets/…` return is also what makes uploaded **Card** images render in dashboards: `resolveImageUrl` passes a leading `/` through unchanged, and PR 8 copies `/assets/…` into the dashboard bucket. (Edits the #103 `Upload` module, `API/Backend/Upload/`, which is present on the branch.)
- _Depends: PR 5, the asset bucket (PR 11)._

### PR 11 — AWS infra: ECS task defs, IAM, CloudFront, GHA deploy <a id="pr-11"></a>
- Admin + publish task definitions; two roles each; scoped IAM (RunTask/PassRole, CFN/S3/CloudFront on `mmgis-dashboard-*`).
- Admin CloudFront (AllViewer + CachingDisabled), `trust proxy 2`, S3 asset bucket, `deploy-lean.yml`.
- _Depends: PR 8 (publish task)._

### PR 12 — Hardening <a id="pr-12"></a>
- DB-down boot retry, `DISABLE_FIRST_SIGNUP` gate, superadmin seed, WebSocket ping/pong heartbeat.
- Mode-agnostic (helps `full` too) — **can land any time after PR 1, in parallel.**

### PR 13 — Cleanup + dual-mode CI <a id="pr-13"></a>
- Audit all gates read through the helper; CI matrix runs both modes; update README/AGENTS/Jekyll docs.
- _Depends: all._

## Sequencing

- **Foundation:** PR 1.
- **Parallel after PR 1:** PRs 2, 3, 4, 5, 12 (and PR 7, the big frontend one).
- **PR 6** after PR 3. **PR 8** after PR 3 + PR 7. **PR 9** after PR 7. **PR 11** after PR 8. **PR 10** after PR 5 + PR 11.
- **PR 13** last.

## Note — newly-merged tools (AOI, Card, Chart, FetchStats) need no new PR

`updateTools.js` compiles *every* tool into the bundle, but only tools a mission selects (`on !== false`) ever render — an unselected tool is dormant dead code, not a runtime error. So a dashboard only breaks on tools its mission actually uses that depend on a backend/`Missions/` path. Of the merged tools: **AOI** and **Chart** are fully static-safe; **FetchStats** works when its layer `itemUrl` is external (same reroute shape as `getminmax`); **Card** uploaded images are handled by PR 10 (`/assets/…` return) + PR 8 (asset copy). This is the same backend-coupling lean already manages for Identifier/Measure/Shade via per-call Drop/Reroute + per-mission config discipline — not a new failure mode. The vision's true decoupled-plugin overhaul (Overhaul #1) is a separate, post-lean effort, out of scope here.
