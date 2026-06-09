# ADR-A: AWS deployment

**Status:** Proposed — Under Review
**Date:** 2026-05-19

## 1. Scope

This ADR covers the AWS infrastructure for both deployables introduced in the [overview](./overview.md): the admin stack, the dashboard infrastructure, and the cross-cutting concerns that connect them (URL topology, publish flow, shared sidecars, data layout).

Frontend code changes that support dashboard mode are covered in [ADR-B](./adr-b-frontend-refactor.md). Per-feature drop/survive disposition is in [`features.md`](../shared/features.md).

The stakeholder-given intent and requirements are in the overview and are treated as constraints here.

## 2. Admin stack

The admin stack runs today's MMGIS application image on AWS as a containerized service alongside its data and sidecars. The shape mirrors today's Docker-compose stack: one Node process serving the admin tool, the main map app, and the sidecar proxy; managed Postgres holding the same data it holds today; S3 in place of the local `Missions/` filesystem for raster assets.

### 2.1 Compute, sidecar routing, and the admin write gate

Compute platform, how the browser reaches sidecars, and how admin → sidecar writes are gated are one coupled decision.

The load-bearing question: does the admin's gate on sidecar writes — specifically STAC, the only sidecar with a real write surface (TiTiler and tipg are read-only; veloserver TBD per Q-VELO) — stay in today's server proxy, or get rebuilt at the edge?

**Three coherent bundles:**

- **Bundle 1: Today's shape, ported.** Full ECS Fargate. Sidecars run internal-only on the same cluster, reachable only from the admin container via service discovery. Admin's Express server proxies `/titiler`, `/stac`, etc. internally; today's `ensureAdmin` middleware on those routes is the write gate, unchanged. Zero net-new auth code, zero frontend code change. We manage the ALB, listener rules, target groups, canary configs, and scaling policies.

- **Bundle 2: Express Mode for admin.** ECS Express Mode for the admin task; sidecars still internal-only on service discovery. Server proxy and admin gate preserved (zero auth or frontend code change). AWS manages ALB, canary, and scaling. Cost: Express Mode is six months old (announced November 2025) and locks deployment strategy to canary and load-balancer config to ECS-managed; migrating out later is a real migration, not a config change.

- **Bundle 3: Subdomain per service.** Each sidecar gets its own subdomain; the ALB routes directly; the server proxy goes away. TiTiler and tipg become directly reachable (read-only anyway). STAC writes need a net-new gate — Lambda@Edge JWT authorizer, hybrid proxy for writes only (reads direct, writes via admin), or service-side auth on STAC. The frontend's inline sidecar URL builders (see [ADR-B §2.3](./adr-b-frontend-refactor.md#23-telling-the-frontend-where-the-sidecars-live)) get centralized into a helper and pointed at subdomains. 

Self-managed EC2 stays viable as a sidetrack to all three bundles (writable local disk would let `Missions/` stay on disk instead of moving to S3) but trades that against AMI / host-patching ops; we don't pursue it here.


**Open:** Q-COMPUTE.

### 2.2 Database

**Decision:** One Postgres instance, two logical databases (the main MMGIS database and `mmgis-stac`).

This mirrors today's `docker-compose.db.yml` — they already coexist on one Postgres with no signal STAC will outgrow it. A two-instance split is straightforward to add later if the workload diverges; doing it now is operational overhead without a payoff.

Sessions stay Postgres-backed (no code change). The dashboards registry (§5.3) is a new table on the same instance.

### 2.3 Networking and TLS

CloudFront is AWS's CDN — it caches static assets at edge locations and gives a place to attach WAF rules or request-level logic. The dashboards already sit behind CloudFront. The question is whether the admin should too.

**Decision:** CloudFront in front of the admin load balancer?

**Options:**

- *Add CloudFront.* CDN-cached static assets, single domain shape, optional WAF integration. Cache rules need to whitelist API and WebSocket paths so they bypass the cache.
- *Skip CloudFront.* Admin hits the load balancer directly. Fewer resources.

