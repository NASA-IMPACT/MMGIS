This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 3 — Gate Datasets & Geodatasets + Configure mode flag

**Depends on:** PR 1. **Blocks:** PR 6 and PR 8 — both reuse the `DEPLOYMENT_MODE` flag this PR plumbs into the Configure SPA.

**Goal:** In `lean` mode, stop mounting the Datasets and Geodatasets API modules and hide their Configure nav tabs, and install the `DEPLOYMENT_MODE` plumbing (Pug shell → `window.mmgisglobal`) that later Configure PRs key off of.

## In plain English

Two of the admin features — Datasets and Geodatasets — only do anything when an admin uploads data into MMGIS's own database. The lean deployment never does that; all geospatial data lives at external addresses instead. So those two features have nothing to operate on, and if left on they would show empty, broken-looking screens.

This PR turns both features off completely in lean: the backend stops answering their requests, and their two buttons disappear from the admin's navigation, so nobody can wander into a dead screen. The full deployment is untouched — both features keep working exactly as today.

It also installs a small piece of wiring: a signal that tells the admin web interface which mode it is running in. That signal travels the same path the existing service on/off flags already use, so nothing new or exotic is introduced. A couple of later PRs depend on this same signal, which is why it lands here.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `API/Backend/Datasets/setup.js` | Wrap the `onceInit` route mount in `if (isFull())`. Model sync is unaffected (this module's `onceSynced` is empty). | Verified: `onceInit` is the only mount; the `/api/datasets` `app.use` is the whole gate target. |
| `API/Backend/Geodatasets/setup.js` | Wrap the `onceInit` route mount in `if (isFull())`. Leave `onceSynced` (which calls `geodatasets.up()`) running in both modes so the table still syncs. | Verified: `onceSynced` calls `geodatasets.up()`; keep it unconditional so a later mode flip needs no migration. |
| `API/Backend/Config/setup.js` | Add `DEPLOYMENT_MODE` to the `res.render('../configure/build/index.pug', {...})` flag block, alongside the existing `WITH_*` flags. Source it from the backend `deploymentMode` helper, not raw `process.env`. | Verified: this render call is where `WITH_STAC`/`WITH_TIPG`/… are passed (L38–41). Same mechanism, one new key. |
| `configure/public/index.html` | Add `mmgisglobal.DEPLOYMENT_MODE = "#{DEPLOYMENT_MODE}";` to the `mmgisglobal` script block. | Verified: this is the actual template (Pug `#{...}` interpolation) where `WITH_STAC` etc. become `window.mmgisglobal.*` (L27–30). **Not a Redux store** — see notes below. |
| `configure/src/components/Panel/Panel.js` | Wrap the Datasets and GeoDatasets nav `<Button>`s in `window.mmgisglobal.DEPLOYMENT_MODE !== 'lean'`, mirroring the existing `WITH_STAC === "true"` conditional one button over. | Verified: GeoDatasets button L318–329, Datasets button L330–341; STAC button at L343–355 already shows the exact conditional pattern to copy. |
| `configure/src/components/Main/Main.js` | Optional defense-in-depth: no change required (pages are unreachable once the nav buttons are hidden). If gating, guard the `case "datasets"` / `case "geodatasets"` in the `switch (page)`. | Verified: page dispatch is `switch (page)` on `state.core.page` (L219–241). Hiding the nav is sufficient; the case-guard is optional. |
| `configure/src/core/calls.js` | No change. | The call defs target routes that won't mount in lean; harmless dead code. |

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

## Implementation notes & gotchas

- **Use `window.mmgisglobal`, not Redux.** `DEPLOYMENT_MODE` rides the same path as the `WITH_*` flags: env → `API/Backend/Config/setup.js` `res.render` → `#{...}` in `configure/public/index.html` → `window.mmgisglobal.*`, read directly off `window.mmgisglobal` by Panel.js/APIs.js. Do **not** add a new Redux slice.
- **Pug template path.** Edit the source `configure/public/index.html` (a CRA `public/index.html` that `API/Backend/Config/setup.js` renders via Pug `#{...}` interpolation, output to `configure/build/index.pug`).
- **Datasets `setup.js` has no model sync to preserve** — its `onceSynced` is empty (no `.up()` call). Only Geodatasets has a `geodatasets.up()` in `onceSynced` to keep unconditional.
