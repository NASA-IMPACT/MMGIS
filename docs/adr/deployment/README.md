# MMGIS AWS deployment ADR

This folder holds the architecture decision records for deploying MMGIS on AWS as an **admin stack** (today's app) plus many published, read-only **dashboards**.

Two angles were explored:

- **preserve** — deploy a full MMGIS alongside the admin: stand up all four Python sidecars (TiTiler, STAC, tipg, veloserver) and the asset storage as part of the admin stack, keep geodata upload and the rest of the feature set, and have dashboards reach the shared sidecars over the network. Features drop only when they genuinely can't work in a backend-less dashboard.
- **lean** — don't deploy the sidecars or the server-side feature surface at all. Sidecar functionality is assumed to be covered by separately hosted or public instances (referenced by external URL), and admins don't upload or process custom geodata through MMGIS. What's left — map rendering, mission configuration, and a new dashboard publishing flow — is the whole product.

## Decision

**We chose the lean angle.** The deciding documents live in [`lean/`](./lean/), starting with [`lean/adr.md`](./lean/adr.md). It supersedes the `preserve` ADRs. Additional decisions discussed in the lean adr.

## Layout

- [`lean/`](./lean/) — the chosen angle: the ADR, API call dispositions, feature gaps, and the implementation sequenced as per-PR docs in [`prs/`](./lean/prs/) (see [`pr-breakdown.md`](./lean/pr-breakdown.md)), with [`implementation-plan-keep.md`](./lean/implementation-plan-keep.md) as the phase-level companion. The chosen disposition env-gates the unused surfaces; the `burn` alternative — delete them — was rejected per ADR decision D2.
- [`preserve/`](./preserve/) — the superseded angle, kept for reference.
- [`shared/features.md`](./shared/features.md) — the authoritative per-feature inventory and drop/survive disposition matrix, shared by both angles. Rows carry stable identifiers cited as `#NN`.