**Recommended:** Add CloudFront.

**Why:** Small cost; gives the admin and dashboards a consistent shape (everything fronted by CloudFront).

### 2.4 Mission asset storage and uploads

Raster mission assets — the tile pyramids, DEMs, and basemap imagery that lived in the `Missions/` folder — move to S3. Postgres-backed data (datasets, geodatasets, configs, drawings) stays in Postgres. There are two upload paths to settle: the existing admin UI flow, and the workstation workflow that today bypasses the UI entirely.

A "presigned URL" is an S3 feature where the server hands the browser a temporary URL granting upload permission for one specific object. The browser then PUTs the file straight to S3 — the server is involved only in handing out the URL.

#### (a) UI upload path

Today's admin UI accepts uploads through Busboy (dataset CSVs, geodataset GeoJSON/MVT, individual mission asset files), capped at 500MB and written to the local filesystem. In AWS the byte path has to end at S3 instead of disk.

**Decision:** Switch the UI upload path to presigned browser-to-S3. The admin server hands back a presigned URL; the browser PUTs the file directly to S3.

**Why:** Through-server upload (admin receives bytes, writes them to S3) pins upload bandwidth to the admin service and risks timeouts on multi-GB files. Presigned lifts the bytes off the admin entirely and is the standard pattern for browser-to-S3 in AWS.

#### (b) Tile pyramid workflow

Today, mission operators handle big raw imagery on their workstation: run a GDAL script, get a tile pyramid (a folder of thousands of small tile images), then `scp` the folder into MMGIS's `Missions/` directory. The UI is not used. In AWS there's no shared filesystem to `scp` to, and admin users won't have direct AWS credentials — everything goes through the admin UI.

The question: how does a tile pyramid (thousands of files, many GB) get from a workstation into S3 via the admin UI? Presigned handles one big file fine, but a pyramid is many files.

**Options:**

- *Upload as a single archive.* Operator zips the pyramid, uploads the archive via presigned, a backend task extracts it back into S3. One operator action; reintroduces a backend step in the upload path.
- *Bulk multi-file upload.* Browser fires off many presigned uploads in parallel. Works for small pyramids; brittle for big ones (browser memory, dropped connections, no resumability).
- *Shift the production format to COGs.* A Cloud-Optimized GeoTIFF is one file containing the whole pyramid; TiTiler serves tiles from it on demand. Operators run `tifs2cogs` (already in `auxiliary/stac/`) instead of `gdal2customtiles`. One file, standard upload. Requires migrating existing tile-pyramid layers in mission configs.

**Open:** Q-BIG-UPLOAD. Once the workflow is settled, the per-file size cap follows from it and is a deploy-time config value.

### 2.5 Authentication

The auth model is unchanged from today: local accounts with Postgres-backed sessions, optional CSSO. Production runs `local` by default, or `csso` when upstream SSO is required.

One bootstrap concern under `local`: a fresh deploy with no users exposes a first-signup endpoint that grants superadmin to whoever hits it first — a public-internet race. Doesn't apply to `csso` (identity comes from upstream).

**Decision:** Seed the first superadmin in the init task using credentials injected as env vars at task launch from AWS Secrets Manager, GitHub Actions secrets, etc.

## 3. Dashboard infrastructure

Each published dashboard is one mission's frozen frontend, deployed to its own AWS footprint. Dashboards have no backend of their own — only what the admin stack and sidecars offer over the network.

Dashboards are strictly one-mission-per-deploy: a single published dashboard always loads exactly one frozen mission, with no mission-picker UI and no `?mission=` switching. If a use case calls for "the same map app showing several missions," that's several dashboards, each published independently. This matches how the publish flow (§5) is described (one mission read, one bundle built, one set of AWS resources provisioned) and removes a class of cross-mission state questions from the dashboard codebase.

### 3.1 Per-dashboard resources

Each dashboard gets:

