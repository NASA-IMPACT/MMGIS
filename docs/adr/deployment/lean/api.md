# `/api/*` handling map (lean)

Server-side `/api/*` mount handling and the frontend `calls.js` dispatcher for the lean deployment. See [`adr.md`](./adr.md) for context.

This file covers two related but distinct surfaces:

1. **Server-side mounts** (the admin) — which `/api/*` routes the admin process exposes in lean. Covered in the `Map` and `/api/utils breakdown` sections.
2. **Frontend dispatcher** (the dashboard) — what each of the 40 entries in `src/pre/calls.js` does at runtime when `mmgisglobal.SERVER === 'static'`. Covered in the `Frontend dispatcher` section.

**Legend:**

- **Keep** — mounts in lean as it does in full.
- **Gate (whole module)** — entire module's routes do not mount in lean. The Sequelize model still syncs (table created, never touched) so a future mode flip needs no migration.
- **Partial** — some endpoints stay, others gate. Detail inline.

## Map

| Mount | Handling | One-line why |
|---|---|---|
| `/api/users` | **Keep** (disable `first_signup`) | Admin auth. `first_signup` is a security gap — gated by `DISABLE_FIRST_SIGNUP=true` per Phase 9. |
| `/api/accounts` | **Keep** | Admin user CRUD. |
| `/api/longtermtoken` | **Keep** | Bearer tokens for admin scripting against the lean admin API. |
| `/api/configure` | **Keep** | Mission config CRUD — the admin's purpose. |
| `/api/datasets` | **Gate (whole module)** | 100% local Postgres; no uploads in lean = no data to read. Per Phase 3. |
| `/api/geodatasets` | **Gate (whole module)** | 100% local PostGIS; same logic as Datasets. Per Phase 3. |
| `/api/draw` | **Gate (whole module)** | Draw is gated out in lean (D2) — router not mounted, no Draw in admin or dashboards. |
| `/api/files` | **Gate (whole module)** | Draw file-metadata routes; gated out with Draw (D2). |
| `/api/stac` | **Gate (whole module)** | Proxies the STAC sidecar; sidecar not deployed in lean. |
| `/api/utils` | **Partial** | See breakdown below. |
| `/api/webhooks` | **Keep** | Outbound-event channel: lets external systems react to Config (and future Dashboards) events. Used by features lean keeps. |
| `/api/testwebhooks` | **Keep** (dev-only) | Already gated on `NODE_ENV === 'development'` regardless of deployment mode. |
| `/api/shortener` | **Gate (whole module)** | Already gated per Phase 5. |
| `API/Backend/Upload` (`createUploadRouter`, #103) | **Keep — repoint to S3** | `setup.js` mounts a single admin route (`/api/upload`, `ensureAdmin`); `createUploadRouter` is the factory behind it. In lean its storage backend swaps from `Missions/<mission>/...` on disk to the S3 asset bucket, returning a root-relative `/assets/…` path (served same-origin per deployment; see PR 10). Image-only / 5 MB / path-traversal validators unchanged; the validator allows `image/svg+xml` — intentional (trusted admins). Depends on #103 merging. |

Non-`/api/` mounts worth noting:

| Mount | Handling | Why |
|---|---|---|
| `/configure` | **Keep** | Renders the Configure SPA shell; admin-gated. |
| `/Missions/*` | **Gate** | Static mission-asset *serving* middleware; gone in lean per Phase 4. Uploaded assets are served from the S3 asset bucket / CloudFront instead (see `Upload` row above). |

## `/api/utils` breakdown

Utils is a grab-bag. Per-endpoint:

| Endpoint | Handling | Reason |
|---|---|---|
| `GET /healthcheck` | **Keep** | ECS/ALB health probe. |
| `GET /queryTilesetTimes` | **Gate** | Reads from `Missions/`; that tree doesn't exist in lean. |
| `POST /getprofile` | **Gate** | Python+GDAL shellout against a local DEM in `Missions/`. |
| `POST /getbands` | **Gate** | Python+GDAL shellout against a local raster in `Missions/`. |
| `POST /getminmax` | **Gate** | Python+GDAL shellout against a local raster in `Missions/`. |
| `POST /ll2aerll` | **Gate** | Python coord-transform script; no caller without local data. |
| `POST /chronice` | **Gate** | Python time-op script; no caller in lean. |
| `GET /proj42wkt` | **Keep** (optional) | Pure compute (proj4 → WKT). Harmless either way. |

## Server-side patterns

Three categories cover every gate decision above:

1. **Local-only modules with no data in lean** (Datasets, Geodatasets, Shortener, Stac, Draw, Files) — gate the whole module. The data plane is missing (or, for Draw, gated out per D2); serving routes against it produces silently-broken UX.
2. **Local file/filesystem operations** (Utils GDAL endpoints, `/Missions/*`) — gate, since the filesystem they depend on is gone.
3. **Admin/auth surface that lean still needs** (Users, Accounts, LongTermToken, Config) — keep.

The only structural exception is `/api/utils`, which is heterogeneous enough to need per-endpoint gating.

---

## Frontend dispatcher

The dashboard frontend uses the same `src/pre/calls.js` dispatcher as the admin. With `mmgisglobal.SERVER = 'static'` (vs `'node'`), the dispatcher's static branch activates and routes each named call into one of four handlers:

- **Bake** — answer frozen into the bundle at publish, served from `STATIC_MISSION_CONFIG`.
- **Reroute** — point at an external URL supplied by the mission config. `getminmax` reroutes to the external TiTiler (a call-site reroute — it's a direct `$.ajax` outside the dispatcher); general sidecar URL substitution happens in `serviceUrls.js`.
- **Compute** — answer computed client-side, typically from values baked into the mission config at publish or read directly from the COG/data file.
- **Drop** — return a graceful error or no-op. Used for write paths, auth, anything tied to dropped modules.

The table describes **runtime dashboard behavior** and is variant-invariant. Burn and keep produce the same observable dashboard; source-level differences (burn removes some dispatcher entries; keep gates them) are implementation-plan content (Phase 6), not dispatcher content.

40 entries today; counts in the Patterns subsection. Re-grep `src/pre/calls.js` before locking — the regex `^    [a-zA-Z0-9_]+: \{$` catches all 40 (a `[a-z_]+` pattern silently misses `ll2aerll` and `proj42wkt`).

| Call | URL | Disposition | One-line why |
|---|---|---|---|
| `get` | `/api/configure/get` | Bake | Mission config baked into `STATIC_MISSION_CONFIG`. |
| `get_generaloptions` | `/api/configure/getGeneralOptions` | Bake | General options baked at publish. |
| `missions` | `/api/configure/missions` | Bake | One mission per dashboard; baked mission list. |
| `login` | `/api/users/login` | Drop | Dashboards are anonymous read-only; CloudFront Function gates access. |
| `signup` | `/api/users/signup` | Drop | No user management in dashboards. |
| `logout` | `/api/users/logout` | Drop | No session to clear. |
| `getbands` | `/api/utils/getbands` | Drop | Plain-`.tif` pixel queries; Identifier forces `trueValue=false` in static mode, falling back to legend-matched RGB (see PR 7). |
| `getprofile` | `/api/utils/getprofile` | Drop | Elevation profile; UI hides by default (see feature-gaps *Default disposition: Elevation profile*). |
| `getminmax` | `/api/utils/getminmax` | Reroute | Band min/max fetched from the external TiTiler (e.g. `/cog/statistics`); lean always serves COG via an external TiTiler. Direct `$.ajax` in `Map_.js`, so it's a call-site reroute, not a dispatcher entry. |
| `ll2aerll` | `/api/utils/ll2aerll` | Drop | SPICE sun-geometry compute; feature-gaps *Default disposition: Sun-angle compute*. |
| `chronice` | `/api/utils/chronice` | Drop | SPICE LMST conversion; feature-gaps *Default disposition: Sun-angle compute*. |
| `proj42wkt` | `/api/utils/proj42wkt` | Compute | WKT baked into mission config or converted via `proj4js` at runtime. |
| `draw_add` | `/api/draw/add` | Drop | Drawing drops in dashboards by default (see feature-gaps *Default disposition: Drawing tool*). |
| `draw_edit` | `/api/draw/edit` | Drop | Same as `draw_add`. |
| `draw_remove` | `/api/draw/remove` | Drop | Same as `draw_add`. |
| `draw_undo` | `/api/draw/undo` | Drop | Same as `draw_add`. |
| `draw_merge` | `/api/draw/merge` | Drop | Same as `draw_add`. |
| `draw_split` | `/api/draw/split` | Drop | Same as `draw_add`. |
| `draw_aggregations` | `/api/draw/aggregations` | Drop | Same as `draw_add`. |
| `files_getfiles` | `/api/files/getfiles` | Drop | Same as `draw_add`. |
| `files_getfile` | `/api/files/getfile` | Drop | Same as `draw_add`. |
| `files_make` | `/api/files/make` | Drop | Same as `draw_add`. |
| `files_remove` | `/api/files/remove` | Drop | Same as `draw_add`. |
| `files_restore` | `/api/files/restore` | Drop | Same as `draw_add`. |
| `files_change` | `/api/files/change` | Drop | Same as `draw_add`. |
| `files_modifykeyword` | `/api/files/modifykeyword` | Drop | Same as `draw_add`. |
| `files_compile` | `/api/files/compile` | Drop | Same as `draw_add`. |
| `files_publish` | `/api/files/publish` | Drop | Same as `draw_add`. |
| `files_gethistory` | `/api/files/gethistory` | Drop | Same as `draw_add`. |
| `shortener_shorten` | `/api/shortener/shorten` | Drop | Link shortener not deployed. |
| `shortener_expand` | `/api/shortener/expand` | Drop | Link shortener not deployed. |
| `clear_test` | `/api/draw/clear_test` | Drop | Test-only; no production caller. |
| `tactical_targets` | `/api/tactical/targets` | Drop | Private-plugin endpoint; see feature-gaps decision §3 (Plugin tools). |
| `datasets_get` | `/api/datasets/get` | Drop | Datasets module dropped; popup behavior per feature-gaps decision §2 (Datasets / Geodatasets / tipg). |
| `geodatasets_get` | `/api/geodatasets/get` | Drop | Geodatasets module dropped; see feature-gaps decision §2. |
| `geodatasets_intersect` | `/api/geodatasets/intersect` | Drop | Geodatasets module dropped; see feature-gaps decision §2. |
| `geodatasets_aggregations` | `/api/geodatasets/aggregations` | Drop | Geodatasets module dropped; see feature-gaps decision §2. |
| `geodatasets_search` | `/api/geodatasets/search` | Drop | Geodatasets module dropped; UI hides search box when no in-memory vector layer is searchable (feature-gaps *Default disposition: Search*). |
| `spatial_published` | `/api/spatial/published` | Drop | Response is `console.log`'d and never consumed (dead path). |
| `query_tileset_times` | `/api/utils/queryTilesetTimes` | Drop | Time-slider histogram is disabled in lean (not needed); `_makeHistogram` no-ops in static mode. Time scrubbing/animation unaffected. |


The `Drop` entries cluster around two root causes: (a) write paths and auth flows that have no place in an anonymous read-only dashboard, (b) calls against admin-only modules (Draw, Datasets, Geodatasets, Shortener, plugin-provided endpoints) that don't ship in lean.

Only `proj42wkt` remains a `Compute` entry — a trivial client-side proj4→WKT conversion (`proj4js` is already bundled). `getminmax` reroutes to the external TiTiler's statistics endpoint (lean always serves COG externally), and `query_tileset_times` is dropped (the time-slider histogram is disabled in lean). See [PR 9](./prs/pr-09-publish-time-bakes.md) for the call-site details.

## Genuine open questions

- **LongTermToken**: keep is the default, but is admin-script automation an actual lean use case? If not, this could move to "Gate." Cost of being wrong is low — the routes are admin-only.

## Related

- [`adr.md`](./adr.md) — full ADR, the Known constraints section enumerates what's dropped.
- [`feature-gaps.md`](./feature-gaps.md) — what each dropped call meant for the user and how dashboards handle the loss. Organized into *Default disposition* (hide-by-default features with documented escape hatches) and *Real architectural decisions* (the three genuinely open product/architecture choices).
- [`prs/`](./prs/) — per-PR implementation docs (sequenced in [`pr-breakdown.md`](./pr-breakdown.md)): PRs 3–4 gate Datasets/Geodatasets/Draw, PR 5 gates the Shortener, and PR 7 wires the dispatcher table.
