# ADR: AWS deployment, lean angle

**Status:** Proposed — Under Review

**Last updated:** 2026-06-05

**Supersedes:** `../preserve/overview.md`, `../preserve/adr-a-aws-deployment.md`, `../preserve/adr-b-frontend-refactor.md` (the "preserve features by default" angle).

## Overview

Supersedes the `preserve` ADRs. Two assumptions changed:

- Sidecar functionality (TiTiler, STAC, link shortener, etc.) is already covered by microservices we host separately or are publicly available.
- Admins won't upload or process custom geodata through MMGIS. (Static mission assets like images are still uploadable; geospatial data is referenced by external URL.)

What remains: map rendering, mission configuration, and a new dashboard publishing flow. Everything else MMGIS does as a server, we drop.

`features.md` is shared with the preserve angle and is the authoritative per-feature inventory. [`feature-gaps.md`](./feature-gaps.md) catalogs the capabilities lean drops or only delivers through new work.

## What we're doing

Two deployables on AWS:

- An **admin stack** — today's MMGIS app, deployed as a container with its database. Multi-user, authenticated, used to build mission configurations and publish dashboards.
- Many **dashboards** — each frozen at publish time around one mission. Read-only frontend bundle behind a CloudFront distribution with edge-evaluated basic auth. Dashboards have no backend. A mission *is* a dashboard — the relationship is one-to-one. To publish a variation, copy the mission config into a new mission and publish that.

The admin keeps the map app, mission editor, and auth. It gains one new responsibility: a publish flow that bakes a mission config into a static bundle on S3 + CloudFront.

## Known constraints

Settled commitments. Open decisions are in another section.

1. **One admin instance per environment, many dashboard deployments.** Dashboards are published from the admin; they do not run their own backend.
2. **The admin is the only deployable with compute.** Dashboards are S3 + CloudFront + a CloudFront Function. No Lambda, no ECS, no Fargate per dashboard.
3. **No sidecars deploy as part of MMGIS.** Today's deployment ships five sidecar services that MMGIS proxies to: four Python services with source under `adjacent-servers/` (TiTiler, TiTiler-pgSTAC, STAC, tipg), and one NASA-AMMOS Docker image (Veloserver). None of the five deploy in lean. Their proxy routes (`/titiler`, `/titilerpgstac`, `/stac`, `/tipg`, `/veloserver`) are not exposed from production. If a mission needs functionality these services provide, its layer configs reference an externally hosted instance directly (VEDA's TiTiler, a public STAC catalog, etc.).
4. **No geodata upload through the admin in production.** Datasets, geodatasets, tile pyramids — none of these are ingested; mission configurations reference external URLs for all geospatial data. Static mission assets (images, icons) can still be uploaded; they go to S3.
5. **Dashboard URLs are bare CloudFront distribution names.** Each dashboard is reachable at its distribution's default domain name (`d<n>.cloudfront.net`). The admin records this URL in its registry and returns it to the publisher. A friendly hostname on the dashboard's own distribution needs `Aliases` plus a matching ACM certificate on that distribution, neither of which lean provisions; the admin does not manage DNS for dashboards. The supported route is the owner's own CloudFront fronting the dashboard under a path prefix — see [`serving-a-dashboard-from-your-domain.md`](../../../infrastructure/serving-a-dashboard-from-your-domain.md). The bundle and uploaded assets are referenced document-relative (`assets/…`, no leading slash), so that fronting needs no rebake.
6. **Single-mission-per-dashboard.** A published dashboard always loads exactly one mission. No mission picker, no `?mission=` switching in dashboards.
7. **Admin URL is a dedicated subdomain or its own `.gov` URL.** CloudFront in front of the admin ALB.
8. **Dashboard auth is one shared password across all dashboards.** A single value, edge-evaluated by a CloudFront Function. Per-dashboard passwords are out of scope until a production audience needs it.
9. **Admin auth mirrors today's MMGIS** — local accounts with Postgres-backed sessions, optional SSO, the same `111`/`110`/`001`/`000` permission codes. No change.
10. **PostGIS Postgres for the admin.** One managed instance, both the main MMGIS database and the `deployments` registry table on it. The STAC database (`mmgis-stac`) is not created because the STAC sidecar is not deployed.
11. **Deploys into an existing VPC** in the AWS account. No net-new VPC.
12. **CI/CD via GitHub Actions.**

