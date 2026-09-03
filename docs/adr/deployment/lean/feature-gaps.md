> **Status: exploratory inventory, NOT a source of truth.** This catalogs potential feature gaps from a lean deployment so none is forgotten. The authoritative decisions live in [`adr.md`](./adr.md) and [`api.md`](./api.md) — where this doc and those disagree, those win. Lean's standing default for any gap below is **gate/hide it**, with the listed "escape hatch" reserved for a specific mission that actually needs it (built only when triggered, not speculatively).

# Feature gaps in the lean deployment

Features full MMGIS provides that lean either drops or can only deliver through new work. Working list.

Lean does not host data of any kind. Features whose current implementation depends on local files either need an external substitute — typically STAC or another mission-owner-hosted service — or are dropped. Mission owners who want a capability are responsible for hosting the data behind it.

When a feature has an easy code change that meaningfully keeps it working, that is the obvious choice and the gap doesn't appear here. This doc covers only the cases where the trade-offs are real.

---

## Settled drops

Capabilities lean does not provide and is not building a substitute for. Documented here so the loss is clear.

- **In-admin geodata upload.** Datasets, geodatasets, tile pyramids. Admins reference external URLs for all geospatial data. (Static mission assets — images, icons — are *not* dropped: they upload to an S3 asset bucket via the core `Upload` route. See [`adr.md`](./adr.md) constraint 4.)
- **Python sidecars as part of MMGIS.** TiTiler, TiTiler-pgSTAC, STAC, tipg, and the `/veloserver` proxy. Missions point at external services for any capability these used to provide.
- **`Missions/` static file serving.** No per-mission on-disk asset tree. Large mission data — pre-tiled raster imagery, DEM tiles, radargrams, feature-attached media, 3D models for Kinds, `video` / `model` / `image` layer source files, Isochrone cost-tile pyramids — must be hosted externally by the mission owner or baked into the dashboard's S3 bucket at the path the bundle expects. (Exception: small admin-uploaded images/icons go to the admin's S3 asset bucket via the core `Upload` route — that path is kept, just repointed from local disk to S3.)
- **`mmgis-stac` database.** Not created since the STAC sidecar isn't deployed.
- **Link shortener.** Not deployed.

---

## Default disposition

Cases where the obvious answer is to hide or drop the unsupported sub-feature in dashboards. Any preservation path is a real engineering investment that should be triggered by a specific mission need, not built speculatively. Listed for visibility so the loss isn't forgotten and the escape hatches are documented.

### Drawing tool

**What it does.** Admin users collaboratively create, edit, organize, version, and publish vector features (points, lines, polygons, notes, arrows) inside named "files," with templated properties, history/undo, and import/export.

**Default: gated out entirely (D2).** Draw is not mounted in lean — not in the admin, not in dashboards. Every read and write goes through `/api/draw/*` and `/api/files/*`, both gated out per [`api.md`](./api.md). There are no Draw files to create or bake.

**If a mission needs annotations,** author them as a static GeoJSON layer referenced by external URL in the mission config, the same as any other geospatial data in lean.

### Elevation profile (Measure tool)

**What it does.** Drawing a line in Measure renders a profile chart of elevation samples between the endpoints, fetched from `/api/utils/getprofile` (Python over GDAL). 2D / 3D distance measurements run client-side and are unaffected.

**Default: hide the profile chart.** `getprofile` 404s; the chart hits its `data.length < 3` fallback (flat zero line, console warning). Distance-only Measure still works.

**Escape hatch — client-side sample the mission's DEM.** Use the already-bundled `geotiff.js` to sample N points along the drawn line. Requires the DEM to be COG-formatted and reachable over HTTP — works against any host (mission owner's external S3 / CDN, or a copy baked into the dashboard bucket) that supports range requests and serves the right CORS headers. Use when elevation profiles are core to the deliverable.

### Sun-angle compute (Shade tool)

**What it does.** Given a source point and a time, computes solar azimuth/elevation/range at the surface for sunlight modeling. The compute path reads DEM elevation via `/api/utils/getbands`, then calls `/api/utils/ll2aerll` (SPICE-backed) for sun geometry. For Mars missions with an observer-specific time field, `/api/utils/chronice` converts UTC ↔ LMST (Local Mean Solar Time) for display. Static-shade rendering (no compute) is a separate, simpler path.

**Default: hide the compute path.** Keep static-shade rendering; remove the time/target inputs. All three backend routes 404 in dashboards and SPICE has no JS port today.

**Escape hatch — pre-compute fixed times.** Bake azimuth/elevation/range at publish for a chosen set of times; the picker becomes a discrete selector. Use when sun position at specific times is central to the mission.

### Search (vectortile / geodataset path)

