This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 2 — Gate sidecar proxy

**Depends on:** PR 1 (the `isFull()`/`isLean()` helper). **Blocks:** none.

**Goal:** In `lean` mode, register no adjacent-server proxy routes, suppress the on-boot sidecar spawner, force the `WITH_*` Pug flags to `false`, and skip the `mmgis-stac` database creation — while leaving every full-mode path untouched.

## In plain English

MMGIS today can run alongside a handful of optional helper services — small Python programs that serve map tiles, answer catalog queries, and so on. The main app knows how to start those helpers when it boots and to forward requests to them so the browser can reach them through one address. It also knows how to stand up a second database that one of those helpers needs.

In the lean deployment, none of those helpers run here. Instead, missions point straight at externally hosted versions of the same services. So this PR makes the app stop doing the helper-related chores when the lean switch is on: it doesn't try to launch the local helpers, it doesn't set up the forwarding doors for them, it doesn't tell the admin web pages that those helpers are available, and it doesn't create the extra database that only one helper would have used.

Crucially, nothing is deleted. When the switch is in its default "full" position, the app starts and routes to the local helpers exactly as it does today. The lean behavior is purely additive — a set of "skip this" decisions that only fire when the lean switch is on.

The net effect: a lean server boots clean, with no helper warnings, no leftover forwarding addresses, and no unused database — and a full server behaves identically to today.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `adjacent-servers/adjacent-servers-proxy.js` | Wrap the body of `initAdjacentServersProxy(app, isDocker, ensureAdmin)` in `if (isFull()) { ... }`; log `"adjacent-servers proxy disabled (deployment mode = lean)"` and return early in lean. | Verified. Single exported fn (L8–150) registers all proxy routes (`/stac`, `/tipg`, `/titiler`, `/titilerpgstac`, `/corsproxy`, `/veloserver`, plus custom). Gating the whole body covers all of them. |
| `adjacent-servers/adjacent-servers.js` | Wrap the body of `adjacentServers()` (the `spawn(...)` loop) in `if (isFull())`; early-return in lean. | Verified. Exported `adjacentServers()` (L5–64) spawns child processes for stac/tipg/titiler/titiler-pgstac. |
| `scripts/server.js` | **No gate edit** — leave the `require`s (L38–39) and the `adjacentServers(); initAdjacentServersProxy(app, isDocker, ensureAdmin);` calls (L490–491) intact. The gate lives inside the modules. | Verified. Both modules require the PR-1 backend helper internally; server.js is unchanged. |
| `API/Backend/Config/setup.js` | In the Configure-Pug `res.render(...)` (L19–42), force `WITH_STAC`/`WITH_TIPG`/`WITH_TITILER`/`WITH_TITILER_PGSTAC` to `false` (string `"false"`) when `isLean()`; otherwise pass `process.env.WITH_*` as today (L38–41). | Verified. These four flags are passed to `../configure/build/index.pug`. The Configure SPA already hides STAC/sidecar surfaces when the flag is false — no SPA edit here. Note: `WITH_VELOSERVER` is **not** passed to this Pug shell, so there is nothing to force for Veloserver here. |
| `scripts/init-db.js` | Add `&& isFull()` (equivalently `&& !isLean()`) to the `if (WITH_STAC \|\| WITH_TIPG \|\| WITH_TITILER_PGSTAC)` guard (L124–128) so the `CREATE DATABASE "mmgis-stac"` + `pypgstac migrate` block (L129–198) is skipped in lean. | Verified. The block is the only `mmgis-stac` creator. The main `DB_NAME` create (L200+) is separate and stays. `pgstac` extension comes from the Postgres image, not here. |
| `docker-compose.yml`, `docker-compose.dev.yml` | **No edit.** Sidecar services stay under their existing `profiles` gates; lean production doesn't use docker-compose, and local dev can still opt in. | Confirm the `profiles:` gates (expected `["stac"]`/`["veloserver"]`) exist before declaring no-op; if a sidecar service lacks a profile gate, note it rather than editing here. |

## Implementation steps

1. Import the PR-1 backend helper (`isFull`/`isLean`) into `adjacent-servers/adjacent-servers-proxy.js` and `adjacent-servers/adjacent-servers.js`. Use the canonical path PR 1 settled on (e.g. `require("../API/Backend/Utils/deploymentMode")` — match PR 1, don't reinvent).
2. In `adjacent-servers-proxy.js`, at the top of `initAdjacentServersProxy`, `if (!isFull()) { logger("info", "adjacent-servers proxy disabled (deployment mode = lean)", "adjacent-servers"); return; }`.
3. In `adjacent-servers.js`, at the top of `adjacentServers()`, early-return in lean (optional matching log).
4. In `API/Backend/Config/setup.js`, compute the four `WITH_*` Pug values: pass `false` when `isLean()`, else the env value.
5. In `scripts/init-db.js`, add the mode guard to the `mmgis-stac` block's condition so it never runs in lean.
6. Leave `scripts/server.js` and both `docker-compose*.yml` files untouched (verify the compose `profiles` gates as a read-only check).

## Verification

- `MMGIS_DEPLOYMENT_MODE=lean npm start`: `/titiler`, `/stac`, `/tipg`, `/titilerpgstac`, `/veloserver` all return 404; no sidecar spawn warnings in the boot log.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset) + `WITH_TITILER=true` + a TiTiler at `localhost:8883`: `/titiler/...` still proxies as before.
- Lean fresh deploy: `mmgis-stac` database is **not** created (and `pypgstac migrate` not invoked); the main `DB_NAME` database is still created.
- Lean Configure page: STAC/TiPG/TiTiler/TiTiler-pgSTAC tabs/cards render inactive (the Pug flags arrive as `false`).
- Full mode is byte-for-byte today's behavior across all five proxy paths, the spawner, the Pug flags, and `mmgis-stac`.

## Rollback

Revert the gate edits; default `full` means existing deployments are unaffected regardless.

## Implementation notes & gotchas

- **`WITH_VELOSERVER` is not a Pug flag.** This PR forces the `WITH_*` flags false at the Configure Pug shell, but `API/Backend/Config/setup.js` only passes `WITH_STAC`/`WITH_TIPG`/`WITH_TITILER`/`WITH_TITILER_PGSTAC` (L38–41) — Veloserver isn't rendered there. The Veloserver proxy route is still suppressed in lean (gated inside `initAdjacentServersProxy`); there's just no Pug flag to force for it.
- **The gate lives in the modules, not in `scripts/server.js`** — leave the `require` + setup call intact; `server.js` gets no edit in this PR.
