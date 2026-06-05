# ADR-B: Frontend refactor for dashboard mode

**Status:** Proposed — Under Review
**Date:** 2026-05-19

## 1. Scope

This ADR covers the changes to the MMGIS frontend codebase that make dashboard mode possible: a small set of seams where the runtime branches between "running inside the admin stack" (today's behavior) and "running as a published dashboard" (no backend, no database, no WebSocket).

AWS infrastructure decisions — admin compute, URL topology, the publish flow, sidecar hosting — are in [ADR-A](./adr-a-aws-deployment.md). Per-feature drop/survive disposition with implementation notes is in [`features.md`](../shared/features.md). The stakeholder-given intent and requirements are in the [overview](./overview-new.md).

The high-level shape: dashboard mode is selected by a build-time flag. The codebase has one branch; the bundle is built twice (once for admin, once per dashboard) from the same source. Almost the entire frontend is unchanged in dashboard mode — the map engines, the tools, the chrome, and the embed API all run as-is. The work is concentrated at the five seams in §2.

## 2. The five seams

### 2.1 Freezing the mission configuration into the bundle

The frontend currently boots by asking the server for its mission configuration. A dashboard has no server to ask, so the configuration must already be inside the bundle.

MMGIS already runs a small pre-bundle script (`API/updateTools.js`) that writes out generated JavaScript files — today it lists the installed tools and components. We add one more generated file — the frozen mission configuration — that the frontend imports like any other source. The dispatcher (§2.2) returns this baked config from its `bake` branch when the call site asks for it.

### 2.2 Replacing the frontend's calls to the server

Every named call the frontend makes to MMGIS's backend flows through one dispatcher function. That dispatcher already has an unused if-branch for "what if there's no server?" — wired but never triggered today because a flag is hard-coded to server-mode. Dashboard mode flips the flag and fills the branch with a per-call lookup table:

- **Bake.** Answer known at build time, written into the bundle. Just return it.
- **Reroute.** Call one of the shared sidecars directly instead.
- **Compute.** Answer in the browser using baked-in data.
- **Drop.** This call doesn't make sense in a dashboard (e.g. drawing-write, login). Return an error gracefully.

Because every call goes through one dispatcher, this is one function and one table — not a sweeping edit. See §3.1 for the decision rationale.

### 2.3 Telling the frontend where the sidecars live

The frontend currently builds URLs to the sidecars as same-origin paths like `/titiler/...`, relying on MMGIS's server to forward them behind the scenes. A dashboard has no server to forward through; it needs the services' real public addresses.

The dashboard-mode change is a helper that returns the right URL base for the build mode — same-origin paths in admin mode (no behavior change), absolute URLs in dashboard mode. There are nine sites today across five files (`Map_`, `Layers_`, `LayersTool`, `IdentifierTool`) that build these URLs by inline string interpolation; the work is centralizing them into the helper, then flipping mode by build flag.

The exact URL shape returned by the helper in dashboard mode depends on the choice in [ADR-A §4.2](./adr-a-aws-deployment.md#42-sidecar-url-shape) — per-service subdomains, or a single fronted CloudFront. The helper's interface is the same either way; the format string changes.

### 2.4 Handling backend-only computations

MMGIS's backend has a few small utility endpoints that do work for the frontend (elevation profiles, projection conversions, image-band metadata). A dashboard has no backend, so each is handled individually: drop the feature, redirect to a sidecar, or move the math into the browser.

Per-feature product decisions, not a mechanical rewrite. Dispositions live in [`features.md`](../shared/features.md).

### 2.5 Disabling server-dependent features

Two features have nowhere to go in a dashboard and just turn off:

- **The login form.** Dashboards have no accounts. The login modal and its associated UI never render. The auth state is implicitly "anonymous, read-only forever."
- **The live-update WebSocket.** Three consumers in admin (real-time Draw collaboration, layer-update notifications from the admin tool to open map sessions, and admin-tool-to-admin-tool multi-admin coordination). All three drop in dashboards; the admin stack keeps all three. No connection attempted; no fallback needed.

## 3. Open architectural decisions

The five seams describe the refactor's shape. Three decisions inside the refactor aren't yet settled.

### 3.1 How the API-call dispatcher branches in dashboard mode

**Decision:** Replace the dispatcher's no-server early-return with a per-call disposition table (bake / reroute / compute / drop). Every call site keeps calling `api('whatever')` unchanged.

The dispatcher is the chokepoint by construction — roughly 40 named calls, roughly 30 importing files, all going through one function. The alternative ("branch each call site") would mean editing every importer to wrap calls in `if (dashboardMode)`. Mechanical churn for no architectural benefit; the chokepoint is exactly the right seam.

### 3.2 Time-composited layers in dashboards

Some mission configs use a URL convention that triggers server-side compositing of time-windowed map tiles — the server reads several tiles at different timestamps, blends them, and returns one tile. A dashboard has no server to do that compositing, and the compositing step isn't free.

**Decision:** What happens to time-composited layers in dashboards?

**Options:**

- *Pre-bake every time slice at publish time.* The publish step composites every possible time window in advance and stores the results as static tiles in S3. Works, but storage cost scales with how many time windows the layer supports.
- *Hide the layer in the dashboard.* The layer simply doesn't appear in dashboards that don't pre-bake it. Cheapest; loses the feature for that layer.

**Recommended:** Per-layer decision rather than a global default.

**Why:** Some layers are critical to the mission and worth the bake cost; others are decorative and can be hidden. Marking the disposition per layer in the mission config is cheaper than picking one global rule.

**Open:** Q-TIME.

### 3.3 Cross-origin sidecar auth from dashboards (frontend side)

The dashboard's frontend makes cross-origin requests to the sidecars. Whether it needs to attach auth credentials depends on the gate ADR-A chooses (see [ADR-A §4.3](./adr-a-aws-deployment.md#43-cross-origin-sidecar-auth-gate)).

How the frontend side breaks under each ADR-A option:

- **Password gate alone:** the dashboard's frontend attaches nothing — the edge password gate on the dashboard's CloudFront has already established that the user is authorized to be there. Sidecar requests go out unauthenticated.
- **CORS allow-list:** same as above on the frontend side. The browser enforces the origin check at request time.
- **Signed requests:** the frontend has to attach a signature or token to each sidecar request. Requires either short-lived credentials baked at publish time, or a way for the dashboard to obtain credentials at boot.

**Disposition:** Follow ADR-A's decision. The frontend work is minimal under the first two options, real (a few hundred lines, a credentials-fetch flow) under the third. Q-AUTH-2 lives in ADR-A; the implementation here depends on the answer.

## 4. Per-feature disposition summary

The per-feature drop/survive matrix lives in [`features.md`](../shared/features.md). The shape:

- **Most features survive as-is** in dashboards — pure-client tools, map viewports, time control, URL state, DEM-reading tools, the embed API.
- **A defined set drops cleanly** — login, the three WebSocket consumers, the Configure admin tool, accounts / tokens / permissions, webhooks, file uploads, the sidecar proxy, the server-only utility routes, the Jekyll docs site.
- **A smaller set is conditional** on open questions in §5 — drawing, dashboard search, time-composited layers, the Isochrone heavy-compute tool.
- **Mission picker collapses** to "load the baked mission" since dashboards are one-mission-per-deploy.

Per-row implementation notes — including drop reasons and bake/reroute/compute details — live in `features.md`.

## 5. Open questions

Frontend-scope questions tracked in this ADR:

- **Q-DRAW** — Drawing in dashboards: drop, read-only display of baked features, or local-storage edit mode?
- **Q-SEARCH** — Dashboard search: client-side baked index, routed through tipg, or a shared search endpoint in the admin stack? Per-dashboard scoping (one dashboard can't discover another's data) is part of the answer either way.
- **Q-TIME** — Per-layer disposition for time-composited layers in dashboards. → §3.2.

Cross-cutting questions affecting this ADR but owned by ADR-A:

- **Q-AUTH-2** — Cross-origin sidecar auth gate. Owned by [ADR-A §4.3](./adr-a-aws-deployment.md#43-cross-origin-sidecar-auth-gate). The frontend implementation in §3.3 depends on the answer.
- **Q-URL-SIDECAR** — Sidecar URL shape (per-sidecar subdomain, path on admin host, or path on a dedicated sidecar host). Owned by [ADR-A §4.2](./adr-a-aws-deployment.md#42-sidecar-url-shape). The URL helper in §2.3 builds whichever shape ADR-A chooses.
