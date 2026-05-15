# MMGIS split plan

## What we're doing

- Split MMGIS into two deployables: a **config admin** (close to today's app) and **static builds** (frozen, read-only frontends).
- Deploy the config admin to AWS — ECS Fargate + RDS + ALB, preserving the current Express / Postgres / sidecar shape.
- From inside the admin, **publish static builds** to AWS — S3 + CloudFront per build, gated by a shared password.
- Back static builds with **shared AWS-hosted services** (TiTiler, STAC, tipg, optionally RDS read endpoints) where baking doesn't scale.
- Decide per feature whether it survives in static: drop, bake at build time, or point at a shared service.
- Keep the admin codebase as close to current as possible; refactor only what the split forces.

## Fixed assumptions

- One config admin instance, many static builds.
- Static-build access = single shared password (CloudFront Function basic auth by default).
- Bake-vs-shared decided per data feature; default toward baking, shared service when bake doesn't scale.
- Same row set across all sections; numbers are stable identifiers.

## Legend

One table per section. Each row = one feature with a deployment decision and AWS option. Open questions are referenced as `Q#` and listed at the bottom.

- **Admin** / **Static**: presence in each deployment. `yes` / `no` / `open` / `N/A`.
- **AWS**: brief option(s). First option = recommended default.
- **Notes**: `Q#` references open questions; otherwise `—`.

## Frontend capabilities (in browser bundle)

| #   | Feature                                                          | Admin       | Static            | AWS                                                                | Notes |
| --- | ---------------------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------ | ----- |
| 1   | Map viewports (2D Leaflet/deck.gl, 3D Cesium, image/model viewer)| yes         | yes               | bundle on S3+CloudFront                                            | —     |
| 2   | Pure-client tools (Animation, Sites, Kinds, Legend, Layers, Info)| yes         | yes               | bundle                                                             | —     |
| 3   | DEM-reading tools (Measure, Curtain, Viewshed, Shade)            | yes         | yes               | bundle + DEM tiles from S3 (#22)                                   | —     |
| 4   | Heavy-compute tools (Isochrone)                                  | yes         | open              | bundle; or backend compute via Lambda                              | Q1    |
| 5   | Data-querying tools (Identifier, Chemistry)                      | yes         | open              | bundle; data per #20/#21                                           | Q2    |
| 6   | Drawing tool                                                     | yes         | open              | admin: ECS+RDS; static: drop / read-only / local-only              | Q3    |
| 7   | Real-time collaboration (WebSocket: Draw sync, presence)         | yes         | no                | ALB WebSocket on admin ECS task                                    | —     |
| 8   | Time control (temporal windowing + UI)                           | yes         | yes               | bundle; needs time-aware data baked or shared                      | —     |
| 9   | URL state (shareable links)                                      | yes         | yes               | bundle                                                             | —     |
| 10  | mmgisAPI (window.mmgisAPI surface)                               | yes         | yes               | bundle; some methods no-op in static                               | —     |
| 11  | Plugin tools (`*Plugin-Tools*` build-time inclusion)             | yes         | yes               | bundle (built by same codegen in both pipelines)                   | —     |
| 12  | Landing page / mission picker                                    | yes         | open              | bundle; picker moot if 1 mission per static deploy                 | Q4    |
| 13  | Search UI (autocomplete + lookup widget)                         | yes         | open              | bundle; fate tied to #27                                           | Q5    |

## Data sources

| #   | Feature                                                          | Admin       | Static            | AWS                                                                | Notes |
| --- | ---------------------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------ | ----- |
| 14  | Mission configuration (JSON: layers, tools, view, CRS)           | yes (RDS)   | yes (baked JSON)  | admin: RDS row served by Express; static: S3 JSON fetched at boot  | —     |
| 15  | Pre-tiled raster imagery (tile pyramids)                         | yes         | yes               | S3+CloudFront                                                      | —     |
| 16  | Dynamic raster tile rendering (TiTiler against COGs)             | yes         | open              | shared TiTiler on Fargate; or pre-bake tile pyramid                | Q6    |
| 17  | STAC catalog (`stac-fastapi-pgstac`)                             | yes         | open              | shared Fargate + Aurora (pgstac); or baked STAC JSON               | Q6    |
| 18  | STAC-driven mosaics (TiTiler-pgSTAC)                             | yes         | open              | shared Fargate, same Aurora as #17                                 | Q6    |
| 19  | Vector tiles from PostGIS (tipg)                                 | yes         | open              | shared tipg + RDS; or baked MVT in S3                              | Q6    |
| 20  | Tabular datasets (CSV/JSON, query by column)                     | yes (RDS)   | open              | static: S3 JSON; or shared RDS read endpoint                       | Q7    |
| 21  | Spatial vector datasets (PostGIS → GeoJSON or MVT)               | yes (RDS)   | open              | static: S3 GeoJSON/MVT; or shared PostGIS + tipg                   | Q7    |
| 22  | DEM tiles (RGBA-encoded elevation)                               | yes         | yes               | S3+CloudFront                                                      | —     |
| 23  | Feature-attached media (images/models/PDFs)                      | yes         | yes               | S3+CloudFront                                                      | —     |
| 24  | Velocity grid data (wind/current layers)                         | yes         | open              | shared veloserver Fargate (#41); or omit                           | Q8    |

## Server-only capabilities

| #   | Feature                                                          | Admin       | Static            | AWS                                                                | Notes |
| --- | ---------------------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------ | ----- |
| 25  | Configure admin SPA (mission/layer/dataset/user CRUD UI)         | yes         | no                | same ECS task as Express                                           | —     |
| 26  | Mission-asset serving (path-traversal middleware + `sharp` time-compositing) | yes | no   | Express in ECS                                                     | time-compositing has no static replacement |
| 27  | Server-side search (geodataset search backing #13)               | yes         | open              | admin: Express+RDS; static: client index, shared service, or omit  | Q5    |
| 28  | Auth (local accounts, bcrypt, `MMGISSession` sessions)           | yes         | shared password   | admin: RDS-backed sessions; static: CloudFront Function basic auth | —     |
| 29  | Long-term API tokens (Bearer tokens)                             | yes         | no                | RDS on admin                                                       | —     |
| 30  | SSO integration (CSSO header-based)                              | open        | no                | only if NASA-internal deployment requires                          | Q9    |
| 31  | Permissions (`111`/`110`/`001`, first-user-becomes-admin)        | yes         | no                | RDS on admin                                                       | —     |
| 32  | File uploads (Busboy ingestion)                                  | yes         | no                | direct browser-to-S3 via presigned POST                            | —     |
| 33  | Webhooks (admin-defined HTTP callbacks)                          | yes         | no                | RDS + outbound HTTP from ECS                                       | —     |
| 34  | Link shortener (`(short, full, creator)` redirects)              | open        | no                | RDS on admin; or drop entirely                                     | Q10   |
| 35  | Adjacent-services proxy (`/stac`, `/titiler`, etc.)              | yes         | no                | ALB target groups per service; static frontend hits shared URLs    | —     |
| 36  | Custom adjacent-server registry (`ADJACENT_SERVER_CUSTOM_<N>`)   | yes         | no                | env-driven on admin ECS                                            | —     |
| 37  | Pug-rendered shells (login, error, SPA HTML)                     | yes         | no                | Express in ECS                                                     | static ships plain HTML |
| 38  | Swagger UI / OpenAPI (`/api/docs`)                               | yes         | no                | Express in ECS                                                     | —     |
| 39  | Healthcheck endpoint (`/api/utils/healthcheck`)                  | yes         | no                | Express; used by ALB target health                                 | —     |
| 40  | Jekyll docs site (`/docs`)                                       | yes         | open              | S3+CloudFront subpath, or separate bucket                          | Q11   |
| 41  | veloserver sidecar (velocity-grid Python service)                | yes         | open              | shared Fargate; fate tied to #24                                   | Q8    |

## Persistence

| #   | Feature                                                          | Admin       | Static            | AWS                                                                | Notes |
| --- | ---------------------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------ | ----- |
| 42  | Main MMGIS DB (Postgres + PostGIS)                               | yes         | no                | RDS Postgres; or Aurora Serverless v2                              | —     |
| 43  | STAC DB `mmgis-stac` (Postgres + pgstac)                         | open        | open              | shared Aurora cluster with #42; or separate                        | Q6, Q12 |

## Build / ops

| #   | Feature                                                          | Admin       | Static            | AWS                                                                | Notes |
| --- | ---------------------------------------------------------------- | ----------- | ----------------- | ------------------------------------------------------------------ | ----- |
| 44  | Plugin-drop codegen (`updateTools`/`updateComponents`)           | yes         | yes               | runs in CodeBuild / GH Actions for both pipelines                  | —     |
| 45  | Auxiliary GDAL toolbox (offline data prep)                       | yes         | yes               | workstation or one-shot CodeBuild job; output → S3                 | —     |
| 46  | DB init / migrations (`init-db.js`)                              | yes         | no                | one-shot ECS task before service starts                            | —     |
| 47  | Logging / observability (Winston)                                | yes         | yes               | admin: CloudWatch Logs; static: CloudFront standard logs to S3     | —     |

## Open questions

- **Q1 (#4):** Is Isochrone viable pure-client (web workers, small areas), or does it need a backend even in admin? If backend, Lambda or shared compute service.
- **Q2 (#5):** Identifier/Chemistry static fate hinges on #20/#21 — if data is baked, these work; if shared, they call shared service.
- **Q3 (#6):** Drawing in static — drop entirely, read-only display of baked features, or invest in a "local browser-storage only" editing mode?
- **Q4 (#12):** Does any static deployment ever host multiple frozen missions, or is it always one-mission-per-deploy?
- **Q5 (#13/#27):** Server-side search in static — replace with client-side index over baked data, point at a shared search service, or omit search entirely?
- **Q6 (#16–#19, #43):** For each tile/feature service, bake threshold vs shared service. Likely needs a per-mission default + override mechanism.
- **Q7 (#20/#21):** Tabular and spatial dataset thresholds: at what size do we stop baking JSON and start hitting a shared RDS read endpoint?
- **Q8 (#24/#41):** Is velocity data actually used by current missions? If not, drop the whole row + sidecar.
- **Q9 (#30):** Does the config admin ever deploy in an environment where NASA CSSO is required?
- **Q10 (#34):** Is the link shortener used? If not, drop everywhere.
- **Q11 (#40):** Does the static deployment need to ship the `/docs` site, or does docs live only on the admin?
- **Q12 (#43):** One shared Aurora cluster for both #42 and #43, or separate RDS instances? Cost vs blast radius.

## Open questions for AWS architecture (not per-feature)

- One Aurora cluster shared across admin + shared services, or separate?
- VPC layout: shared VPC for admin + shared services, or separate?
- Per-build CloudFront distribution vs one distribution with path-based routing — isolation vs cost.
- Do shared services (TiTiler, STAC, tipg, veloserver) need their own auth layer (API keys, IAM-signed) beyond "shared password gates the static frontend"?
- Secrets: Secrets Manager vs SSM Parameter Store.
- CI: GitHub Actions vs CodePipeline + CodeBuild.