## Deployment Overview

### Admin

A single AWS-managed container running today's MMGIS image. Express serves the map app, the `/configure` SPA, and the API.

Persistence:

- **One managed Postgres.** Users, sessions, mission configs, long-term tokens, webhooks, and the new `deployments` registry. Draw is gated out in lean (D2), so its tables and PostGIS geometry go unused.
- **Sessions stay Postgres-backed** via `connect-pg-simple`. The same restart-survives-sessions behavior we have today.
- **No `mmgis-stac` database**, since STAC isn't deployed.
- **One S3 asset bucket** for admin-uploaded static mission assets, served same-origin via CloudFront under `/assets/…`.
- **No `Missions/` filesystem.** The asset-serving middleware is unmounted (codebase fate per D2); uploads go to the S3 asset bucket instead.

Networking:

- **One CloudFront distribution in front of one ALB.** ALB terminates TLS, path-routes `/`, `/api/*`, `/configure`, `/docs/*` to the ECS service.
- **No sidecar target groups.** `/titiler`, `/stac`, `/tipg`, `/veloserver`, `/titilerpgstac` are not exposed.
- **WebSocket upgrade on the same ALB**, for two existing admin-only flows: Configure-SPA lock warnings when one admin saves over another's edit, and layer-update push so open map clients refresh without reload when config changes. Dashboards never connect.

Auth:

- **Local mode by default**, SSO optional via existing env var. Same bcrypt + Postgres-session model.
- **First superadmin seeded by `init-db.js`** from Secrets Manager. Public `first_signup` is disabled to prevent races.
- **No dashboard auth runs on the admin.** Dashboards have their own gate at the edge.

### Dashboards

Each published dashboard is provisioned as a **CloudFormation stack**, created by a one-off ECS task spawned per publish. The stack declares:

- **One S3 bucket.** Holds the dashboard's JS bundle, the baked mission config, and a copy of the mission's static assets (images, icons) — copied at publish from the shared admin asset bucket and referenced as a document-relative `assets/…` key (under a customer prefix the browser URL is `<prefix>/assets/…`), so the dashboard is self-contained. No per-dashboard *layer data* (tiles, COGs, DEMs): that resolves to external URLs.
- **One CloudFront distribution.** Default origin is the bucket. The distribution's default domain name (`d<n>.cloudfront.net`) is the dashboard's URL.
- **One CloudFront Function** attached to the viewer-request event. JavaScript that checks the `Authorization: Basic` header against a baked password and returns `401` on mismatch (the password value is the same across every dashboard), then validates and strips the `X-Forwarded-Prefix` prefix from the request URI and redirects the slash-less entry URL to its trailing-slash form.
- **No Route 53 record, no `Aliases`, no ACM certificate.** The dashboard is reachable at its CloudFront default name, and that distribution rejects a request carrying any other hostname. A friendly hostname is served by the owner's own CloudFront fronting the dashboard under a path prefix, as a separate, out-of-MMGIS step — see [`serving-a-dashboard-from-your-domain.md`](../../../infrastructure/serving-a-dashboard-from-your-domain.md).

**Why CloudFormation rather than direct SDK calls:**

- CloudFront's multi-step teardown (disable distribution, wait for propagation, delete distribution, delete Function, delete bucket) is CFN's problem, not ours; the handler only empties the bucket first, since CFN won't delete a non-empty one.
- Failed creates roll back automatically. No create-path cleanup code to write or maintain.
- One stack ARN is the handle for everything a dashboard owns. Bookkeeping is one foreign key, not five.

### Publish flow

Publish, Update, and Delete actions live on a new Deployments page in `/configure`.