- **One S3 bucket.** The JS bundle, the baked mission config, and any per-dashboard baked data (small GeoJSON, small CSV, etc.).
- **One CloudFront distribution** in front of the bucket. Default behavior: serve the SPA shell for unknown paths. Static assets cache aggressively; the baked config is fingerprinted and immutable.
- **One CloudFront Function** as the password gate, attached to the viewer-request event. Browser basic auth, checked at the CDN edge.
- **One DNS record** pointing the chosen subdomain at the distribution.

No backend, no database, no per-dashboard sidecar.

### 3.2 What dashboards read at runtime

For each kind of data a dashboard needs:

- **Mission configuration.** Baked into the JS bundle at publish time. No request.
- **Raster tiles, DEMs, basemap imagery.** Fetched from S3 via CloudFront — usually from the admin's shared S3 bucket. The data already lives there from when admins uploaded it; no per-dashboard copy needed.
- **Small per-mission tabular or vector data.** Baked into the dashboard's own S3 bucket at publish time as JSON or GeoJSON, fetched as a static asset.
- **Larger tabular or vector data.** Queried dynamically from a shared sidecar (TiTiler for raster mosaics, tipg for PostGIS vector tiles, a custom endpoint for tabular search). Dashboards never connect to Postgres directly.

The dashboard doesn't have to resolve any of this at runtime — every URL it needs is already in the baked mission config. Each layer's URL is rewritten at publish time to point wherever its data actually ended up: an absolute URL into admin's S3, a relative URL into the dashboard's own bucket, or an absolute sidecar URL. The static-vs-dynamic choice only affects which origin serves the bytes, not when they load.

### 3.3 Authentication

The gate is a CloudFront Function — a tiny piece of JavaScript that runs at the CDN edge before any request reaches S3, checks an `Authorization` header against a known password, and returns 401 if it doesn't match. The browser handles the password prompt as standard basic auth. What's left to decide is whether all dashboards share one password or each gets its own.

**Decision:** One shared password across all dashboards, or per-dashboard passwords?

**Options:**

- *Single shared password.* One value baked into every dashboard's Function. Trivial to manage; one secret to rotate. But revoking access to a single dashboard means rotating the password for *all* dashboards.
- *Per-dashboard password.* Each distribution's Function is configured with its own password. The main cost is actually managing the passwords for each dashboard.

**Open:** Q-AUTH-1.

## 4. URL topology

Two stakeholder-facing URL choices, independent of each other:

- What URL shape does each dashboard expose to users? → §4.1.
- What URL shape do dashboards use to reach the sidecars? → §4.2.

Each is presented as a set of options with the infra each requires. The admin's own URL shape (`/api`, `/configure`, `/Missions/*`, etc.) stays as today regardless of either choice and is not a stakeholder question.

**Today's URL discipline, for context.** Current MMGIS is single-origin, everything path-prefixed under optional `ROOT_PATH`: `/` (map app, mission via `?mission=` query param), `/api/*`, `/configure`, `/stac`, `/tipg`, `/titiler`, `/titilerpgstac`, `/veloserver`, `/Missions/*`, `/docs/*`. Missions today are *application state*, not URL routing — the `?mission=` query param picks which mission's config is loaded against the same host and paths. Dashboards are the first time mission identity would land in the URL structure itself.

### 4.1 Dashboard URL shape

How does each published dashboard look in a browser address bar?

#### Per-dashboard subdomain

```
dash-a.example.com/
dash-b.example.com/
```

Infra:

- One CloudFront distribution per dashboard.
- One Route 53 record per dashboard.
- TLS: one wildcard `*.example.com` in ACM, or per-subdomain certs.
- Per-dashboard auth (§3.3): one CloudFront Function per distribution with the dashboard's password baked in.
- Cache invalidations, access logs, behaviors: independent per dashboard.
- Publish flow (§5) creates a fresh distribution per publish; Delete tears one down.

#### Path-routed under one host