**What it does.** A top-bar search box finds features in mission layers by typing a value from a configured property (e.g. site name). Vector layers (in-memory GeoJSON) search entirely client-side. Vectortile / geodataset-backed layers call `POST /api/geodatasets/search`.

**Default: hide the search box when no in-memory vector layer is searchable.** Vector-layer search keeps working in dashboards. Vectortile / geodataset search is moot in lean because the Datasets/Geodatasets modules are dropped (see *Real decisions §2*).

**Escape hatch — pluggable external search adapter.** See *Follow-ups* below. Not built today; defer until a mission actually requests external search.

---

## Real architectural decisions

Cases where the trade-offs are real and the choice affects how many missions are publishable. **Lean default (decided 2026-06-09): gate/hide all three.** The lettered options below are retained as escape hatches for a specific mission that needs the capability — not as still-open choices. §1 and §2 default to hide-or-reference-external; §3 is handled by per-mission config discipline (see the rewritten §3).

### 1. Time-windowed layers (`_time_` URL convention)

**What it does.** Layer URLs contain a `_time_` placeholder. The frontend's time slider substitutes a date; the admin's `Missions/` middleware resolves it to the closest-prior tile on disk. With `?composite=true`, sharp alpha-blends up to 100 time-tagged tiles in the requested window — most recent non-transparent pixel wins.

**Why lean breaks it.** No `Missions/` middleware and no local data, so the substituted URL has nothing to answer it.

**Lean default: A (hide).** Implemented at publish time by forcing `config.time.enabled = false` when no resolvable time layer remains. B is the escape hatch for a mission that genuinely needs time-scrubbing.

**Options:**

- **A. Hide.** Time-windowed layers don't appear in lean missions. Pair with forcing `config.time.enabled = false` at publish when no time-windowed layers remain; otherwise `TimeControl_` renders the full top bar and slider with nothing to control (a scrubber that goes nowhere). Real capability loss for missions whose value depends on time-scrubbing.
- **B. STAC-backed.** The mission owner uploads the source data to a temporal-aware external service (STAC + a tile server like TiTiler-pgSTAC). Frontend's `TimeControl_` is rewired to drive STAC queries instead of string substitution. STAC mosaicking sorted datetime-descending reproduces both the closest-prior and the alpha-composite behavior. Costs: data hosting is the mission owner's responsibility; one-time frontend rewrite; layer-config schema change.

---

### 2. Server-served vector and tabular data (Datasets / Geodatasets / tipg)

**What it does.**

- **Datasets** (`/api/datasets/*`) — tabular CSV/JSON rows joined to features by a key, used by `MetadataCapturer` to hydrate feature popups with linked rows (images, attached records).
- **Geodatasets** (`/api/geodatasets/*`) — PostGIS spatial tables served as GeoJSON or MVT. Primary layer source for many missions; powers filtering, aggregations, and the server-side path of Search.
- **tipg** (`/tipg/...` proxy) — Python sidecar serving OGC features and MVT directly from PostGIS, referenced via mission-configured layer URLs (no inline code construction).

**Why lean breaks it.** All three depend on the admin's Postgres + sidecar stack, and lean drops the Datasets and Geodatasets modules entirely. In a dashboard, every `geodatasets:`-prefixed layer fails to load (vector or vectortile), dataset-link popups silently lose joined fields, filters and aggregations 404, and any `/tipg/...` mission URL 404s.

**Lean default: hide (D), with external hosting (B) as the per-mission escape hatch.** The `Datasets`/`Geodatasets` modules are gated out and the `datasets_*`/`geodatasets_*` dispatcher calls Drop, so by default these layers simply don't appear in a dashboard. A mission that needs the data points its layer URLs at an external OGC Features / vector-tile / CDN-JSON service (B); the publish flow performs no URL rewrite or bake. A and C (bake at publish) remain available but are not built by default.

**The core decision (when a mission opts in) is A vs B: where does the data live for a dashboard?** Both are principle-compatible — the `Missions/` settled-drops bullet already permits S3-baked content alongside externally hosted content. The choice is driven by data size, mission owner capacity, and bundle-budget. C and D are accommodations for the cases where neither A nor B applies cleanly.

**Core options:**

- **A. Bake to static files in the dashboard's S3 bucket at publish.** Datasets → JSON keyed by link column. Geodatasets → static `.geojson` (small/medium) or pre-tiled MVT/`pmtiles` (large). tipg → same pre-tiled MVT story. Publish task rewrites mission URLs to the baked locations. Server-side filtering and aggregation move client-side (works for small/medium tables) or are dropped. Best when data fits comfortably in the dashboard bundle.
- **B. Mission owner hosts externally.** Layer URLs point at a public OGC Features service, a hosted vector-tile server, or a CDN-hosted JSON. No bake step; mission owner's responsibility. Best when data is large, frequently updated, or already hosted somewhere.

