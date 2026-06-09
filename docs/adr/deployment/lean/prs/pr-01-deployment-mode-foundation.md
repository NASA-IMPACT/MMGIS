This is an LLM artifact — a per-PR implementation doc derived from [`../pr-breakdown.md`](../pr-breakdown.md). Draft; verify against current code before acting.

# PR 1 — Deployment-mode foundation

**Maps to:** Phase 1. **Depends on:** none. **Blocks:** every other lean PR.

**Goal:** Introduce the `MMGIS_DEPLOYMENT_MODE` gate (`full` default / `lean`), the build-time `SERVER` switch wiring, the client/server mode helpers, and the gitignored baked-config stub. **No behavior change** — `full` is the default and nothing reads the gate yet.

## In plain English

MMGIS is going to run in two shapes out of one codebase: the **full** app NASA-AMMOS ships today, and a stripped-down **lean** deployment. Instead of maintaining a separate fork, we add a single switch — an environment variable — that the app checks to know which shape it is.

This PR just installs that switch and the small helpers that read it (one for the server side, one for the browser side). It deliberately changes no behavior: the switch defaults to "full," so every existing deployment runs exactly as before. Think of it as wiring in a light switch while leaving all the lights on — the later PRs are the ones that actually turn specific things off when the switch is flipped to "lean."

It also drops in a tiny placeholder file that the dashboard-publishing process (a much later PR) will overwrite with a mission's baked-in configuration. Empty for now; it just reserves the spot.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `API/Backend/Utils/deploymentMode.js` *(new)* | `isLean()`, `isFull()`, `assertLean()`, frozen `MODE` const; defaults `full`; throws on unknown | **Canonical path: `API/Backend/Utils/deploymentMode.js`.** An earlier draft's `API/utils/deploymentMode.js` is wrong (no `API/utils/` dir); this is the settled target the siblings import (PRs 02/04/05 require this module by its location-relative path). `assertLean()` is exported but currently has no consumer — see Discrepancies. |
| `src/pre/deploymentMode.js` *(new)* | Client counterpart; reads `mmgisglobal.SERVER` (`node`→full, `static`→lean-dashboard, else throw) | `src/pre/` exists (`calls.js`, `RefreshAuth.js`). **No importer in any of the 13 PRs** — PR 7 branches directly on `mmgisglobal.SERVER`. Currently consumer-less/optional; see Discrepancies. |
| `src/essence/Basics/mode.js` *(new)* | Thin re-export of `src/pre/deploymentMode.js` for older consumers | Optional shim; only add if a consumer needs the older path. No consumer exists today — see Discrepancies. |
| `src/pre/staticConfig.js` *(new, gitignored)* | Stub exporting `{}`; publish script overwrites | |
| `configuration/env.js` | Add `MMGIS_DEPLOYMENT_MODE`, `STATIC_MODE`, `STATIC_MISSION_NAME` to the client-exposed `raw` object (≈ the `AUTH`/`CLEARANCE_NUMBER` block, ~L98+) | The "allowlist" is the CRA-style `raw` map in env.js, not a standalone list. Keep all `WITH_*`/`TITILER_*`/etc. — full mode needs them. `STATIC_MODE` is used (PR 8 builds with `STATIC_MODE=true`); `STATIC_MISSION_NAME` has no consumer — see Discrepancies. |
| `configuration/webpack.config.js` | Add Webpack alias `STATIC_MISSION_CONFIG → src/pre/staticConfig.js` | Don't touch `InterpolateHtmlPlugin` here — `SERVER` substitution is PR 7's job. |
| `sample.env` | Add `MMGIS_DEPLOYMENT_MODE=full` + comment on the two modes / upstream-compat default | |
| `.gitignore` | Ignore `src/pre/staticConfig.js` and `build-static/` | |

## Implementation steps

1. Create the backend helper at the chosen path (see table). Freeze the resolved object so the mode isn't re-read per call. Throw a clear startup error on an unrecognized value.
2. Create `src/pre/deploymentMode.js` mirroring the same constants from `mmgisglobal.SERVER`.
3. Create the gitignored `src/pre/staticConfig.js` stub (`export default {}`).
4. Add the three vars to env.js's `raw` object; add the webpack alias.
5. Document `MMGIS_DEPLOYMENT_MODE=full` in `sample.env`.
6. `.gitignore` the stub + `build-static/`.

## Verification

- `npm run build` succeeds, no behavior change.
- Unset / `=full`: `isFull()` true, `isLean()` false. `=lean`: `isLean()` true. Unknown value throws at startup.
- Grep confirms no other code reads `process.env.MMGIS_DEPLOYMENT_MODE` directly — only the helper.

## Rollback

Revert the new files and the env.js / webpack / sample.env / .gitignore edits. Default-`full` means zero impact on existing deployments regardless.

## Discrepancies vs plan

- **Backend helper path — settled.** An earlier draft's `API/utils/deploymentMode.js` is invalid (no `API/utils/` dir). Canonical path is now **`API/Backend/Utils/deploymentMode.js`**, which PRs 02/04/05 already import by their location-relative paths (e.g. `../API/Backend/Utils/deploymentMode` from `adjacent-servers/`). No further decision needed.
- The env "allowlist" is the `raw` object in `configuration/env.js`; an earlier draft's "allowlist entries" phrasing maps to keys there.
- **Orphaned scope (carried straight from an earlier draft, but no consumer in any of the 13 PRs — verified by grepping the other `pr-*.md`):**
  - `STATIC_MISSION_NAME` (added to `env.raw`) — **no consumer.** PR 7's LandingPage deeplink override keys off the **existing** `MAIN_MISSION` var, not `STATIC_MISSION_NAME`. Currently unused/speculative; recommend dropping it unless a later flow needs it. (Contrast `STATIC_MODE`, which **is** used — PR 8 builds with `STATIC_MODE=true`.)
  - `assertLean()` — exported from the helper but **unused by any later PR.** Speculative API surface; keep only if a future consumer is planned.
  - `src/pre/deploymentMode.js` (client helper) + `src/essence/Basics/mode.js` (shim) — **no importer.** PR 7 branches directly on `mmgisglobal.SERVER`. Both are currently consumer-less/optional; add only when something imports them.