```
dashboards.example.com/dash-a/
dashboards.example.com/dash-b/
```

Infra:

- One CloudFront distribution for all dashboards.
- One DNS record, one TLS cert.
- Behaviors: one per dashboard, routing `/<name>/*` to that dashboard's S3 origin.
- Per-dashboard auth: one CloudFront Function on the shared distribution that dispatches on path prefix to look up the right password.
- Cache invalidations share one quota; access logs mix dashboards (filter by path).
- CloudFront behavior limit: 25 default, raisable; every dashboard adds at least one behavior.
- Publish flow (§5) mutates the shared distribution's behaviors and origins rather than creating a new distribution.

#### Paths under the admin host

```
admin.example.com/dashboards/dash-a/
admin.example.com/dashboards/dash-b/
```

Infra:

- Reuses the admin CloudFront. Behaviors added per dashboard.
- Auth posture mixes: admin requires session login, dashboards require a different password gate. Both on the same hostname.
- Mentioned for completeness; awkward in practice because admin (session-gated, admin-only) and dashboards (password-gated, end-user-facing) have different security postures.

**Open:** Q-URL-DASHBOARD.

### 4.2 Sidecar URL shape

When a dashboard's frontend fetches a tile, a STAC search, or a vector layer, what URL does it call?

#### Per-sidecar subdomain

```
titiler.example.com
stac.example.com
tipg.example.com
veloserver.example.com   (if deployed)
```

Infra:

- One DNS record per sidecar (3–4 records).
- TLS: one wildcard `*.example.com`, or per-subdomain certs.
- ALB listener rules routing by Host header to existing per-sidecar target groups.
- CORS configured per sidecar (response policy on the ALB or on the sidecar service), allowing dashboard origins.
- Optionally one CloudFront distribution per sidecar for tile caching.

#### Path-routed on the admin host

```
admin.example.com/titiler/
admin.example.com/stac/
admin.example.com/tipg/
admin.example.com/veloserver/
```

Infra:

- Admin's CloudFront/ALB gains behaviors for `/titiler/*`, `/stac/*`, etc. Sidecar target groups already exist.
- No new DNS records, no new TLS items.
- CORS on the admin CF/ALB allowing dashboard origins.
- Most continuous with today's shape — today's Express proxy already maps these paths to the same sidecars.
- All sidecar traffic flows through admin's CF; if admin is sized for low traffic, sidecars push it harder.

#### Path-routed on a dedicated sidecar host

```
services.example.com/titiler/
services.example.com/stac/
services.example.com/tipg/
```

Infra:

- One new DNS record + one TLS cert.
- One new CloudFront distribution (or just ALB) in front of the sidecar target groups.
- CORS on the dedicated host allowing dashboard origins.
- Isolates sidecars from admin's CF/ALB; consolidates them under one host.

**Open:** Q-URL-SIDECAR.

### 4.3 Cross-origin sidecar auth gate

Dashboards reach sidecars cross-origin in every §4.2 option (admin reaches them internally; no change there). Today's admin server proxy wraps each sidecar in `ensureAdmin` for writes; dashboards bypass that proxy, so the gate has to come from somewhere.

Options:

