This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 5 — Gate Missions middleware, `_time_` compositor, link shortener & Missions-bound Utils endpoints

**Depends on:** PR 1 (the `isFull()`/`isLean()` helper). **Blocks:** none.

**Goal:** In `lean` mode, don't mount the three-piece `Missions/` static-serving stack (which carries the `sharp`-based `_time_` compositor), don't mount the link-shortener route, and gate the `/api/utils` endpoints that read the on-disk `Missions/` tree (`getprofile`, `getbands`, `getminmax`, `queryTilesetTimes`) — leaving all of them fully intact in `full` mode.

> **Scope & pairing.** This PR gates the three `Missions/` serving mounts, the `sharp` `_time_` compositor (which rides inside `middleware.missions`), the shortener mount, and the `Missions/`-bound `/api/utils` endpoints. Webhooks are **not** touched (kept in both modes; Dashboards webhook wiring is PR 8). The `Missions/` middleware also *serves* #103-uploaded assets — in lean those move to the shared admin S3 bucket and are served same-origin under `/assets/…` (the **write** repoint is PR 10; the **dashboard copy** is PR 8), so gating here doesn't strand them.

## In plain English

Today the app serves a mission's files — images, tiles, icons — straight off the server's own hard drive, and along the way it can stitch together time-stamped map images on the fly (so a layer can show "what the map looked like at this moment"). The app also runs a little URL-shortener so long map links can be handed out as short ones.

The lean deployment doesn't keep mission files on its own disk and doesn't need either of those conveniences: mission data lives elsewhere (external URLs and, later, an S3 bucket), and dashboards are single-purpose so short links add nothing. So this PR flips those features off when the lean switch is on — the file-serving door, the on-the-fly image stitching that rides along with it, and the shortener.

As with the rest of the lean work, nothing is removed. The image-stitching code and the shortener code stay in the repo; they simply aren't wired up in lean. With the switch in its default "full" position, everything serves and shortens exactly as it does today.

One thing this PR deliberately leaves alone: the ability to *upload* a static mission asset. That's being repointed (to cloud storage) rather than turned off, and it's handled in a later, separate change.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `scripts/server.js` | Wrap the `${ROOT_PATH}/Missions` mount — the three-piece stack `app.use(..., ensureUser(), middleware.missions(ROOT_PATH), express.static('Missions'))` (L643–648) — in `if (isFull()) { ... }`. | Verified at L643–648. This single mount is the only place `middleware.missions` and the `Missions` static dir are served, so gating it disables the `_time_` compositor too (see next row). The other `express.static` mounts (build, docs, configure, public — L612–642) are **not** touched. |
| `scripts/middleware.js` | **No edit.** The `missions(ROOT_PATH)` factory (L155+) — which contains the `_time_`/`sharp` compositing branch (L169+, `sharp` required L3) — stays as-is; it's simply never mounted in lean because the server.js mount above is gated. | Verified. The `_time_` logic lives inside `middleware.missions`, reached only through the gated mount. No standalone `_time_` route exists elsewhere. |
| `API/Backend/Shortener/setup.js` | Wrap the route mount in `onceInit` — `s.app.use(s.ROOT_PATH + "/api/shortener", ...)` (L6–13) — in `if (isFull()) { ... }`. Model/routes remain in the repo. | Verified. Backend setups are auto-discovered by directory (`API/setups.js`), so the gate must live **inside** this `setup.js`, not in `scripts/server.js`. Import the PR-1 helper here (e.g. `require("../Utils/deploymentMode")` — match PR 1's canonical path). |
| `API/Backend/Utils/setup.js` (or `routes/utils.js`) | Gate the `Missions/`-bound endpoints in lean: `getprofile`, `getbands`, `getminmax`, and `queryTilesetTimes`. All resolve a frontend-supplied relative path against the on-disk `Missions/` tree (Python/GDAL shellout for the first three; `fs.readdir` of `Missions/<…>/_time_/` for `queryTilesetTimes`), so they are **LOCAL-ONLY** — broken/useless once the `Missions/` filesystem is gone. Cleanest gate: wrap their registrations in `if (isFull())`. | The single auth guard is `s.ensureUser()` (`setup.js`), which short-circuits to `next()` when `AUTH != "local"` — so in non-local-auth deployments these GDAL-spawning endpoints are effectively **open**; gating them in lean also closes that exposure. `proj42wkt` + `healthcheck` are pure compute → **keep**. `ll2aerll`/`chronice` are SPICE compute reading a local `spice/` dir (not `Missions/`), non-Earth, and frontend-dropped → gating optional (recommend gate; no lean caller). The server-side `getminmax` is LOCAL-ONLY — lean's external-data path reroutes on the **frontend** to an external TiTiler (PR 9), so gating the server endpoint loses nothing. |
| `package.json` | **No edit** — `sharp` (L163, `^0.31.2`) stays in dependencies; the full-mode `_time_` compositor uses it. | Verified `sharp` present at L163. |

## Implementation steps

1. In `scripts/server.js`, wrap the `${ROOT_PATH}/Missions` mount (L643–648) in `if (isFull()) { ... }`. Import the PR-1 helper at the top of the file if it isn't already in scope (match PR 1's canonical import path).
2. Leave `scripts/middleware.js` untouched — gating the mount is sufficient to disable the `_time_` compositor.
3. In `API/Backend/Shortener/setup.js`, import the PR-1 helper and wrap the `onceInit` route mount in `if (isFull())`.
4. In `API/Backend/Utils/` (the `setup.js` mount, or per-route in `routes/utils.js`), gate `getprofile`/`getbands`/`getminmax`/`queryTilesetTimes` on `if (isFull())`. Leave `proj42wkt`/`healthcheck` mounted; gating `ll2aerll`/`chronice` is optional (recommend gate). Re-grep `API/Backend/Utils/routes/utils.js` for the exact route registrations before editing.
5. Leave `package.json` (`sharp`) untouched.
6. Do **not** touch upload routing (`Upload/uploadRouter.js`) or any webhook code — those are PR 10 and PR 8 respectively.

