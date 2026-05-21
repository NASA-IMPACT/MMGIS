# Overview: AWS deployment with admin/dashboard split

**Status:** Draft
**Last updated:** 2026-05-20

## What we're doing

Today MMGIS runs as one Docker-compose stack: a single Node process serves the admin tool, the main map app, and proxies the optional Python sidecars; one Postgres holds users, sessions, mission configs, datasets, geodatasets, and drawings.

We're splitting that into two deployables on AWS:

- An **admin stack** — close to today's app. Multi-user, authenticated, full-feature. 
- Many **dashboards** — frozen, read-only frontend builds that an admin publishes for individual audiences. Dashboards share access to the admin stack's sidecars and asset storage; they have no backend of their own.

## Guidelines

This list is best-effort pending stakeholder feedback. If any item is challenged, the downstream ADRs need re-discussion.

1. **One admin instance, many dashboard deployments.**
2. **Dashboards are S3 + CloudFront.** No per-dashboard compute.
3. **Preserve MMGIS features by default.** A feature drops only when it genuinely cannot work in its target deployable, and the drop is called out with a reason.
4. **Shared infrastructure beats per-dashboard infrastructure** unless isolation is a hard requirement.
5. **Sidecars deploy as part of the admin stack** and are reachable by dashboards over the network.
6. **Admin auth mirrors today's MMGIS** — multi-user accounts, Postgres-backed sessions, existing permission codes, optional CSSO. **Dashboard auth is one shared password** at the edge, with per-dashboard passwords as a nice-to-have.
7. **Deploys into an existing VPC** in the AWS account. No net-new VPC.
8. **CI/CD uses GitHub Actions.**


## General plan

The shape of the solution at the service-category altitude. Specific configurations — which container service, which database engine, per-dashboard vs shared distribution — are decided in ADR-A.

**Admin stack.** Today's MMGIS app deployed to AWS managed compute. One managed Postgres (with PostGIS) holds the data it holds today: accounts, sessions, mission configs, datasets, geodatasets, drawings, STAC catalog. S3 replaces the local `Missions/` folder for raster mission assets. A load balancer terminates TLS and routes today's same-origin paths (`/api`, `/configure`, `/stac`, `/titiler`, etc.). The four Python sidecars run as sibling services in the same cluster.

**Dashboards.** Each published dashboard is a static frontend bundle in S3, fronted by CloudFront, with edge-evaluated password auth. One mission per dashboard, frozen at publish time. No mission picker, no `?mission=` switching, no backend, no database, no per-dashboard sidecar.

**Shared sidecars.** TiTiler, STAC, tipg, and (conditionally) veloserver live in the admin stack and are reached by both admin and dashboards. The admin reaches them through today's same-origin proxy. Dashboards reach them by absolute URL, cross-origin.

**Publish flow.** The admin owns a Publish action. It reads the mission's config from Postgres, builds a frontend bundle with the config frozen in, provisions the dashboard's AWS resources (bucket, distribution, password gate, DNS record), uploads, and returns the dashboard's URL. A matching Delete reverses each step.

**Frontend refactor.** A small set of seams in the frontend codebase makes dashboard mode possible: a build-time config bake (the mission config is generated as a JavaScript module instead of fetched at boot), an API-call dispatcher with a no-server branch (bake / reroute / compute / drop, looked up per call), a URL helper for the sidecars (same-origin paths in admin mode, absolute URLs in dashboard mode), per-feature decisions for backend-only computations (drop, redirect, or move to the browser), and disabling features that have nowhere to go (login form, WebSocket consumers).

## The ADRs

This work is split across two ADRs:

| ADR | Scope | Status |
|---|---|---|
| **ADR-A: AWS deployment** | Admin stack, dashboard infrastructure, URL topology, publish flow, shared-services posture, data layout. | Under Review |
| **ADR-B: Frontend refactor for dashboard mode** | The seams in the frontend, the dispatcher table, per-feature disposition, open decisions inside the refactor. | Under Review |

Supporting documents:

- **`features.md`** — per-feature disposition matrix (admin vs dashboard, with AWS implementation notes).
- **`detailed-implementation-plan.md`** — phase-by-phase implementation breakdown.

## How the ADRs interact

The two ADRs are coupled at specific points. The load-bearing dependencies:

- ADR-A's URL topology choice (per-service subdomain vs single fronted CloudFront) determines whether ADR-B's URL helper builds subdomain-shaped URLs or path-shaped ones.
- ADR-A's cross-origin sidecar auth gate (CORS only, signed requests, etc.) determines whether ADR-B's dashboard frontend needs to attach auth credentials.
- ADR-A's per-dashboard-vs-shared CloudFront choice determines whether per-dashboard isolation is something ADR-B can rely on.
- ADR-B's dispatcher behavior in dashboard mode (bake / reroute / compute / drop) is what ADR-A's publish flow has to populate at build time.

Decisions inside one ADR should not contradict the other.

## Cross-cutting open questions

These don't yet have an ADR home. When decided, each lands in an existing ADR or earns its own.

- **Shared managed Postgres vs separate instances** for the main MMGIS DB and the STAC DB. Engine choice is a follow-on decision once sharing is settled.
- **Secrets storage** — Secrets Manager vs SSM Parameter Store.
- **Observability** — CloudWatch for admin; what for dashboards (CloudFront standard logs to S3, or something richer)?

ADR-internal questions live in each ADR's open-questions section. Per-feature questions live in `features.md`.

## Vocabulary

Terms used across these documents. Wherever you see one of these, it means the same thing.

- **Admin stack** — today's MMGIS app, deployed to AWS.
- **Dashboard** — a static, read-only frontend bundle with one mission baked in, served from S3 + CloudFront.
- **Sidecar** — one of the four Python services: TiTiler, STAC, tipg, veloserver. The codebase folder is named `adjacent-servers/` and proxy code uses "adjacent" naming; in prose, we say "sidecar."
- **Bake** — freeze data into a static file at publish time so the dashboard can fetch it without a backend.
- **Dispatcher** — the frontend pattern that picks an API call's destination (bake / reroute / compute / drop) based on build mode.
- **Reroute** — a dispatcher disposition: instead of calling MMGIS's backend, call a sidecar directly.
- **Publish flow** — the admin-side pipeline that turns a mission config into a deployed dashboard.