- *Password gate alone.* Once the dashboard is loaded (past the CloudFront Function password), sidecar requests are unauthenticated but reachable. Simple; assumes nothing else on the internet stumbles onto the sidecar URLs.
- *CORS allow-list.* Restricts in-browser access to dashboard and admin origins. Browser enforces. Does not stop direct `curl`.
- *Signed requests.* CloudFront signs requests to the sidecars (Lambda@Edge, or short-lived credentials baked at publish time). Properly secures against direct access; more frontend work (see [ADR-B §3.3](./adr-b-frontend-refactor.md#33-cross-origin-sidecar-auth-from-dashboards-frontend-side)).

These combine — CORS allow-list + password gate, or CORS + signed requests, etc. The right combination depends on the security posture stakeholders accept on the sidecar services themselves.

**Open:** Q-AUTH-2.

## 5. Publish flow

The new code path: an admin clicks **Publish** in the admin tool. What happens:

1. **Admin tool → admin server.** The publish request, with mission, dashboard name, and settings.
2. **Admin server → bundling task.** Reads the mission's current config from Postgres. For each layer the mission references, decides where the data will live (baked into the dashboard's bucket, left in admin's S3, or served by a sidecar) and rewrites the layer's URL in the baked config accordingly. Builds the dashboard's frontend bundle with the rewritten config frozen in. Emits a directory of bundle plus baked static assets.
3. **Admin server → provisioning.** Creates the per-dashboard S3 bucket, CloudFront distribution, password-gate Function, and DNS record.
4. **Admin server → upload + invalidate.** Uploads the bundle to the new bucket and issues a CloudFront invalidation so users see the new build immediately.
5. **Admin server → admin tool.** Returns the dashboard URL; the admin tool surfaces it and records it in the dashboards registry table.

A matching **Delete Dashboard** path reverses every step: invalidate CloudFront, delete distribution, delete Function, delete bucket, remove DNS record, remove registry row.

### 5.1 Where the bundling task runs

The bundling task in step 2 is a real compute job — it reads from the database, runs Webpack, and produces a directory tree.

**Decision:** How does the bundling task run?

**Options:**

- *In-process in the admin task.* Simplest; ties up the admin's compute during a build; bundle size bounded by the admin container's filesystem and memory.
- *Spawned ECS task per publish.* A fresh container per build, isolated from the admin. Clean lifecycle, predictable footprint. Cold-start latency is **tens of seconds** dominated by image pull (20–60s without optimization; sub-5s with SOCI lazy loading) — fine for a publish flow whose total time is dominated by Webpack anyway.
- *CodeBuild job triggered by the admin.* AWS-native CI primitive with free logging and build artifacts. Both are negligible wins here — artifacts go to S3 either way and logs go to CloudWatch either way. Adds an external surface to manage.

**Recommended:** Spawned ECS task per publish.

**Why:** Clean lifecycle, predictable resource footprint, no contention with the admin's serving load.

### 5.2 How per-dashboard resources are provisioned

**Decision:** How do we provision the per-dashboard resources?

**Options:**

- *CDK or CloudFormation template, deployed from the admin task.* Declarative, idempotent, easy to tear down. Requires a large IAM surface on the admin's role.
- *Direct SDK calls.* Imperative, simpler IAM (scoped to exactly what the calls touch). Teardown is custom code.
- *Step Functions orchestration.* Overengineered for this. Defer.

**Recommended:** Direct SDK calls from the spawned bundling task.

**Why:** Tight IAM scope; teardown is straightforward when paired call-for-call with creation.

### 5.3 Dashboards registry

The admin tracks every dashboard it has published — at minimum URL, name, owner, and provisioning metadata — in a registry table on the shared Postgres (§2.2). Used to list dashboards in the admin UI, gate Delete Dashboard, and know which CloudFront distributions to invalidate on republish.

## 6. Shared services and isolation

The default position is **shared** — one resource serving many dashboards — and we deviate only when isolation is a hard requirement.

**Sidecars.** One deployment of each sidecar, shared across the admin and every dashboard. Per-dashboard deployments are rejected: cost (N copies of each Python service running) and management overhead (N deployments to upgrade) aren't justified given the services are stateless or read from shared databases.

**Veloserver is the exception worth flagging.** Its requirements are under-documented, and no frontend code references it today. So the live question for AWS is narrower than "deploy it or not": *does any production mission config still reference veloserver-backed layers?* If yes, document what the service needs; if no, drop. Tracked as Q-VELO.

**Per-dashboard database isolation.** Rejected. The operational cost (N instances to patch, monitor, back up) and the security surface (each dashboard now has database credentials) aren't justified for any need we've identified. Tables get a dashboard-scoped slice on the shared instance only when they need persistence beyond a baked file — rare.

## 7. Data layout

### 7.1 The local-files heritage

MMGIS's storage was always split: **raster files on local disk** under the mission directory; **structured data in Postgres** (tabular datasets, PostGIS geodatasets, mission configs, drawings, sessions). The AWS deployed world has no shared local disk, so:

- **Raster files → S3**, same prefix layout. The relative-path resolver in mission configs points at the S3 prefix instead of the filesystem.
- **Structured data → still Postgres**, now on RDS instead of in a container.
- **No "point at a local path" workflow survives.** Mission configs may not reference absolute filesystem paths; relative paths under the mission folder remain supported.

### 7.2 Where dashboard data comes from

A dashboard pulls data from one of three places. The choice isn't really about *size* — S3 can hold anything — it's about **access pattern** (static fetch vs. dynamic query) and **which bucket** holds the bytes:

- **Static fetch from the admin's S3 bucket.** No copy needed; the data already lives there from when admins uploaded it. The baked mission config points at the existing CloudFront-fronted URL. Right for raster tiles, DEMs, basemap imagery — the big files that already live in admin S3 and would only duplicate if copied per dashboard.
- **Static fetch from the dashboard's own S3 bucket.** Baked at publish time. The publish step reads from admin storage (Postgres rows or admin S3 files), serializes to JSON or GeoJSON, and writes a static file into the dashboard's bucket alongside the JS bundle. Right for *mission-specific* small data — the mission config itself, small lookup tables, baked search indices. Clean deletion lifecycle: drop the dashboard's bucket and its data is gone with it.
- **Dynamic query against a shared sidecar.** The dashboard makes HTTP requests to TiTiler (raster mosaics over big COGs), tipg (PostGIS as vector tiles or OGC Features), or a thin custom endpoint for tabular search. Right when the access pattern is "compute this on demand," not "fetch this file."

The default position is to push as much as possible into the first two categories (static fetches, no service hop) and use sidecars only for data that genuinely needs dynamic querying.

**The publish step is therefore a selective data-copying operation.** For each piece of data the mission references, it decides: leave it where it is (admin's S3 or a sidecar) and write the URL into the baked config; or read from admin storage, serialize, and write into the dashboard's bucket. Most missions end up with a mix of all three.

**Last resort: a dashboard-scoped table in the shared Postgres** plus a thin query endpoint to read it. Only when the dashboard genuinely needs writeable per-dashboard persistence — rare enough that we don't pre-commit a design.

### 7.3 Open

**Open:** Q-BAKE-CEILING — how much data can a dashboard load at boot before it feels slow? This is the UX ceiling that decides which data lands in the first two categories (static fetch) vs. the third (sidecar query). Investigation needed; not an ADR-time decision.

## 8. Open questions

- **Q-COMPUTE** — Which of the three coupled bundles (Today's shape ported / Express Mode for admin / Subdomain per service) for compute + sidecar routing + admin write gate? → §2.1.
- **Q-BIG-UPLOAD** — How do tile pyramids (thousands of files, many GB) reach S3 via the admin UI? → §2.4(b).
- **Q-AUTH-1** — Per-dashboard password, or one shared password? → §3.3.
- **Q-URL-DASHBOARD** — Dashboard URL shape: per-dashboard subdomain, shared host with path routing, or paths under admin? → §4.1.
- **Q-URL-SIDECAR** — Sidecar URL shape: per-sidecar subdomain, path-routed on admin host, or path-routed on a dedicated sidecar host? → §4.2.
- **Q-AUTH-2** — Cross-origin sidecar gate: password-only, CORS allow-list, signed requests, or a combination? → §4.3.
- **Q-VELO** — Config audit: does any production mission config wire a layer through `/veloserver`? Infra is fully wired but no frontend code references the service; whether to keep it deployed depends on the audit. → §6.
- **Q-BAKE-CEILING** — How much data can a dashboard load at boot before it feels slow? → §7.3.
