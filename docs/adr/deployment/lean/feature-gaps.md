This is an inventory of potential feature gaps resulting from a lean deployment. It should be treated as a starting point, not necessarily an authoritative list. In review, we should read through each, decide if they matter to us or whether they are already being implemented in a planned future plugin.

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

Cases where the trade-offs are real and the choice affects how many missions are publishable.

### 1. Time-windowed layers (`_time_` URL convention)

**What it does.** Layer URLs contain a `_time_` placeholder. The frontend's time slider substitutes a date; the admin's `Missions/` middleware resolves it to the closest-prior tile on disk. With `?composite=true`, sharp alpha-blends up to 100 time-tagged tiles in the requested window — most recent non-transparent pixel wins.

**Why lean breaks it.** No `Missions/` middleware and no local data, so the substituted URL has nothing to answer it.

**Options:**

- **A. Hide.** Time-windowed layers don't appear in lean missions. Pair with forcing `config.time.enabled = false` at publish when no time-windowed layers remain; otherwise `TimeControl_` renders the full top bar and slider with nothing to control (a scrubber that goes nowhere). Real capability loss for missions whose value depends on time-scrubbing.
- **B. STAC-backed.** The mission owner uploads the source data to a temporal-aware external service (STAC + a tile server like TiTiler-pgSTAC). Frontend's `TimeControl_` is rewired to drive STAC queries instead of string substitution. STAC mosaicking sorted datetime-descending reproduces both the closest-prior and the alpha-composite behavior. Costs: data hosting is the mission owner's responsibility; one-time frontend rewrite; layer-config schema change.

---

### 2. Server-served vector and tabular data (Datasets / Geodatasets / tipg)

**What it does.**

- **Datasets** (`/api/datasets/*`) — tabular CSV/JSON rows joined to features by a key, used by `MetadataCapturer` to hydrate feature popups with linked rows (images, attached records).
- **Geodatasets** (`/api/geodatasets/*`) — PostGIS spatial tables served as GeoJSON or MVT. Primary layer source for many missions; powers filtering, aggregations, and the server-side path of Search.
- **tipg** (`/tipg/...` proxy) — Python sidecar serving OGC features and MVT directly from PostGIS, referenced via mission-configured layer URLs (no inline code construction).

**Why lean breaks it.** All three depend on the admin's Postgres + sidecar stack, and the implementation plans drop the Datasets and Geodatasets modules entirely in lean. In a dashboard, every `geodatasets:`-prefixed layer fails to load (vector or vectortile), dataset-link popups silently lose joined fields, filters and aggregations 404, and any `/tipg/...` mission URL 404s.

**The core decision is A vs B: where does the data live for a dashboard?** Both are principle-compatible — the `Missions/` settled-drops bullet already permits S3-baked content alongside externally hosted content. The choice is driven by data size, mission owner capacity, and bundle-budget. C and D are accommodations for the cases where neither A nor B applies cleanly.

**Core options:**

- **A. Bake to static files in the dashboard's S3 bucket at publish.** Datasets → JSON keyed by link column. Geodatasets → static `.geojson` (small/medium) or pre-tiled MVT/`pmtiles` (large). tipg → same pre-tiled MVT story. Publish task rewrites mission URLs to the baked locations. Server-side filtering and aggregation move client-side (works for small/medium tables) or are dropped. Best when data fits comfortably in the dashboard bundle.
- **B. Mission owner hosts externally.** Layer URLs point at a public OGC Features service, a hosted vector-tile server, or a CDN-hosted JSON. No bake step; mission owner's responsibility. Best when data is large, frequently updated, or already hosted somewhere.

**Accommodations:**

- **C. Pre-join into feature properties at publish.** For Datasets specifically, merge joined rows into each feature's properties before the GeoJSON is baked. No runtime lookup needed; larger GeoJSON. Use when A applies and the runtime join is the only thing keeping it from working.
- **D. Hide the dependent layers / features.** Cheapest. User-visible loss of any geodataset-backed map content. Use when neither A nor B is viable for a given mission.

---

### 3. Plugin tools in dashboards

**What it does (today).** `API/updateTools.js` codegen scans `src/essence/Tools/*` and any `*Plugin-Tools*` / `*Private-Tools*` sibling directories at build time, writes `src/pre/tools.js` with `import` statements per tool, and Webpack bundles them. The same path runs for both admin and dashboard builds. Plugin backends (`*Plugin-Backend*`) mount Express routes at admin boot.

**Why lean breaks it.** The dashboard bundles every plugin tool present in the build tree — no opt-in/out flag exists. Plugin tools that depend on `calls.api(...)` against backend endpoints silently no-op in dashboard mode (the `SERVER != 'node'` guard at `src/pre/calls.js:169` calls the error callback and returns; many call sites pass no error handler). The tool button stays visible; clicks fire nothing. The same shape applies to plugin-driven layer URL prefixes like `api:tacticaltargets` (handled by a private plugin's `api/tactical/targets` endpoint) — layers using these URLs load as empty.

**Options:**

- **A. Add a `staticCompatible: true|false` flag in each tool's `config.json`.** Dashboard build path filters non-compatible tools out of `src/pre/tools.js`. Tool authors opt in explicitly.
- **B. Hide tool buttons at runtime when `SERVER !== 'node'` and the tool declares backend dependence.** Relies on tool authors marking their tools honestly.
- **C. Two build entrypoints.** `scripts/build.js` (admin) plus a new `scripts/build-static.js` that runs `updateTools` with a static-mode filter and writes a separate `src/pre/tools.static.js`. Cleanest separation; heaviest change.
- **D. Status quo.** Plugin tools that don't work no-op silently; their UI remains. Mission owners avoid configuring them.

---

## Follow-ups (not lean-specific)

Concerns that surface in the context of lean but are not lean-specific decisions. Tracked here so they're not lost.

- **Layer-config validation.** `API/Backend/Config/validate.js` runs on save and checks structural shape (required fields, numeric ranges, duplicate UUIDs, recognized layer types). It does **not** check URL reachability, scheme (`/Missions/...` vs absolute), whether sidecar paths are mounted in the deploy target, or whether referenced tool/kind UUIDs exist. The same risk applies in full mode today if the operator runs without one of the `WITH_*` flags — lean just makes the consequences more visible. Track as a separate config-validation hardening item; out of scope for the lean ADR.

- **Pluggable external search adapter.** A search-adapter abstraction in the frontend (one adapter per protocol: OGC API Features + CQL2, STAC + filter extension, custom) would let layer configs declare an external search service for vectortile / geodataset layers. Unlike tile data there is no universal search URL contract; "point at an external source" requires picking a protocol and wiring the frontend to it. Independent of the Datasets/Geodatasets disposition above. Defer until a mission actually requests it.
