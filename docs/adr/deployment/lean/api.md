# `/api/*` handling map (lean)

Per-mount keep/gate decision for the lean deployment. See [`adr.md`](./adr.md) for context.

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
| `/api/draw` | **Keep** | ADR preserves Draw. All routes write Postgres directly. |
| `/api/files` | **Keep** | Draw file-metadata routes (no actual file uploads — no Busboy/multipart in this router). |
| `/api/stac` | **Gate (whole module)** | Proxies the STAC sidecar; sidecar not deployed in lean. |
| `/api/utils` | **Partial** | See breakdown below. |
| `/api/webhooks` | **Keep** | Outbound-event channel: lets external systems react to Draw, Config (and future Dashboards) events. Used by features lean keeps. |
| `/api/testwebhooks` | **Keep** (dev-only) | Already gated on `NODE_ENV === 'development'` regardless of deployment mode. |
| `/api/shortener` | **Gate (whole module)** | Already gated per Phase 5. |

Non-`/api/` mounts worth noting:

| Mount | Handling | Why |
|---|---|---|
| `/configure` | **Keep** | Renders the Configure SPA shell; admin-gated. |
| `/Missions/*` | **Gate** | Static mission-asset middleware; gone in lean per Phase 4. |

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

## Patterns

Three categories cover every gate decision above:

1. **Local-only modules with no data in lean** (Datasets, Geodatasets, Shortener, Stac) — gate the whole module. The data plane is missing; serving routes against it produces silently-broken UX.
2. **Local file/filesystem operations** (Utils GDAL endpoints, `/Missions/*`) — gate, since the filesystem they depend on is gone.
3. **Admin/auth surface that lean still needs** (Users, Accounts, LongTermToken, Config, Draw) — keep.

The only structural exception is `/api/utils`, which is heterogeneous enough to need per-endpoint gating.

## Genuine open questions

- **LongTermToken**: keep is the default, but is admin-script automation an actual lean use case? If not, this could move to "Gate." Cost of being wrong is low — the routes are admin-only.
- **`/api/files` (Draw)**: the route names (`/make`, `/remove`, `/publish`, `/compile`) look upload-adjacent but the implementation is pure Postgres metadata management. Worth double-checking if anyone has been treating these as upload endpoints from an integration; they aren't.

## Related

- [`adr.md`](./adr.md) — full ADR, the Known constraints section enumerates what's dropped.
- [`implementation-plan-keep.md`](./implementation-plan-keep.md) — Phase 3 implements the Datasets/Geodatasets gating; Phase 5 implements Shortener gating; Phase 6 covers the dispatcher table.
- [`implementation-plan-burn.md`](./implementation-plan-burn.md) — same numbering, equivalent edits via deletion instead of gating.