1. Admin clicks **Publish** in new Deployments page; `/api/deployments/publish` receives `{ mission, name }`.
2. Admin server inserts a `provisioning` row in the new `deployments` table, spawns an ECS RunTask, returns `{ deployment_id, status }`.
3. Task reads the mission config from Postgres, bakes it into a source file, runs the theme build (`npm run build:themes`, which emits `dist/` CSS + fonts), then Webpack (`STATIC_MODE=true`) to create the bundle. The `dist/` assets are baked in so themed dashboards render with their CSS/fonts.
4. Task renders the template (bucket + distribution + Function, password baked into the Function source) and, when no stack exists yet, calls CFN `CreateStack`; where one already does — a retried publish, or an update — it converges that stack with `UpdateStack` instead. Stack name encodes the dashboard ID for idempotency.
5. Task polls `DescribeStacks` until the stack settles — `CREATE_COMPLETE` for a new one (~5–10 min; distribution provisioning dominates), `UPDATE_COMPLETE` for a converged one.
6. Task uploads the bundle to the stack's bucket via `PutObject`.
7. Task updates the row to `published` with `stack_arn` and `cloudfront_url`. Exits.
8. SPA polling sees `published`, surfaces the URL.

**Update:** `POST /api/deployments/:id/update` re-bakes the bundle from the current mission config, calls CFN `UpdateStack` with the freshly rendered template — converging the stack's infrastructure to current values, including re-baking the current dashboards password into the auth Function — and polls to `UPDATE_COMPLETE`, then PutObjects the new assets to the existing bucket. An unchanged template comes back from CloudFormation as "no updates are to be performed" and skips the polling entirely, and a stack busy with another operation is waited out and the update retried. The CloudFront distribution is not replaced — same `deployment_id`, same stack, same URL. The row's `updated_at` reflects the latest republish. The same ECS RunTask shape as Publish; the only difference is that Update converges the stack the row already owns, and refuses when that stack is gone — deleting the deployment and publishing again is what mints a new one (and a new URL). The endpoint refuses with a `409` before starting anything when the row is `deleting` or `deleted`, or when a `provisioning`/`updating` row is backed by a stack that is still mid-operation or missing entirely.