## Verification

- `MMGIS_DEPLOYMENT_MODE=lean`: `GET /Missions/whatever` returns 404 from Express (no middleware mounted); the **tile-image `_time_` compositor served under the `Missions` mount** is likewise unreachable and 404s.
- `MMGIS_DEPLOYMENT_MODE=lean`: `/api/utils/getprofile`, `/getbands`, `/getminmax`, and `/queryTilesetTimes` return 404; `/api/utils/proj42wkt` and `/healthcheck` still respond.
- `MMGIS_DEPLOYMENT_MODE=lean`: `/api/shortener` routes return 404.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset): `Missions/` files serve as today (including path-traversal rejection), `_time_` URLs still composite via `sharp`, and `/api/shortener` works as today.
- Webhook routes work in **both** modes (untouched by this PR).

## Rollback

Revert the two gate edits (`scripts/server.js` Missions mount and `API/Backend/Shortener/setup.js`); default `full` means existing deployments are unaffected regardless.

## Implementation notes & gotchas

- **The `_time_` compositor needs no separate gate.** The `sharp` `_time_` logic lives entirely inside `middleware.missions` (`scripts/middleware.js` L169+), reached only through the gated `Missions` mount — gating that one mount in `scripts/server.js` disables the compositor, so `scripts/middleware.js` needs no edit.
- **Two `_time_` surfaces, two owners.** Beyond the `Missions`-mount tile-image compositor, `API/Backend/Utils/routes/utils.js` exposes `/api/utils/queryTilesetTimes` (route ~L229; handler `queryTilesetTimesDir` ~L48) which reads on-disk `Missions/<…>/_time_/` directory **listings** — LOCAL-ONLY, so this PR gates the **server** endpoint alongside the GDAL endpoints (scope table above). Its **frontend** consumer (`query_tileset_times` in `TimeUI._makeHistogram`) is disabled by **PR 9** (the histogram is dropped in lean), so the call never fires from a dashboard either. Note the STAC branch of `queryTilesetTimes` queries Postgres/PgSTAC, but lean does not create the `mmgis-stac` DB (PR 2), so that branch is non-functional in lean regardless.
- **The shortener gate must live in its own `setup.js`, not `scripts/server.js`.** Backend modules are auto-discovered and mounted via `API/setups.js`'s directory scan, so the mount conditional belongs inside `API/Backend/Shortener/setup.js`'s `onceInit` — there is no shortener mount line in `scripts/server.js`.
