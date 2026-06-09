This is an LLM artifact — a per-PR implementation doc derived from [`../implementation-plan-keep.md`](../implementation-plan-keep.md) Phase 3 (core) and [`../pr-breakdown.md`](../pr-breakdown.md). Draft; verify against current code before acting.

# PR 3 — Gate Datasets & Geodatasets + Configure mode flag

**Maps to:** Phase 3 core (plan ~L85–96, L108–117). **Depends on:** PR 1. **Blocks:** PR 6 and PR 8 — both reuse the `DEPLOYMENT_MODE` flag this PR plumbs into the Configure SPA.

**Goal:** In `lean` mode, stop mounting the Datasets and Geodatasets API modules and hide their Configure nav tabs, and install the `DEPLOYMENT_MODE` plumbing (Pug shell → `window.mmgisglobal`) that later Configure PRs key off of.

## In plain English

Two of the admin features — Datasets and Geodatasets — only do anything when an admin uploads data into MMGIS's own database. The lean deployment never does that; all geospatial data lives at external addresses instead. So those two features have nothing to operate on, and if left on they would show empty, broken-looking screens.

This PR turns both features off completely in lean: the backend stops answering their requests, and their two buttons disappear from the admin's navigation, so nobody can wander into a dead screen. The full deployment is untouched — both features keep working exactly as today.

It also installs a small piece of wiring: a signal that tells the admin web interface which mode it is running in. That signal travels the same path the existing service on/off flags already use, so nothing new or exotic is introduced. A couple of later PRs depend on this same signal, which is why it lands here.

## Scope / files

| File | Change | Plan ref | Notes (verified against code) |
|---|---|---|---|
| `API/Backend/Datasets/setup.js` | Wrap the `onceInit` route mount in `if (isFull())`. Model sync is unaffected (this module's `onceSynced` is empty). | Ph3 Files | Verified: `onceInit` is the only mount; the `/api/datasets` `app.use` is the whole gate target. |
| `API/Backend/Geodatasets/setup.js` | Wrap the `onceInit` route mount in `if (isFull())`. Leave `onceSynced` (which calls `geodatasets.up()`) running in both modes so the table still syncs. | Ph3 Files | Verified: `onceSynced` calls `geodatasets.up()`; keep it unconditional so a later mode flip needs no migration. |
| `API/Backend/Config/setup.js` | Add `DEPLOYMENT_MODE` to the `res.render('../configure/build/index.pug', {...})` flag block, alongside the existing `WITH_*` flags. Source it from the backend `deploymentMode` helper, not raw `process.env`. | Ph3 Ops 2 | Verified: this render call is where `WITH_STAC`/`WITH_TIPG`/… are passed (L38–41). Same mechanism, one new key. |
| `configure/public/index.html` | Add `mmgisglobal.DEPLOYMENT_MODE = "#{DEPLOYMENT_MODE}";` to the `mmgisglobal` script block. | Ph3 Ops 2 | Verified: this is the actual template (Pug `#{...}` interpolation) where `WITH_STAC` etc. become `window.mmgisglobal.*` (L27–30). **Not a Redux store** — see Discrepancies. |
| `configure/src/components/Panel/Panel.js` | Wrap the Datasets and GeoDatasets nav `<Button>`s in `window.mmgisglobal.DEPLOYMENT_MODE !== 'lean'`, mirroring the existing `WITH_STAC === "true"` conditional one button over. | Ph3 Files/Ops 3 | Verified: GeoDatasets button L318–329, Datasets button L330–341; STAC button at L343–355 already shows the exact conditional pattern to copy. |
| `configure/src/components/Main/Main.js` | Optional defense-in-depth: no change required (pages are unreachable once the nav buttons are hidden). If gating, guard the `case "datasets"` / `case "geodatasets"` in the `switch (page)`. | Ph3 Files | Verified: page dispatch is `switch (page)` on `state.core.page` (L219–241). Hiding the nav is sufficient; the case-guard is optional. |
| `configure/src/core/calls.js` | No change. | Ph3 Files | Plan note: the call defs target routes that won't mount in lean; harmless dead code. |

## Implementation steps

1. Gate the route mount in `API/Backend/Datasets/setup.js` with `if (isFull())` around the `s.app.use(... router)` in `onceInit`.
2. Same in `API/Backend/Geodatasets/setup.js`; leave `onceSynced`/`geodatasets.up()` unconditional.
3. In `API/Backend/Config/setup.js`, add `DEPLOYMENT_MODE: <helper>.MODE` (or equivalent) to the Pug render object.
4. In `configure/public/index.html`, add the `mmgisglobal.DEPLOYMENT_MODE` line so the SPA reads it at boot like the other flags.
5. In `configure/src/components/Panel/Panel.js`, wrap the Datasets and GeoDatasets nav buttons in the `DEPLOYMENT_MODE !== 'lean'` conditional.
6. (Optional) Guard the matching `case`s in `Main.js`.

## Verification

- `MMGIS_DEPLOYMENT_MODE=lean`: every `/api/datasets/*` and `/api/geodatasets/*` endpoint returns 404; Datasets and GeoDatasets tabs are not visible in Configure.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset): both modules and both tabs work as today.
- In lean, the `datasets` / `geodatasets` Postgres tables still exist after boot (Sequelize sync runs in both modes), so a later mode flip needs no migration.
- In the rendered admin page, `window.mmgisglobal.DEPLOYMENT_MODE` reflects the env value.

## Rollback

Revert the two `setup.js` gates, the `Config/setup.js` + `index.html` flag additions, and the Panel.js edits; default `full` means existing deployments are unaffected regardless.

## Discrepancies vs plan

- **"Redux store at boot" is inaccurate.** The plan (L95, L110) says to plumb `DEPLOYMENT_MODE` "into the SPA's Redux store." The actual, verified convention is the Pug-rendered `window.mmgisglobal` global: `WITH_STAC`/`WITH_TIPG`/`WITH_TITILER`/`WITH_TITILER_PGSTAC` flow env → `API/Backend/Config/setup.js` `res.render` → `#{...}` in `configure/public/index.html` → `window.mmgisglobal.*`, and Panel.js/APIs.js read them directly off `window.mmgisglobal`. Follow that path for `DEPLOYMENT_MODE`; do **not** add a new Redux slice.
- **Pug template path.** The plan implies a standalone Pug shell; the file is `configure/public/index.html` (a CRA `public/index.html` that `API/Backend/Config/setup.js` renders via Pug `#{...}` interpolation, output to `configure/build/index.pug`). Edit the source `public/index.html`.
- **Datasets `setup.js` has no model sync to preserve.** The plan (L92) says "the model still syncs in both modes." For Datasets that is moot — its `onceSynced` is empty (no `.up()` call); only Geodatasets has a `geodatasets.up()` in `onceSynced` to keep unconditional.