**Delete:** `DELETE /api/deployments/:id` marks the row `deleting`, empties the bucket (its name from `settings.bucket`, falling back to the stack's `BucketName` output for a delete mid-provision), then calls `DeleteStack`. CFN handles the 15–30 min teardown. The row flips to `deleted` on the next read where `DescribeStacks` 404s.

**Live state:** `GET /api/deployments*` joins each row's `stack_arn` with `DescribeStacks`. The row holds identity (id, mission, owner, stack ARN); CFN holds status. No reconcile job.

### What dashboards read at runtime

- **Mission config** — JS module generated at publish time, imported by the bundle.
- **Everything else** (tiles, COGs, STAC, vector tiles, geodata, DEMs, basemaps, externally-attached media) is served by external URLs baked into the config; the admin copies URLs at publish and hosts none of it. Uploaded static assets are the exception — a document-relative `assets/…` key from the dashboard bucket (the browser URL is `<prefix>/assets/…` under a customer prefix; per above).

Dashboards never call the admin server, never call a sidecar, never connect to Postgres.

### Frontend refactor surface

The dashboard frontend is the same Essence bundle as the admin, built with `mmgisglobal.SERVER='static'` (vs `'node'`). The flip activates a dormant branch in `src/pre/calls.js` — the dispatcher for every named JSON API call — replacing its current warn-and-bail with a per-call handling table. Four handling strategies:

- **Bake** — answer known at build time, frozen into the bundle. Used for mission configuration.
- **Reroute** — point at an external URL supplied by the mission config (sidecar substitutes), resolved by the existing `ServiceUrls` helper.
- **Compute** — calculate client-side from baked data.
- **Drop** — return a graceful error or hide the feature (login, WebSocket connect, every backend-write call, every call against a module that's gated out in lean).

Per-call handling lives in [`api.md`](./api.md); per-feature decisions in [`features.md`](../shared/features.md).


## Open decisions

### D1 — Compute platform for the admin: ECS Fargate vs ECS Express Mode

The admin runs as a containerized service on AWS. The question is which AWS-managed runtime hosts it.

Both options run the same image, the same task definition shape, the same ALB-fronted networking. The difference is who manages the load balancer, scaling, and deployment strategy: the team (Fargate) or AWS (Express Mode).

#### Option A — ECS Fargate

The team owns the ALB, listener rules, target groups, canary configuration, scaling policies, and rollout choreography. Tooling (CDK, GitHub Actions, etc.) is broadly compatible and well-known.

**Pros:**

- Mature, well-documented.
- Full control over deployment strategy — canary, blue/green, in-place, etc

**Cons:**

- More AWS resources to define and maintain (ALB listener rules, target groups, scaling policies, canary configs).
- More IAM and CI/CD surface than Express Mode.

#### Option B — ECS Express Mode

AWS-managed deployment mode for ECS, announced November 2025. The team supplies a task definition; AWS manages the ALB, the canary/rollout strategy, scaling, and the deployment lifecycle.

**Pros:**
- Less infrastructure code (no ALB, no target groups, no scaling policy).
- Lower operational burden.
- Using new stuff is cool 

**Cons:**

- Express Mode is six months old as of this ADR (announced November 2025). Production maturity is still being established.
- Locks the deployment shape to canary and the ALB config to ECS-managed.
- The internal-only ECS RunTask for the publish flow (which runs in the same cluster) may or may not interact cleanly with Express Mode-managed networking; needs verification.

**Decision: ECS Express Mode** (2026-06-05).

---

### D2 — Code disposition: burn the unused surfaces vs env-gate them

Today's MMGIS codebase carries a sizable set of features — sidecar proxies, file upload, `Missions/` middleware, the `_time_` server-side compositing, the link shortener, the WebSocket layer-notification consumer, etc, that don't ship in the lean deployment. The question is what we do with the code.

#### Option A — Burn

Delete the unused surfaces from the codebase. Each file or middleware that exists only to support a feature we are not deploying gets removed; the routes that mounted them get removed; the env vars that gated them get removed. The repository state reflects what the team ships.

**Pros:**

- The codebase becomes substantially smaller. Reviewers and new contributors don't have to reason about features that are not part of the product.
- No risk of the unused surfaces drifting (security updates, dependency upgrades) and breaking in ways nobody notices.
- Lower cognitive load when reading the code; fewer "what is this for?" questions.
- The codebase implicitly documents the deployment posture.
- ESLint, TypeScript, and the build pipeline run faster on a smaller tree.

**Cons:**

- An upstream contribution path to the original NASA-AMMOS MMGIS repository becomes painful. Our fork diverges meaningfully on the first burn pass; subsequent merges back from upstream require resolving deletions against ongoing changes there.
- If the team's posture shifts ("we do want sidecars after all"), the code has to be re-introduced or reanimated from git history.
- `implementation-plan-burn.md` (removed; available in git history) listed a wide set of file deletions; some of those touch shared utilities or middleware-loading code that the kept surfaces still use. The boundary is not perfectly clean — see that burn plan's notes on the ambiguous surfaces.

#### Option B — Keep, env-gated

Leave the unused surfaces in place. Add a deployment-mode environment variable (`MMGIS_DEPLOYMENT_MODE=lean` vs `full`). Each surface that is excluded under the lean angle gets gated on this variable: routes don't mount, middlewares don't register, the static-build pipeline activates, the dispatcher table fills in.

**Pros:**

- The original NASA-AMMOS deployment continues to work when `MMGIS_DEPLOYMENT_MODE=full` is set (or absent). Upstream contributions, merge-back, and shared changes are practical.
- The lean angle becomes a *deployment mode*, not a *fork*. Other teams could adopt it without inheriting our deletions.
- Code recovery (reanimating a feature) is a config change, not a git-history archaeology project.

**Cons:**

- The codebase remains large. Reviewers still have to reason about the gated surfaces. New contributors still have to find out which mode the gate evaluates to in any given deployment.
- Every new feature in the lean path is harder to develop.
- Future refactors and code clean up are harder.
- The env-gating itself is surface area. The gates have to be tested in both modes, and a missed gate is a production-affecting bug (e.g. an upload route accidentally mounted in lean mode). Can introduce fragility.

**Decision: Option B — keep, env-gated** (reviewer pick, 2026-06-05).


## Companion documents

- [`../shared/features.md`](../shared/features.md) — per-feature inventory and disposition matrix.
- [`feature-gaps.md`](./feature-gaps.md) — capabilities lean drops or only delivers through new work, with per-gap options.
- [`../preserve/`](../preserve/) — the prior angle's documents, retained for reference.
