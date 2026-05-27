# Feature gaps in the lean deployment

Features full MMGIS provides that lean either drops or can only deliver through new work. Working list.

Lean does not host data of any kind. Features whose current implementation depends on local files either need an external substitute — typically STAC or another mission-owner-hosted service — or are dropped. Mission owners who want a capability are responsible for hosting the data behind it.

Items here are real gaps that need product or architecture decisions. Trivial code re-writes, baked-value additions to the publish task, and items settled by the no-local-data principle live in the implementation plans.

When a feature has an easy code change that meaningfully keeps it working, that is the obvious choice and the gap doesn't appear here. This doc covers only the cases where the trade-offs are real.

---

## Settled drops

Capabilities lean does not provide and is not building a substitute for. Documented here so the loss is clear.

- **In-admin data upload.** Datasets, geodatasets, mission assets, tile pyramids. Admins author mission configs by referencing external URLs only.
- **Python sidecars as part of MMGIS.** TiTiler, TiTiler-pgSTAC, STAC, tipg, and the `/veloserver` proxy. Missions point at external services for any capability these used to provide.
- **`Missions/` static file serving.** No per-mission on-disk asset tree. Mission assets — pre-tiled raster imagery, DEM tiles, radargrams, feature-attached media, icons / 3D models for Kinds, legend images, `video` / `model` / `image` layer source files, Isochrone cost-tile pyramids — must be hosted externally by the mission owner or baked into the dashboard's S3 bucket at the path the bundle expects.
- **`mmgis-stac` database.** Not created since the STAC sidecar isn't deployed.
- **Link shortener.** Not deployed.

---

## Open gaps

### 1. Time-windowed layers (`_time_` URL convention)

**What it does.** Layer URLs contain a `_time_` placeholder. The frontend's time slider substitutes a date; the admin's `Missions/` middleware resolves it to the closest-prior tile on disk. With `?composite=true`, sharp alpha-blends up to 100 time-tagged tiles in the requested window — most recent non-transparent pixel wins.

**Why lean breaks it.** No `Missions/` middleware and no local data, so the substituted URL has nothing to answer it.

**Note on option A and the time bar.** When `config.time.enabled === true` but no time-windowed layers survive, `TimeControl_` still renders the full top bar, slider, and play controls. The slider moves but no layer updates — a scrubber that goes nowhere. Option A should pair with forcing `time.enabled = false` at publish when no time-windowed layers remain.

**Options:**

- **A. Hide.** Time-windowed layers don't appear in lean missions. Real capability loss for missions whose value depends on time-scrubbing.
- **B. STAC-backed.** The mission owner uploads the source data to a temporal-aware external service (STAC + a tile server like TiTiler-pgSTAC). Frontend's `TimeControl_` is rewired to drive STAC queries instead of string substitution. STAC mosaicking sorted datetime-descending reproduces both the closest-prior and the alpha-composite behavior. Costs: data hosting is the mission owner's responsibility; one-time frontend rewrite; layer-config schema change.

---

### 2. Drawing tool in dashboards

**What it does.** Admin users collaboratively create, edit, organize, version, and publish vector features (points, lines, polygons, notes, arrows) inside named "files," with templated properties, history/undo, and import/export.

**Why lean breaks it.** Every read and write goes through `/api/draw/*` and `/api/files/*`; dashboards have neither. On open, the file list is empty, no shapes are loadable, and every edit/publish/history action 404s. The rendering pipeline (Leaflet styling, popups) is bundle-only and could still display features if they arrived statically.

**Options:**

- **A. Drop from dashboards.** Hide the tool. Loses even read-only browsing of team annotations.
- **B. Read-only baked snapshot.** At publish, export each Draw file as compiled GeoJSON to S3 and patch the tool to load from those static URLs. Disable add/edit/delete/publish/history/templater UI. Requires forking `DrawTool_Shapes.fetchAllFeatures` and `getFiles`.
- **C. Local-browser-storage editing.** Per-viewer scratchpad backed by IndexedDB/localStorage. No collaboration, no cross-device persistence; templater intersect (depends on `/api/geodatasets/intersect`) stays broken.
- **D. External storage shim.** Point `calls.api` Draw endpoints at a separately deployed backend service. Restores full function; reintroduces a backend and CORS/auth surface that contradicts the no-backend premise.

---

### 3. Search

**What it does.** A top-bar search box finds features in mission layers by typing a value from a configured property (e.g. site name).

**Why lean breaks it.** Two code paths. Vector layers (in-memory GeoJSON) search entirely client-side and keep working. Vectortile / geodataset-backed layers call `POST /api/geodatasets/search`, which 404s in dashboards. The failure callback is a no-op (`Search.js:338`), so the user sees nothing — no pan, no highlight, no error toast.

Unlike tile data, there is no universal search URL contract — OGC API Features, STAC + CQL filter extension, and Elasticsearch/Typesense each speak different protocols — so "point at an external source" requires picking a protocol and wiring the frontend to it, not just changing a URL string.

**Options:**

- **A. Hide search when no vector-layer source exists.** Show the box only when at least one searchable layer is in-memory vector. Vectortile/geodataset searches go away.
- **B. Bake a per-layer search index at publish.** Emit `{key, value, coordinates, featureId}` JSON alongside the tiles; rewire `searchGeodatasets()` to look up locally. Adds bundle size proportional to feature count.
- **C. Convert searchable layers to in-memory vector at publish.** Only viable when feature count is small enough to ship as a GeoJSON FeatureCollection.
- **D. Cross-origin call to a shared admin endpoint.** Restores function; introduces CORS/auth coupling; admin outage equals dashboard search outage.
- **E. Pluggable external search.** Add a search-adapter abstraction so layer configs declare an external service and a protocol (OGC API Features + CQL2, STAC + filter extension, custom). Mission owner hosts the service. Costs: net-new frontend architecture; per-protocol adapter maintenance; layer-config schema extension.