**Accommodations:**

- **C. Pre-join into feature properties at publish.** For Datasets specifically, merge joined rows into each feature's properties before the GeoJSON is baked. No runtime lookup needed; larger GeoJSON. Use when A applies and the runtime join is the only thing keeping it from working.
- **D. Hide the dependent layers / features.** Cheapest. User-visible loss of any geodataset-backed map content. Use when neither A nor B is viable for a given mission.

---

### 3. Plugin tools in dashboards

**The mechanism (clarified 2026-06-09).** `API/updateTools.js` is build-time codegen: it scans `src/essence/Tools/*` (plus any `*Plugin-Tools*` / `*Private-Tools*` siblings) and emits a static `import` for **every** tool into `src/pre/tools.js`, for both admin and dashboard builds. **But bundling ≠ rendering.** At runtime only the tools in a mission's `tools` list (where `on !== false`) are instantiated (`Layers_.js` builds `L_.tools`; `ToolController_`/`ToolControllerModern_` looks each up in the static `toolModules` map and calls `.make()`). A tool that's in the bundle but not selected by the mission is **dormant dead code — it never renders and causes no runtime error.**

**So the actual breakage scope is narrow:** a dashboard only malfunctions on tools its mission *actually selects* that depend on the admin backend or the `Missions/` filesystem (which don't exist in a dashboard). This is the same backend-coupling lean already handles for the older tools (Identifier/Measure/Shade — via per-call Drop/Reroute in [`api.md`](./api.md) plus per-mission config discipline). The newly-merged tools just add a few more instances:

| Tool | Static-dashboard verdict | Handling |
|---|---|---|
| **AOI** | Safe — boundary GeoJSON is webpack-bundled assets (the mission-relative config fields are dead code) | none needed |
| **Chart** | Safe — event-bus only, no backend | none needed |
| **FetchStats** | Safe **iff** the layer's `analysis.itemUrl` is external (raw `fetch` to `<itemUrl>/statistics`; same reroute shape as `getminmax`) | per-mission discipline: only configure it with an external `itemUrl` |
| **Card** | Uploaded images resolve to `Missions/<mission>/…` → 404 in a dashboard | handled by the S3 upload repoint (upload returns root-relative `/assets/…`, which `resolveImageUrl` passes through unchanged) plus the publish-time asset copy into the dashboard bucket |
| **`api:tacticaltargets` layer URL** | Private-plugin layer prefix → loads empty in a dashboard | the `tactical_targets` dispatcher call Drops (api.md); the mission should not use that layer URL in lean |

**Lean decision: no new PR.** Because unselected tools are harmless and the only real breakage (Card uploaded images) is already covered by the S3 upload repoint plus the publish-time asset copy, lean relies on the same per-mission config discipline it already applies to Identifier/Measure/Shade — don't select a backend-coupled tool unless its data is reachable externally; author Card images as uploads (→ `/assets/…`) or absolute URLs. A `staticCompatible` flag + build-time filter (the old option A below) is **not** built for lean.

**The retained options (for reference / future):**

- **A. Add a `staticCompatible: true|false` flag in each tool's `config.json`,** filtered out of the dashboard build. This is the right shape for the *vision's* true-decoupled-plugin overhaul (Overhaul #1), but that is a separate post-lean effort, not deployment scope.
- **B.** Hide tool buttons at runtime when `SERVER !== 'node'` and the tool declares backend dependence.
- **C.** Two build entrypoints (`build.js` + a static `build-static.js`). Cleanest separation, heaviest change.
- **D. Status quo + per-mission discipline** — the lean default described above.

---

## Follow-ups (not lean-specific)

Concerns that surface in the context of lean but are not lean-specific decisions. Tracked here so they're not lost.

- **Layer-config validation.** `API/Backend/Config/validate.js` runs on save and checks structural shape (required fields, numeric ranges, duplicate UUIDs, recognized layer types). It does **not** check URL reachability, scheme (`/Missions/...` vs absolute), whether sidecar paths are mounted in the deploy target, or whether referenced tool/kind UUIDs exist. The same risk applies in full mode today if the operator runs without one of the `WITH_*` flags — lean just makes the consequences more visible. Track as a separate config-validation hardening item; out of scope for the lean ADR.

- **Pluggable external search adapter.** A search-adapter abstraction in the frontend (one adapter per protocol: OGC API Features + CQL2, STAC + filter extension, custom) would let layer configs declare an external search service for vectortile / geodataset layers. Unlike tile data there is no universal search URL contract; "point at an external source" requires picking a protocol and wiring the frontend to it. Independent of the Datasets/Geodatasets disposition above. Defer until a mission actually requests it.
