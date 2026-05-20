# ADR: AWS deployment with admin/dashboard split

**Status:** Proposed — Under Review

**Date:** 2026-05-19

## 1. Intent

Today MMGIS runs as one Docker-compose stack: a single server process serves the admin tool, the main map app, and proxies the optional Python sidecars; one Postgres holds users, sessions, mission configs, datasets, geodatasets, and drawings.

We want a **dual deployment**: one AWS-hosted **admin stack** (multi-user, authenticated, full-feature — close to today's app) from which an admin can **publish many independent, read-only dashboards** to S3 + CloudFront. The admin stack is the source of truth; dashboards are frozen artifacts that point back at shared AWS services when their data is too big to bake.

## 2. Initial Guidelines

These drive every decision downstream. If any item is challenged, downstream sections need re-discussion.

1. **One admin instance, many dashboard deployments.**
2. **Dashboards are S3 + CloudFront.** No per-dashboard compute.
3. **Preserve MMGIS features by default.** A feature drops only when it genuinely cannot work in its target deployable, and the drop is called out with a reason.
4. **Shared infrastructure beats per-dashboard infrastructure** unless a hard requirement says otherwise. One Postgres serving dashboard-scoped tables, not one Postgres per dashboard. One sidecar deployment serving many dashboards, not one set per dashboard.
5. **Adjacent services deploy as part of the admin stack** TiTiler, STAC, tipg, veloserver, etc are reachable by dashboards over the network.
6. **Admin auth mirrors today's MMGIS** — multi-user accounts, Postgres-backed sessions, the existing permission codes, optional CSSO. **Dashboard auth is one shared password** checked at the edge, with per-dashboard passwords as a nice-to-have.

## 3. Implementation overview

Five moving parts. Each is sketched here; sections below carry the detail.

**Admin stack (one deployment)**

- Containerized service running today's MMGIS application image: one Node process serving the admin tool and main map app
- The four Python sidecars (TiTiler, STAC, tipg, veloserver) as sibling services in the same cluster.
- One managed Postgres holding the same data it holds today: user accounts and sessions, mission configs, tabular **datasets** and PostGIS-backed **geodatasets** (both uploaded as rows through the admin API), drawn features, and the STAC catalog.
- One load balancer terminating TLS and routing today's same-origin paths (`/api`, `/configure`, `/stac`, `/titiler`, etc).
- S3 replaces the local `Missions/` directory for **raster mission assets** (tile pyramids, DEMs, basemap imagery). AWS containers have no shared local disk, so S3 is the obvious cloud equivalent — nothing about *what* MMGIS stores changes, only where the on-disk part physically lives.

**Dashboard builds (one per published dashboard)**

- One S3 bucket holding the JS bundle and the baked mission config in JSON.
- One CloudFront distribution in front of it.
- One CloudFront Function as a shared-password gate.
- One DNS record pointing the dashboard's subdomain at the distribution.
- **No backend, no database, no sidecar** — individual dashboards will call the shared sidecars hosted in the admin stack

**Code refactor**

Five seams in the frontend code; most of the codebase isn't touched.

- **Freezing the mission configuration into the bundle.** The frontend currently boots by asking the server for its mission configuration. A dashboard has no server to ask, so the configuration must already be inside the bundle. MMGIS already runs a small pre-bundle script that writes out generated JavaScript files (today it lists the installed tools and components); we add one more generated file — the frozen mission configuration — that the frontend imports like any other source.

- **Replacing the frontend's calls to the server.** Every named call the frontend makes to MMGIS's backend flows through one dispatcher function. That dispatcher already has an unused if-branch for "what if there's no server?" — wired but never triggered today because a flag is hard-coded to server-mode. Dashboard mode flips the flag and fills the branch with a per-call lookup table:
  - *Bake.* Answer known at build time, written into the bundle. Just return it.
  - *Reroute.* Call one of the shared Python services directly instead.
  - *Compute.* Answer in the browser using baked-in data.
  - *Drop.* This call doesn't make sense in a dashboard (e.g. drawing-write, login). Return an error gracefully.

  Because every call goes through one dispatcher, this is one function and one table — not a sweeping edit.

- **Telling the frontend where the Python services live.** The frontend currently builds URLs to the Python services as same-origin paths like `/titiler/...`, relying on MMGIS's server to forward them behind the scenes. A dashboard has no server to forward through; it needs the services' real public addresses. A small helper returns the right URL base for the build mode — same-origin paths in admin mode (no behavior change), absolute URLs in dashboard mode. Only four places in the frontend build such URLs.

- **Handling backend-only computations.** MMGIS's backend has a few small utility endpoints that do work for the frontend (elevation profiles, projection conversions, image-band metadata). A dashboard has no backend, so each one is handled individually: drop the feature, redirect to a Python service, or move the math into the browser. Per-feature product decisions, not a mechanical rewrite.

- **Disabling server-dependent features.** Two features have nowhere to go in a dashboard and just turn off: the login form (no accounts) and the live-update WebSocket (nothing to connect to).

- **Two features need a real design decision, not a quiet drop.** Saving drawn shapes (no database to save to) and server-side search (no Postgres to query) both have plausible preservation paths: bake-and-display-only mode, local-storage editing, a baked search index, routing through a shared sidecar, or a small shared endpoint in the admin stack. Tracked as Q-DRAW and Q-SEARCH.


**Adjacent services (one deployment, shared by everyone)**

The four Python services (TiTiler, STAC, tipg, veloserver) run as sibling containers in the same cluster as the admin, using today's docker-compose images. The services themselves don't change. Two consumers reach them differently:

- **The admin** reaches them as today: the browser asks for `/titiler/...` on the admin's domain; the admin server forwards behind the scenes. No code change.
- **Dashboards** reach them directly by absolute URL. That's a cross-origin request from the dashboard's domain to the sidecar's, so each sidecar needs a CORS allowlist for dashboard origins.

**Provisioning flow (new code in the admin)**

When an admin clicks **Publish** in the admin tool, the admin's backend kicks off a separate task that:

1. Reads the mission's current configuration from the database.
2. Builds the dashboard's frontend bundle with the configuration frozen in.
3. Provisions the dashboard's AWS resources: an S3 bucket, a CloudFront distribution, the password-gate function, and the DNS entry pointing the dashboard's subdomain at the distribution.
4. Uploads the bundle to S3 and tells CloudFront to refresh its cache.
5. Returns the new dashboard's URL to the admin tool, which displays it and records it in a dashboards registry.

A matching **Delete Dashboard** path reverses every step.

*Implementation: see `detailed-implementation-plan.md` for the full phase breakdown.*

## 4. Admin stack

Today's server composes the main app, the admin tool, the sidecar proxy, and the WebSocket server into one process. We keep that shape and put it in a containerized service. Adjacent services run as their own sibling services in the same cluster.

### 4.1 Compute

**Decision:** Which container platform runs the admin stack?

**Options:**

- *Full ECS Fargate.* One load balancer, multiple target groups, path-based listener rules; native WebSocket support; full control over networking, health checks, and deployment.
- *ECS Express Mode.* AWS's newer "simpler ECS"; provisions an ALB and auto-scaling with one API call — but provisions one ALB per service, while we need one ALB with path-based rules routing to the admin task and every sidecar.
- *AWS App Runner.* Closed to new customers in 2026; AWS redirects new users to ECS Express Mode.
- *Self-managed EC2 with Docker.* Extra infra to manage compared to fargate, but potentially cheaper and saves some baking refactor.

**Recommended:** Full ECS Fargate.

**Why:** The one-ALB-many-services routing pattern is load-bearing and rules out Express Mode.

Sidecars run as their own services in the same cluster, with private service-discovery DNS the admin task resolves.

**Decision:** How does the browser reach the sidecars?

Today the browser never talks to the Python sidecars directly. It hits `/titiler/...` or `/stac/...` on MMGIS's own domain; the Express server forwards (proxies) the request to the right Python service behind the scenes. The browser sees one website. The question for AWS is whether to keep that proxy shape or let the load balancer route to the sidecars directly.

**Options:**

- *Server proxy preserved (today's shape).* The load balancer sends every request to the admin container; the admin forwards sidecar requests to the Python containers. Zero code change. Single domain survives, so cookies follow and the frontend's hardcoded paths still work. The existing admin-write gate — public GETs allowed, admin login required for writes — keeps doing real security work. Cost: one extra hop per sidecar request, a few ms inside an AWS region.
- *Load balancer routes directly.* The load balancer recognizes sidecar paths and sends them straight to the Python containers. Lower latency, independent health checks per sidecar. But the load balancer routes by URL only — it doesn't know who's calling — so the admin write gate is gone. That matters: the admin tool actually issues write calls to STAC (creating, updating, deleting catalog items). Restoring the gate means a Lambda authorizer, service-side basic auth, or a hybrid that proxies only the writes — new code in every case.

**Recommended:** Server proxy preserved.

**Why:** Zero code change, the admin gate keeps working, and the extra hop is cheap compared to the actual sidecar work. 

### 4.2 Database

**Decision:** Host both databases (the main MMGIS database and the `mmgis-stac` catalog) on one Postgres instance, or split them across two?

**Options:**

- *One instance, two logical databases.* Mirrors today's docker-compose. Cheaper, simpler to operate.
- *Two instances.* Independent scaling and a smaller blast radius if the STAC workload misbehaves. More operational surface.

**Recommended:** One instance.

**Why:** They coexist fine today on one Postgres; no signal STAC will outgrow that. Easy to split later if it does.

**Open:** Q-DB-1.

Sessions stay Postgres-backed (no code change).

### 4.3 Networking and TLS

CloudFront is AWS's CDN — it caches static assets at edge locations close to users and gives you a place to attach WAF rules or request-level logic. The dashboards already live behind their own CloudFront distributions. The question is whether the admin should sit behind one too.

**Decision:** CloudFront in front of the admin load balancer?

**Options:**

- *Add CloudFront.* CDN-cached static assets, single domain shape, optional WAF integration. Cache rules need to whitelist the API and WebSocket paths so they bypass the cache.
- *Skip CloudFront.* Admin hits the load balancer directly. Fewer resources.

**Recommended:** Add CloudFront.

**Why:** Small cost; gives the admin and dashboards a consistent shape (everything fronted by CloudFront).

### 4.4 Mission asset storage

*Raster* mission assets — the tile pyramids, DEMs, and basemap imagery that lived in the `Missions/` folder — move to S3 (covered in §3). Postgres-backed data (datasets, geodatasets, configs, drawings) stays in Postgres; only the on-disk slice of MMGIS moves. The remaining decision is how uploads get there.

A "presigned URL" is an S3 feature where the server hands the browser a temporary URL that includes a signature granting upload permission for one specific object. The browser then PUTs the file straight to S3 — the server is involved only in handing out the URL, not in moving bytes.

**Decision:** How do file uploads land in S3?

**Options:**

- *Presigned upload, direct browser-to-S3.* The admin server hands back a presigned URL; the browser uploads to S3 directly.
- *Through-server upload.* The admin server receives the bytes and writes them to S3. Pins all upload bandwidth to the admin service; risks timeouts on multi-GB files.

**Recommended:** Presigned upload.

**Why:** Lifts upload bandwidth off the admin service and removes timeout risk.

### 4.5 Big-file upload workflow

Today, mission operators handle big raw imagery on their workstation: run a GDAL script, get a **tile pyramid** (a folder of thousands of small tile images), then `scp` the folder into MMGIS's `Missions/` directory. The UI upload path is capped at 500MB and isn't used for the big stuff.

In AWS there's no shared filesystem to `scp` to, and admin users won't have direct AWS credentials — everything has to go through the admin UI.

The question: how does a tile pyramid (thousands of files, many GB) get from a workstation into S3 via the admin UI? Presigned uploads handle one big file fine, but a pyramid is many files.

**Options:**

- *Upload as a single archive.* Operator zips the pyramid, uploads the archive via presigned, a backend task extracts it back into S3. One operator action; reintroduces a backend step in the upload path.
- *Bulk multi-file upload.* Browser fires off many presigned uploads in parallel. Works for small pyramids; brittle for big ones (browser memory, dropped connections, no resumability).
- *Shift the production format to COGs.* A Cloud-Optimized GeoTIFF is one file containing the whole pyramid; TiTiler (already in our sidecars) serves tiles from it on demand. Operators run `tifs2cogs` (already in `auxiliary/stac/`) instead of `gdal2customtiles`. One file, standard upload. Requires migrating existing tile-pyramid layers in mission configs.

**Open:** Q-BIG-UPLOAD. Once the workflow is settled, the per-file size cap follows from it and is a deploy-time config value.

### 4.6 Authentication

The auth model doesn't change: local accounts, hashed passwords, Postgres-backed sessions, the existing first-user-becomes-superadmin gate, the three `AUTH` modes (`local`, `off`, `csso`). The one real concern is the bootstrap window.

A fresh admin deploy with no users has an exposed first-signup endpoint that silently grants superadmin to whoever hits it first — no rate limit, no IP allowlist, no token gating. On the public internet that's a race the legitimate admin can lose. We have to close that window somehow.

**Decision:** How do we close the first-user-becomes-superadmin gap?

**Options:**

- *Block public ingress until the first user is created.* Manual runbook step; deploy with a tight security-group rule, log in, create the superadmin, then open ingress.
- *Seed a superadmin via the init task.* The init task that already creates the database also creates a superadmin from credentials in a secret, removing the gap entirely.
- *Gate the endpoint behind a config flag.* `ALLOW_FIRST_SIGNUP=true` has to be set explicitly, defaulting to off. Operator flips it on for the first signup, then off.

**Recommended:** Seed a superadmin via the init task.

**Why:** Removes the gap rather than relying on the operator to remember a runbook step. The credentials live in a secret manager either way.

**Open:** Q-DEPLOY-1.

*Implementation: see `detailed-implementation-plan.md` Phases A and J.*

## 5. Dashboard stack

A dashboard is "the main map app with the admin removed and the mission config frozen."

### 5.1 Per-dashboard resources

- **One S3 bucket.** The JS bundle, the baked mission config, and any per-dashboard baked data (small GeoJSON, small CSV, etc.).
- **One CloudFront distribution** in front of the bucket. Default behavior: serve the SPA shell for unknown paths. Static assets cache aggressively; the baked config is fingerprinted and immutable.
- **One CloudFront Function** as the password gate, attached to the viewer-request event. Browser basic auth, checked at the CDN edge.
- **One DNS record** pointing the chosen subdomain at the distribution.

No backend, no database, no sidecar — only shared services from the admin stack.

### 5.2 What dashboards read at runtime

For each kind of data a dashboard needs:

- *Mission configuration.* Baked into the JS bundle. No request.
- *Raster tiles, DEMs, basemap imagery.* Fetched from S3 via CloudFront — usually from the admin's shared S3 bucket (the data already lives there from when admins uploaded it; no per-dashboard copy needed).
- *Small per-mission tabular or vector data.* Baked into the dashboard's own S3 bucket at publish time as JSON or GeoJSON, fetched as a static asset.
- *Larger tabular or vector data.* Queried dynamically from a shared sidecar (TiTiler for raster mosaics, tipg for PostGIS vector tiles, a custom endpoint for tabular search). Dashboards never connect to Postgres directly.

The dashboard doesn't have to figure out where any of this lives at runtime — every URL it needs is already in the baked mission config. As part of the publish step, each layer's URL is rewritten to point wherever its data actually ended up: an absolute URL into admin's S3, a relative URL into the dashboard's own bucket, or an absolute sidecar URL. At runtime, the dashboard just reads each URL out of its config and fetches on demand, the same way today's MMGIS fetches tiles on demand from its local server. The static-vs-dynamic choice only affects *which origin* serves the bytes, not *when* they load.

### 5.3 Per-feature drop list

Features that **drop in dashboard mode**, with reasons:

- **Drawing tool writes** — no Postgres, no WebSocket. *Could* be partially preserved as read-only display of baked features or local-browser-storage editing. *Open: Q-DRAW.*
- **All three WebSocket consumers** — real-time Draw collaboration, layer-update notifications from the admin tool to open map sessions, and admin-tool-to-admin-tool multi-admin coordination. All three drop in dashboards; the admin stack keeps all three.
- **The admin tool** — by design, no admin in dashboards.
- **Long-term API tokens, accounts, permissions, webhooks, link shortener** — no backend.
- **File uploads** — read-only.
- **Sidecar proxy** — dashboards talk to the shared services directly.
- **Backend-only utility routes** (elevation profile, band metadata, projection conversion, server-side dataset search, link expansion) — each needs a per-feature disposition (drop, call a sidecar directly, or replace with a baked computation). These are *backend route disappearances*, not the same shape as the frontend URL helper.

Features that **survive in dashboard mode**:

- Map viewports (2D, 3D, image/model/PDF viewer).
- Pure-client tools: Animation, Sites, Kinds, Legend, Layers, Info.
- DEM-reading tools: Measure, Curtain, Viewshed, Shade — they consume DEM tiles, which bake fine to S3.
- Time control, URL state, the embed API, plugin components.

Features whose dashboard fate is **conditional**: see `features.md` and the open-questions list.

### 5.4 Authentication

The gate itself is a CloudFront Function — a tiny piece of JavaScript that runs at the CDN edge before any request reaches S3, checks an `Authorization` header against a known password, and returns 401 if it doesn't match. The browser handles the password prompt as standard basic auth. What's left to decide is whether all dashboards share one password or each gets its own.

**Decision:** One shared password across all dashboards, or per-dashboard passwords?

**Options:**

- *Single shared password.* One value baked into every dashboard's Function. Trivial to manage; one secret to rotate. But revoking access to a single dashboard means rotating the password for *all* dashboards.
- *Per-dashboard password.* Each distribution's Function is configured with its own password. Per-dashboard revocation is cheap. Comes essentially free since we provision a Function per dashboard anyway — the only cost is one more secret per dashboard to track.

**Recommended:** Per-dashboard password.

**Why:** Independent revocation is the operational property that matters as soon as you publish more than a handful of dashboards. The added management cost is low because the Function is already per-dashboard.

**Open:** Q-AUTH-1.

*Implementation: see `detailed-implementation-plan.md` Phases D, E, and J.*

## 6. Code refactor decisions

The conceptual plan for the refactor is in §3. This section captures the architectural decisions inside that plan that aren't yet settled.

### 6.1 Stubbing the API-call dispatcher

When dashboard mode fills the dispatcher's dormant non-server branch (the mechanism in §3), it can do so in two shapes.

**Decision:** Stub the single dispatcher with a per-call lookup table, or branch each call site individually?

**Options:**

- *Stub the dispatcher.* One function gets a per-call disposition table (bake / reroute / compute / drop). Every call site keeps calling `api('whatever')` unchanged. One place to edit; one place to break.
- *Branch each call site.* At each place the frontend calls the dispatcher, wrap the call in `if (dashboardMode)` and handle the case there. More invasive (many call sites); per-site behavior is more explicit.

**Recommended:** Stub the dispatcher.

**Why:** Concentrates the dashboard-mode logic in one place, matches the existing chokepoint shape, and leaves every call site unchanged.

**Open:** Q-CALLS-API.

### 6.2 Time-compositing layers in dashboards

Some mission configs use a URL convention that triggers server-side compositing of time-windowed map tiles — the server reads several tiles at different timestamps, blends them, and returns one tile. A dashboard has no server to do that compositing, and the compositing step isn't free.

**Decision:** What happens to time-composited layers in dashboards?

**Options:**

- *Pre-bake every time slice at publish time.* The publish step composites every possible time window in advance and stores the results as static tiles in S3. Works, but storage cost scales with how many time windows the layer supports.
- *Hide the layer in the dashboard.* The layer simply doesn't appear in dashboards that don't pre-bake it. Cheapest; loses the feature for that layer.

**Recommended:** Per-layer decision rather than a global default.

**Why:** Some layers are critical to the mission and worth the bake cost; others are decorative and can be hidden. Marking the disposition per layer in the mission config is cheaper than picking one global rule.

**Open:** Q-TIME.

### 6.3 Cross-origin sidecar auth gate

In today's stack, the admin server's sidecar proxy wraps each Python service in an admin-write gate — anonymous reads pass, writes require admin login. Dashboards reach the sidecars cross-origin, bypassing that proxy. The gate has to come from somewhere.

**Decision:** How do we gate dashboard access to the shared sidecars?

**Options:**

- *Password gate alone.* Only authorized users load the dashboard; once loaded, sidecar requests are unauthenticated but reachable. Simple, but assumes nothing else on the internet stumbles onto the sidecar URLs.
- *CORS allow-list only.* Restricts in-browser access to dashboard and admin origins. Does not stop direct `curl`.
- *Signed requests.* CloudFront signs requests to the sidecars (Lambda@Edge or a similar mechanism). More work; properly secures the services against any direct access.

**Recommended:** CORS allow-list plus the password gate.

**Why:** Defense-in-depth at low cost; the residual risk (a direct unauthenticated `curl` against read-only services) is acceptable until security review demands stronger.

**Open:** Q-AUTH-2.

*Implementation: see `detailed-implementation-plan.md` Phases A through F.*

## 7. Provisioning flow

The new code path: an admin clicks **Publish** in the admin tool. What happens:

1. **Admin tool → admin server.** The publish request, with mission, dashboard name, and settings.
2. **Admin server → bundling task.** Reads the mission's current config from Postgres. For each layer the mission references, decides where the data will live (baked into the dashboard's bucket, left in admin's S3, or served by a sidecar) and rewrites the layer's URL in the baked config accordingly. Builds the dashboard's frontend bundle with the rewritten configuration frozen in. Emits a directory of bundle plus baked static assets.
3. **Admin server → provisioning.** Creates the per-dashboard S3 bucket, CloudFront distribution, password-gate Function, and DNS record.
4. **Admin server → upload + invalidate.** Uploads the bundle to the new bucket and issues a CloudFront invalidation so users see the new build immediately.
5. **Admin server → admin tool.** Returns the dashboard URL; the admin tool surfaces it and records it in the dashboards registry table.

The bundling task in step 2 is a real compute job — it reads from the database, runs Webpack, and produces a directory tree. Where that work runs is a real choice.

**Decision:** How does the bundling task run?

**Options:**

- *In-process in the admin task.* Simplest; ties up the admin's compute during a build; bundle size bounded by the admin container's filesystem and memory.
- *Spawned ECS task per publish.* A fresh container per build, isolated from the admin. Clean lifecycle, predictable footprint. Cold-start latency (a few seconds to start the task).
- *CodeBuild job triggered by the admin.* AWS-native CI primitive; gives free logging and build artifacts. Adds an external surface to manage.

**Recommended:** Spawned ECS task per publish.

**Why:** Clean lifecycle, predictable resource footprint, no contention with the admin's serving load.

**Decision:** How do we provision the per-dashboard resources?

**Options:**

- *CDK or CloudFormation template, deployed from the admin task.* Declarative, idempotent, easy to tear down. Requires a large IAM surface on the admin's role.
- *Direct SDK calls.* Imperative, simpler IAM (scoped to exactly what the calls touch). Teardown is custom code.
- *Step Functions orchestration.* Overengineered for this. Defer.

**Recommended:** Direct SDK calls from the spawned bundling task.

**Why:** Tight IAM scope; teardown is straightforward when paired call-for-call with creation.

**Teardown.** Admin → Delete Dashboard. Reverse of provisioning: invalidate CloudFront, delete distribution, delete Function, delete bucket, remove DNS record, remove registry row.

*Implementation: see `detailed-implementation-plan.md` Phases H and I.*

## 8. Shared vs. per-instance

The defining tension of this design. The default position is **shared** — one resource serving many dashboards — and we deviate only when isolation is a hard requirement.

### 8.1 Database

The one-Postgres-vs-many decision is in §4.2 (Q-DB-1, recommendation: one instance). Per *dashboard* there's a separate question — one Postgres per dashboard — which we reject: the operational cost (N instances to patch, monitor, back up) and the security surface (each dashboard now has database credentials) aren't justified for any need we've identified. Tables get a dashboard-scoped slice on the shared instance only when they need persistence beyond a baked file, which is the rare case.

### 8.2 Adjacent services

- **One deployment of each sidecar**, shared across the admin and every dashboard.
- **Rejected alternative: per-dashboard sidecars.** Cost (N copies of each Python service running) and management (N deployments to upgrade) are unjustified given the services are stateless or read from shared databases.
- **Veloserver is the exception worth flagging.** Its requirements are under-documented, and no frontend code references it today. So the live question for AWS is narrower than "deploy it or not": *does any production mission config still reference veloserver-backed layers?* If yes, document what the service needs; if no, drop. Tracked as Q-VELO.

### 8.3 Dashboard registry

The admin tracks every dashboard it has published — at minimum URL, name, owner, and provisioning metadata — in a registry table on the shared Postgres. Used to list dashboards in the admin UI, gate Delete Dashboard, and know which CloudFront distributions to invalidate on republish.

*Implementation: see `detailed-implementation-plan.md` Phases G and I.*

## 9. Data flow

### 9.1 The local-files heritage

MMGIS's storage was always split: **raster files on local disk** under the mission directory; **structured data in Postgres** (tabular datasets, PostGIS geodatasets, mission configs, drawings, sessions). The AWS deployed world has no shared local disk, so:

- **Raster files → S3**, same prefix layout. The relative-path resolver in mission configs points at the S3 prefix instead of the filesystem.
- **Structured data → still Postgres**, now on RDS instead of in a container.
- **No "point at a local path" workflow survives.** Mission configs may not reference absolute filesystem paths; relative paths under the mission folder remain supported.

### 9.2 Where dashboard data comes from

A dashboard pulls data from one of three places. The choice isn't really about *size* — S3 can hold anything — it's about **access pattern** (static fetch vs. dynamic query) and **which bucket** holds it.

- **Static fetch from the admin's S3 bucket.** No copy needed; the data already lives there from when admins uploaded it. The baked mission config points at the existing CloudFront-fronted URL. Right for raster tiles, DEMs, basemap imagery — the big files that already live in admin S3 and would only duplicate if copied per dashboard.
- **Static fetch from the dashboard's own S3 bucket.** Baked at publish time. The publish step reads from admin storage (Postgres rows or admin S3 files), serializes to JSON or GeoJSON, and writes a static file into the dashboard's bucket alongside the JS bundle. Right for *mission-specific* small data — the mission config itself, small lookup tables, baked search indices. Clean deletion lifecycle: drop the dashboard's bucket and its data is gone with it.
- **Dynamic query against a shared sidecar.** The dashboard makes HTTP requests to TiTiler (raster mosaics over big COGs), tipg (PostGIS as vector tiles or OGC Features), or a thin custom endpoint for tabular search. Right when the access pattern is "compute this on demand," not "fetch this file."

The default position is to push as much as possible into the first two categories (static fetches, no service hop) and use sidecars only for data that genuinely needs dynamic querying.

**The publish step is therefore a selective data-copying operation.** For each piece of data the mission references, it decides: leave it where it is (admin's S3 or a sidecar) and write the URL into the baked config; or read from admin storage, serialize, and write into the dashboard's bucket. Most missions end up with a mix of all three.

**Last resort: a dashboard-scoped table in the shared Postgres** plus a thin query endpoint to read it. Only when the dashboard genuinely needs writeable per-dashboard persistence — rare enough that we don't pre-commit a design.

### 9.3 The open part

**Open:** Q-BAKE-CEILING — how much data can a dashboard load at boot before it feels slow? This is the UX ceiling that decides which data lands in the first two categories (static fetch) vs. the third (sidecar query). Investigation needed; not an ADR-time decision.

*Implementation: see `detailed-implementation-plan.md` Phase F.*

## 10. URL topology

Two real choices interact: how the admin stack exposes its services, and how dashboards reach those services.

### 10.1 Admin

All admin paths on one CloudFront distribution in front of the admin load balancer, same shape as today. The sidecar proxy continues to forward under the same paths.

### 10.2 Dashboards reaching shared services

Dashboards live on their own domain; the sidecars live in the admin stack. A dashboard needs a URL it can put in fetch calls. Two ways to arrange that.

**Decision:** How do dashboards reach the sidecars?

**Options:**

- *Per-service subdomain.* Each shared service gets its own public URL (e.g. `titiler.<admin-domain>`, `stac.<admin-domain>`); dashboards hit those URLs directly. CORS configured per service. Several subdomains and TLS certs to manage.
- *One CloudFront fronts everything.* A single CloudFront distribution sits in front of the admin S3 bucket, all dashboard buckets, and all sidecar targets — path-based routing decides which origin serves a given request. Fewer resources; the routing complexity moves into CloudFront's behavior rules.

**Recommended:** Per-service subdomain.

**Why:** Lines up with the existing path-prefix discipline — today's `/titiler`, `/stac`, etc. just become subdomains, no routing rewrite needed in CloudFront.

**Open:** Q-URL-1.

### 10.3 Per-dashboard CloudFront vs. shared

A CloudFront distribution is the AWS resource that fronts an origin (an S3 bucket, in our case) with a CDN, TLS, and (for us) the password-gate Function. We can either give each dashboard its own distribution, or run one shared distribution that path-routes to many dashboard buckets.

**Decision:** One CloudFront per dashboard, or one CloudFront serving many?

**Options:**

- *Per-dashboard distribution.* Each dashboard has its own distribution, its own Function (so its own password), and clean isolation. Drawback: N distributions to monitor, and each carries a small per-distribution cost floor.
- *Shared distribution, path-routed per dashboard.* One distribution serves `/<dashboard-name>/...` for many dashboards. Cheaper; harder to give one dashboard its own password; harder to revoke access to a single dashboard.

**Recommended:** Per-dashboard distribution.

**Why:** Isolation and per-dashboard password come for free; cost is acceptable until N gets large.

**Open:** Q-URL-2 (revisit if N grows).

*Implementation: see `detailed-implementation-plan.md` Phase H.*

## 11. Open questions (consolidated)

Questions with a home section in this ADR are pointer entries. Questions tracked only here (mostly feature-level scope decisions) carry their description.

### Architecture-level (has a home section)

- **Q-DB-1** — One Postgres instance for both databases, or separate? → §4.2.
- **Q-URL-1** — Per-service subdomain for each sidecar, or one CloudFront fronting everything? → §10.2.
- **Q-URL-2** — Per-dashboard CloudFront distribution, or one distribution with path routing? → §10.3.
- **Q-AUTH-1** — Per-dashboard password, or one shared password? → §5.4.
- **Q-AUTH-2** — Cross-origin sidecar gate: password-only, CORS allow-list, or signed requests? → §6.3.
- **Q-DEPLOY-1** — How do we close the first-user-becomes-superadmin gap? → §4.5.
- **Q-CALLS-API** — Stub the API-call dispatcher, or branch each call site individually? → §6.1.
- **Q-TIME** — Per-layer disposition for time-composited layers in dashboards. → §6.2.
- **Q-VELO** — Is veloserver referenced by any current mission config? → §8.2.
- **Q-BIG-UPLOAD** — How do tile pyramids (thousands of files, many GB) reach S3 via the admin UI? → §4.5.

### Feature-level (tracked in `features.md`)

- **Q-DRAW** — Drawing in dashboards: drop, read-only display of baked features, or local-storage edit mode?
- **Q-LANDING** — Does any dashboard host multiple frozen missions, or is it strictly one-mission-per-deploy?
- **Q-SEARCH** — Dashboard search: client-side baked index, routed through tipg, or a shared search endpoint in the admin stack? Per-dashboard scoping (one dashboard can't discover another's data) is part of the answer either way.
- **Q-BAKE-CEILING** — How much data can a dashboard reasonably load at boot before it feels slow? This is a bandwidth/UX ceiling on the static-fetch path (S3 can store anything; the question is what's tolerable for a user). The answer sets the line between "bake as a static file" and "route through a sidecar."
- **Q-SSO** — Does the admin ever deploy where CSSO is mandatory? If not, the CSSO middleware is dead code in AWS.
- **Q-SHORTENER** — Is the link shortener used? If not, drop everywhere.
- **Q-DOCS** — Does the dashboard ever need to ship the docs site, or does it live only on the admin?

### Implementation-level

The detailed plan carries these:

- The exhaustive list of call sites that need rewriting.
- The exact shape of the baked config module and the API-call dispatch table.
- The IAM policy template for the per-publish provisioning task.

---

**Cross-reference:** See `working-plan.md` for the structure and workflow that produced this ADR. See `features.md` for the per-feature inventory. See the personal review checklist for the human-facing review steps. See `detailed-implementation-plan.md` for file/function-level refactor instructions.