---

### 4. Elevation profile (Measure tool)

**What it does.** Drawing a line in Measure renders a profile chart of elevation samples between the endpoints, fetched from `/api/utils/getprofile` (Python over GDAL).

**Why lean breaks it.** `getprofile` 404s in dashboards. The chart hits its `data.length < 3` fallback (flat zero line, console warning). 2D / 3D distance measurements still work — those are computed client-side.

**Options:**

- **A. Hide the profile chart.** Keep distance-only Measure.
- **B. Client-side sample a baked DEM COG.** Use the already-bundled `geotiff.js` to sample N points along the drawn line, where the mission's DEMs are COG-formatted and reachable.
- **C. External tile-server point queries.** N requests per drag to a public TiTiler `/cog/point`. Slow at high step counts; mission owner hosts the tile server.
- **D. Pre-compute profiles for fixed transects.** Only works for curated measurements, not arbitrary drawing.

---

### 5. Sun-angle compute (Shade tool)

**What it does.** Given a source point and a time, the Shade tool computes solar azimuth/elevation/range at the surface for sunlight modeling. The compute path reads DEM elevation at the source via `/api/utils/getbands`, then calls `/api/utils/ll2aerll` (SPICE-backed) to derive sun geometry. For Mars missions with an observer-specific time field, `/api/utils/chronice` converts UTC ↔ LMST (Local Mean Solar Time) for display.

**Why lean breaks it.** All three routes 404 in dashboards. The compute affordance produces an error toast and the lighting overlay does not update; the LMST input row for Mars observer panels fails to populate (UTC ↔ LMST conversion needs SPICE kernels on disk).

**Options:**

- **A. Hide the compute path.** Keep static-shade rendering only; remove the time/target inputs.
- **B. Pre-compute for a fixed set of times.** Bake azimuth/elevation/range at publish for chosen times; the time picker becomes a discrete selector.
- **C. Client-side compute with baked elevation.** Read elevation via `geotiff.js` against a baked DEM COG, then port the SPICE-equivalent solar math into the bundle. No SPICE-equivalent JS library exists today; this option assumes the team writes or sponsors one. Substantial unbudgeted effort — listed for completeness, not as a near-term path.
- **D. Hide the tool.**

---

### 6. Server-served vector and tabular data (Datasets / Geodatasets / tipg)

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

### 7. Plugin tools in dashboards

**What it does (today).** `API/updateTools.js` codegen scans `src/essence/Tools/*` and any `*Plugin-Tools*` / `*Private-Tools*` sibling directories at build time, writes `src/pre/tools.js` with `import` statements per tool, and Webpack bundles them. The same path runs for both admin and dashboard builds. Plugin backends (`*Plugin-Backend*`) mount Express routes at admin boot.

**Why lean breaks it.** The dashboard bundles every plugin tool present in the build tree — no opt-in/out flag exists. Plugin tools that depend on `calls.api(...)` against backend endpoints silently no-op in dashboard mode (the `SERVER != 'node'` guard at `src/pre/calls.js:169` calls the error callback and returns; many call sites pass no error handler). The tool button stays visible; clicks fire nothing. The same shape applies to plugin-driven layer URL prefixes like `api:tacticaltargets` (handled by a private plugin's `api/tactical/targets` endpoint) — layers using these URLs load as empty.

**Options:**

- **A. Add a `staticCompatible: true|false` flag in each tool's `config.json`.** Dashboard build path filters non-compatible tools out of `src/pre/tools.js`. Tool authors opt in explicitly.
- **B. Hide tool buttons at runtime when `SERVER !== 'node'` and the tool declares backend dependence.** Relies on tool authors marking their tools honestly.
- **C. Two build entrypoints.** `scripts/build.js` (admin) plus a new `scripts/build-static.js` that runs `updateTools` with a static-mode filter and writes a separate `src/pre/tools.static.js`. Cleanest separation; heaviest change.
- **D. Status quo.** Plugin tools that don't work no-op silently; their UI remains. Mission owners avoid configuring them.

---

### 8. Layer-config validation against deployment capability

**What it does (today).** `API/Backend/Config/validate.js` runs on save (and via `POST /api/configure/validate`). It checks structure: required fields, presence of URLs, numeric ranges, duplicate UUIDs, recognized layer types. It does **not** check URL reachability, scheme (`/Missions/...` vs absolute), whether sidecar paths are mounted in the deploy target, or whether referenced tool/kind UUIDs exist.

**Why lean breaks it.** Admin can author a config with `/titiler/...`, `/stac/...`, `/Missions/...`, `geodatasets:...`, or `api:...` URLs that the lean deployment can't fulfill. The config saves cleanly, the dashboard publishes cleanly, and the user sees a broken map with no diagnostic. The same risk applies to full mode if the operator runs without one of the `WITH_*` flags.

**Options:**

- **A. Authoring-time UI hints in Configure SPA.** HEAD-probe URLs on blur in `Maker.js`; warn on 404 or wrong scheme. Lowest friction; misses auth-required URLs and CDN-only paths.
- **B. Save-time backend reject.** Extend `validate.js` with an opt-in reachability probe. Catches errors at save; the admin server's outbound reach may differ from the dashboard runtime.
- **C. Publish-time gate.** New step in the publish task: dry-fetch every URL from the publish runner. Tests from the target perspective (most accurate); slowest; needs new tooling.
- **D. Runtime layer-hide.** If a layer's first fetch 404s, drop it with a console warning. Graceful degradation; does not prevent broken dashboards from shipping.
