This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 4 — Gate Draw

**Depends on:** PR 1 (the `isFull()`/`isLean()` helper; the Configure side reuses PR 3's mode flag). **Blocks:** none.

**Goal:** Gate Draw out of the lean deployment entirely — its server endpoints don't mount and the tool disappears from both the admin (Configure) and published dashboards — while leaving all Draw code in place so `full` mode is unchanged (ADR decision D2 = keep, env-gated).

## In plain English

Draw is MMGIS's collaborative annotation tool: users sketch points, lines, polygons, arrows, and notes onto the map, organize them into files, and share them with teammates — all saved to the database. It is a multi-user editing feature built around people authoring and revising data together.

The lean deployment doesn't include Draw at all. Lean dashboards are anonymous and read-only, and the lean admin doesn't manage drawings — so there's no place for the tool on either surface. This PR switches it off: the server stops exposing Draw's web endpoints, and the tool vanishes from the toolbar in both the admin and any published dashboard.

Nothing is deleted. The Draw code stays in the repository, just dormant in lean mode. In `full` mode — the default that NASA-AMMOS ships — everything behaves exactly as it does today. This mirrors how the Datasets and Geodatasets modules are gated in the sibling PR: same switch, same "leave the code, skip the wiring" approach.

One detail worth calling out: one of Draw's backend files is named "files," but it does not handle uploads. It manages database records describing each drawing file (names, history, keywords) — not file storage. It's gated as part of Draw, not as an asset-upload route.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `API/Backend/Draw/setup.js` | Import the PR-1 helper and wrap the three `onceInit` route mounts — `/api/files` (routerFiles), `/api/draw` (routerDraw), and `/api/draw` (routerAggregations) — in `if (isFull()) { ... }`. Leave `onceSynced` (model `.up()` calls + `makeMasterFiles(...)`) running in both modes so the Sequelize tables still sync. | **Verified.** `setup.js` `onceInit` mounts all three; `/api/draw` and `/api/files` are **both** mounted here (no other mount site). Backend setups are auto-discovered by directory (`API/setups.js` scans `API/Backend/*/setup.js` and calls `onceInit`), so the gate must live **inside this `setup.js`**, not in `scripts/server.js`. Import PR 1's helper: `require("../../Utils/deploymentMode")` (canonical `API/Backend/Utils/deploymentMode.js`). |
| `API/updateTools.js` | In `updateTools()`, skip the `src/essence/Tools/Draw` directory when `isLean()` so the generated `src/pre/tools.js` (Essence bundle) and `configure/public/toolConfigs.json` (Configure tool list) both omit Draw. | **Verified.** `updateTools()` auto-discovers tools by scanning `src/essence/Tools/<Name>/config.json` and writes both generated files. It runs at build (`scripts/build.js:57`) **and** at server boot (`scripts/server.js:694`), so `process.env.MMGIS_DEPLOYMENT_MODE` is available when it runs — this single skip drops Draw from the Essence bundle *and* Configure in one place. Import the PR-1 backend helper (Node context). |

The `draw_*` and `files_*` frontend dispatcher entries become **Drop** per [`../api.md`](../api.md). No source edit is required for that in this PR: those entries are handled by PR 7's static dispatcher (`src/pre/calls.js` `STATIC_HANDLERS` table). This PR only ensures the Draw tool that would *issue* those calls is not in the bundle.

## Implementation steps

1. In `API/Backend/Draw/setup.js`, import the PR-1 helper at the top and wrap the three `onceInit` `s.app.use(...)` mounts in a single `if (isFull()) { ... }`. Do **not** wrap `onceSynced` — the models must keep syncing in both modes (no migration needed on a future mode flip; the `drawings`/userfiles/filehistories tables simply go unused in lean).
2. In `API/updateTools.js` `updateTools()`, add an `isLean()` guard that excludes the standard-tools directory named `Draw` before its `config.json` is read, so it never lands in `tools` (and therefore neither in `src/pre/tools.js` nor `configure/public/toolConfigs.json`).
3. Rebuild/restart so the generated `src/pre/tools.js` and `configure/public/toolConfigs.json` regenerate without Draw.

## Verification

- `MMGIS_DEPLOYMENT_MODE=lean`: every `/api/draw/*` and `/api/files/*` endpoint returns 404; Draw is absent from the toolbar in the admin and in a published dashboard; `configure/public/toolConfigs.json` and the generated `src/pre/tools.js` contain no Draw entry.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset): Draw mounts and renders exactly as today (`/api/draw/add` etc. respond; Draw tool present).
- Confirm the Draw Sequelize tables are created on boot in **both** modes (lean leaves them empty).
- Confirm the app still boots in lean — the Webhooks module (kept) `require`s `API/Backend/Draw/routes/filesutils.js` at load time, so the Draw code must remain on disk (keep, not delete).

## Rollback

Revert the `setup.js` and `updateTools.js` edits and regenerate. Default mode is `full`, so behavior returns to today's regardless.

## Implementation notes & gotchas

- **`files.js` is metadata, not uploads.** `API/Backend/Draw/routes/files.js` has no `busboy`/`multipart`/`multer`/`formidable`/`createWriteStream` (grep-verified); it manages drawing-file metadata records in Postgres. It is correctly gated as part of Draw, not as an asset-upload route. (Asset upload is the separate `API/Backend/Upload` module, handled in PR 10.)
- **Cross-tool runtime coupling — risk to flag, no fix in this PR.** Tools that *do* ship in lean reference Draw by name and would fault if those specific code paths execute without Draw loaded: `src/essence/Tools/Kinds/Kinds.js:341` calls `TC_.getTool('DrawTool').showContextMenu(...)` for the `draw_tool` kind (a `getTool` that now returns null), and `src/essence/Tools/Shade/ShadeTool.js:1752–1769` references a module-global `DrawTool` (`cmLayerDown`/`cmLayerUp`/`cmLayerMove`/`indicatorLastDragPoint`) during indicator-drag. These only trigger on specific user actions (a mission configuring a `draw_tool` click behavior; Shade indicator drag) and are not exercised by a default lean dashboard, but they are latent `null`/undefined-reference hazards. Out of scope for this PR's gating mechanics; worth a guard in a hardening pass if those flows are reachable in lean.
- **Harmless dead reference, no edit needed.** `scripts/server.js:240` whitelists `/api/files/getfile` in `stopGuests`; once the `/api/files` mount is gated the path simply isn't reachable in lean, so the whitelist entry is inert.
