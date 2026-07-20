# MMGIS deployment-relevant features

Capability-grouped inventory of MMGIS features whose deployment story is decided independently. Each row carries description, runtime dependencies, presence in each deployable (admin / dashboard), and the AWS implementation strategy. Row numbers are stable identifiers — cite as `#NN`.

**Columns:**

- **Description** — what the feature does.
- **Depends on** — what the feature currently needs at runtime.
- **Admin** — presence in the admin stack: `yes` / `no` / `open` / `N/A`.
- **Dashboard** — presence in dashboards: `yes` / `no` / `open` / `N/A`. `open` means the disposition is gated by an open question tracked in the ADRs.
- **AWS** — implementation strategy. First option is the recommended default; alternatives follow.

Open questions affecting these dispositions live in **ADR-A §8** (AWS-infra-scope) and **ADR-B §5** (frontend-scope). Cross-cutting infra questions not yet owned by an ADR are in [`../preserve/overview.md`](../preserve/overview.md).

## Frontend capabilities (in browser bundle)

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Map viewports | 2D map (Leaflet + partial deck.gl), 3D globe (Cesium), image/model/PDF viewer | Mission config, layer data | yes | yes | Bundle on S3+CloudFront |
| 2 | Pure-client tools | Animation, Sites, Kinds, Legend, Layers, Info — operate on already-loaded data | None beyond loaded layers | yes | yes | Bundle |
| 3 | DEM-reading tools | Measure, Curtain, Viewshed, Shade — read elevation tiles client-side | DEM tiles | yes | yes | Bundle + DEM tiles from S3 (see #22) |
| 4 | Heavy-compute tools | Isochrone — travel-time polygons over DEM pixels; today uses server help | DEM tiles, server compute | yes | open | Bundle; backend compute via Lambda or shared service if pure-client isn't viable |
| 5 | Data-querying tools | Identifier, Chemistry — fetch features/values on demand | Geodataset / dataset query | yes | open | Bundle; data path per #20/#21 |
| 6 | Drawing tool | Interactive create/edit/history/publish of user features | Postgres (read+write), WebSocket | no | no | Gated out in lean (D2) — routes not mounted, no Draw in admin or dashboards |
| 7 | Real-time collaboration | WebSocket broadcast: layer-update notifications (Configure → Essence), Configure multi-admin coordination | WebSocket | yes | no | ALB WebSocket on admin ECS task |
| 8 | Time control | Temporal layer windowing + time bar UI | Time-aware data sources | yes | yes | Bundle; needs time-aware data baked or shared |
| 9 | URL state | Shareable `?mapLat=…&on=…&tools=…` links | None | yes | yes | Bundle |
| 10 | mmgisAPI | Public embed/plugin surface on `window.mmgisAPI` | None (delegates to other features) | yes | yes | Bundle; some methods no-op in dashboard |
| 11 | Plugin tools | `*Plugin-Tools*` / `*Private-Tools*` build-time inclusion | Build-time only | yes | yes | Bundle (same codegen in both pipelines) |
| 12 | Landing page | Pre-boot mission selection UI | Mission list (from config) | yes | no | Code ships in bundle but never renders in dashboards (one-mission-per-deploy) |
| 13 | Search UI | Autocomplete + geodataset lookup widget | Server-side search (#27) | yes | open | Bundle; dashboard fate tied to #27 |

## Data sources (frontend reads these)

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | Mission configuration | JSON blob describing layers, tools, view, CRS | Postgres (admin) / baked JSON (dashboard) | yes (Postgres) | yes (baked JSON) | Admin: Postgres row served by Express; dashboard: baked JSON in S3, fetched at boot |
| 15 | Pre-tiled raster imagery | On-disk tile pyramids under `Missions/<name>/Layers/` | File system or S3 | yes | yes | S3+CloudFront |
| 16 | Dynamic raster tile rendering | TiTiler against COGs | TiTiler service + COG storage | yes | open | Shared TiTiler in admin cluster; or pre-bake tile pyramid |
| 17 | STAC catalog | `stac-fastapi-pgstac` browse/search | STAC service + STAC Postgres | yes | open | Shared STAC in admin cluster; or baked STAC JSON |
| 18 | STAC-driven mosaics | TiTiler-pgSTAC dynamic mosaicking | TiTiler-pgSTAC + STAC Postgres | yes | open | Shared TiTiler-pgSTAC in admin cluster, same Postgres as #17 |
| 19 | Vector tiles from PostGIS | tipg | tipg service + Postgres | yes | open | Shared tipg + Postgres; or baked MVT in S3 |
| 20 | Tabular datasets | Datasets module (CSV/JSON tables, query by column) | Postgres | yes (Postgres) | open | Dashboard: baked S3 JSON; or shared admin Postgres read endpoint |
| 21 | Spatial vector datasets | Geodatasets module (PostGIS tables → GeoJSON or MVT) | Postgres (PostGIS) | yes (Postgres) | open | Dashboard: baked S3 GeoJSON/MVT; or shared PostGIS + tipg |
| 22 | DEM tiles | RGBA-encoded elevation tiles | File system or S3 | yes | yes | S3+CloudFront |
| 23 | Feature-attached media | Images/models/PDFs referenced by features | File system or S3 | yes | yes | S3+CloudFront |
| 24 | Velocity grid data | Wind/current/velocity layers — **no current frontend code constructs `/veloserver` URLs**; verify per-mission before provisioning | veloserver service (#41) | open | open | Shared veloserver in admin cluster; or omit (fate tied to #41) |

## Server-only capabilities

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | Configure admin SPA | Mission/layer/dataset/user CRUD UI at `/configure` | Express + Postgres | yes | no | Same ECS task as Express |
| 26 | Mission-asset serving | Path-traversal-hardened static middleware for `/Missions/...` **plus** `_time_` URL convention that composites time-windowed tiles via `sharp` at request time | Express + `sharp` + file system | yes | no | Express in ECS; time-compositing has no dashboard replacement (per-layer pre-bake decision) |
| 27 | Server-side search | Backend search across geodatasets (called by #13) | Express + Postgres (PostGIS) | yes | open | Admin: Express+Postgres; dashboard: client-side index, shared endpoint, or omit |
| 28 | Auth | Local accounts, bcrypt, `MMGISSession` cookie sessions in Postgres | Express + Postgres | yes | shared password | Admin: Postgres-backed sessions; dashboard: CloudFront Function basic auth |
| 29 | Long-term API tokens | Bearer tokens for programmatic access | Postgres | yes | no | Postgres on admin |
| 30 | SSO integration | CSSO header-based identity (off by default) | Upstream proxy headers | open | no | Only if deployment requires; otherwise dormant |
| 31 | Permissions | Active set: `111`/`110`/`001`/`000` (guest); ENUM reserves all 8 values. First-user-becomes-superadmin via `first_signup` | Postgres (`users.permission`) | yes | no | Postgres on admin |
| 32 | File uploads | Busboy ingestion for datasets, geodatasets, mission assets | Express + file system | yes | no | Presigned browser-to-S3 (Busboy still serves small payloads through Express) |
| 33 | Webhooks | Admin-defined HTTP callbacks fired on Config changes | Postgres + outbound HTTP | yes | no | Postgres + outbound HTTP from admin ECS |
| 34 | Link shortener | `(short, full, creator)` redirects | Postgres | open | no | Postgres on admin; or drop entirely |
| 35 | Adjacent-services proxy | Reverse proxy for `/stac`, `/tipg`, `/titiler`, `/titilerpgstac`, `/veloserver` with admin gating | Express + http-proxy-middleware | yes | no | ALB target groups per service; dashboard frontend hits shared URLs directly |
| 36 | Custom adjacent-server registry | `ADJACENT_SERVER_CUSTOM_<N>` env-driven proxy slots | Env vars + Express proxy | yes | no | Env-driven on admin ECS |
| 37 | Pug-rendered shells | Login page, admin login, error page, SPA HTML | Express + Pug | yes | no | Express in ECS; dashboard ships plain static HTML |
| 38 | Swagger UI / OpenAPI | API docs surface at `/api/docs` | Express | yes | no | Express in ECS |
| 39 | Healthcheck endpoint | `/api/utils/healthcheck` (shallow — no DB check) — used by Playwright and ALB target health | Express | yes | N/A | Express in ECS; consumed by ALB target health |
| 40 | Jekyll docs site | The `/docs` static documentation site (third browser app) | Jekyll build, static file serving | yes | open | Admin: S3+CloudFront subpath; dashboard ship-with-or-not TBD |
| 41 | veloserver sidecar | Python service for velocity/weather grid data, proxied at `/veloserver` | NASA-AMMOS Python service | open | open | Shared sidecar in admin cluster; deployment gated on mission-config audit |
| 42 | Backend utility routes | `/api/utils/getprofile` (Measure elevation profile), `/api/utils/getbands` (Identifier band list), `/api/utils/proj42wkt` (Layers tool projection) — Express helpers called via `calls.api`, **not** sidecar URLs | Express + Python helpers | yes | open | Each call needs a per-feature disposition: drop, redirect to sidecar, or compute client-side |

## Persistence

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | Main MMGIS database | Postgres 16 + PostGIS — users, sessions, datasets, geodatasets, configs, tokens (drawings table present but unused; Draw gated out) | Postgres + PostGIS extension | yes | no | Managed Postgres (engine choice TBD per overview open questions) |
| 44 | STAC database (`mmgis-stac`) | Separate Postgres for STAC + TiTiler-pgSTAC, uses pgstac extension | Postgres + pgstac extension | yes | no | Managed Postgres + pgstac; shared with #43 or separate (per overview open questions) |

## Build / ops

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 45 | Plugin-drop codegen | `updateTools()` / `updateComponents()` writing `src/pre/*.js` before Webpack | Node script, build time | yes | yes | Runs in GitHub Actions for both pipelines |
| 46 | Auxiliary GDAL toolbox | Offline data-prep (tiles, DEMs, STAC items, legends, ndGeoJSON) | Python + GDAL, workstation | yes | yes | Workstation; or one-shot GitHub Actions job with output → S3 |
| 47 | Playwright test suite | Single runner for unit + e2e | CI; e2e needs ephemeral server | yes | yes | GitHub Actions; ephemeral admin + Postgres for e2e |
| 48 | Docker Compose stack | MMGIS app, Postgres, optional sidecars via `--profile stac` / `--profile veloserver` | Docker | yes (local dev) | yes (local dev) | Local-dev only; production replaces with ECS / managed Postgres |
| 49 | DB init / migrations | `init-db.js` — creates DBs, installs PostGIS / btree_gist / pgstac, creates session table + indexes | Node script, gates server boot | yes | N/A | One-shot ECS task before admin service starts |

## Cross-cutting

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | Single-origin routing | Express owns `/`, `/api/*`, `/configure`, `/stac`, `/tipg`, `/titiler`, `/veloserver`, `/docs` | Express | yes | N/A (single-origin via CloudFront) | ALB routing on admin; CloudFront on dashboard |
| 51 | CORS / iframe embedding | `FRAME_ANCESTORS` env, embedder reaches in via `iframe.contentWindow.mmgisAPI` | Browser-level + helmet CSP | yes | yes | CloudFront/ALB response headers + helmet CSP |
| 52 | Logging / observability | Winston (pretty in dev, JSON-per-line in prod); password redaction; body/query cropping | stdout / log destination | yes | partial | Admin: CloudWatch Logs; dashboard: CloudFront standard logs to S3 |

## To be built (new in AWS)

Net-new surface introduced by the AWS deployment refactor. Doesn't exist in the current codebase; tracked here so the inventory covers both lift-and-shift and additions.

| # | Feature | Description | Depends on | Admin | Dashboard | AWS |
| --- | --- | --- | --- | --- | --- | --- |
| 53 | Dashboard publishing pipeline | Publish/teardown Express handler + spawned bake-and-provision task + IAM-scoped SDK calls | ECS RunTask + AWS SDK + admin Postgres | yes (net-new) | N/A | Spawned ECS task per publish (ADR-A §5.1) |
| 54 | Per-dashboard runtime resources | S3 bucket + CloudFront distribution + CloudFront Function (password gate) + DNS record, one set per dashboard | AWS S3, CloudFront, Route 53 | N/A | yes (net-new) | One set per dashboard, provisioned at publish time (ADR-A §3.1) |
| 55 | Deployments admin UI + registry | New `deployments` table on admin Postgres + a Deployments page in Configure with async-job status polling | Configure SPA + admin Postgres | yes (net-new) | N/A | New Configure page + new Postgres table (ADR-A §5.3) |

## Conventions

- **Rows with `Depends on: None`** are pure client and trivially survive in dashboards.
- **Rows ending in a `#NN` reference** point to another row this row depends on — typically the server-only feature backing a frontend capability.
- **Data-source rows** (#14–24) are decision-heavy: each one's dashboard form is either baked into S3 at publish time, or served by a shared sidecar. The bake-vs-shared threshold is an ADR-A open question.
- **Server-only rows** (#25–42) are mostly "admin yes / dashboard no," with exceptions called out per row.
- **Persistence rows** (#43–44) are shared-resource candidates in AWS — see overview cross-cutting open questions for the shared-vs-separate decision.
- **Build/ops rows** affect CI pipeline design, not runtime topology.
- **Cross-cutting rows** apply to both deployables in some form.
- **To-be-built rows** are the net-new surface introduced by the deployment refactor.
