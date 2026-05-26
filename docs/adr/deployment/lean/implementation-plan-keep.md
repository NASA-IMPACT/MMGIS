# Implementation plan — keep variant

**Status:** Draft
**Last updated:** 2026-05-20
**Companion to:** [`adr.md`](./adr.md) (D2 = keep, env-gated). Parallel structure to [`implementation-plan-burn.md`](./implementation-plan-burn.md) — same phase numbering, so the two can be diffed.

This plan leaves the existing surfaces in the codebase and gates each on a deployment-mode environment variable. After this plan, the original NASA-AMMOS deployment continues to work with `MMGIS_DEPLOYMENT_MODE` unset (or `=full`); the lean deployment sets `MMGIS_DEPLOYMENT_MODE=lean` and gets the smaller surface.

The companion features inventory is [`../features.md`](../features.md); per-feature rows are cited as `#NN`.

Each phase has the same structure: **Goal / Files / Operations / Verification / Rollback**.

Conventions:
- All file paths are relative to the repository root.
- "Gate" means add a runtime conditional on `MMGIS_DEPLOYMENT_MODE`.
- Two valid values: `full` (default, preserves today's behavior) and `lean` (the lean mode). The default must remain `full` so upstream users see no change.
- A central helper `API/utils/deploymentMode.js` exports `isLean()`, `isFull()`, `assertLean()`, etc. Use it instead of reading `process.env.MMGIS_DEPLOYMENT_MODE` directly.

---

## Phase 1 — Pre-work: deployment-mode helper, build flag, env allowlist, baked-config stub

**Goal:** Add the deployment-mode gate the rest of the plan keys off of, the build-time switch, and the empty stub the publish script overwrites. No behavior change for full deployments at this point.

**Files:**
- `configuration/env.js`
- `configuration/webpack.config.js`
- `API/utils/deploymentMode.js` (new) — exports `isLean()`, `isFull()`, `assertLean()`, `MODE` constant. Defaults to `full`. Add a frozen object to prevent re-evaluation per call.
- `src/pre/deploymentMode.js` (new) — client-side counterpart, exporting the same constants. Reads from `mmgisglobal.SERVER` (`"node"` → `full`, `"static"` → `lean`-published-dashboard, anything else → error).
- `src/pre/staticConfig.js` (new, gitignored stub)
- `src/essence/Basics/mode.js` (new) — re-exports `src/pre/deploymentMode.js` for older consumers.
- `.gitignore`
- `sample.env`

**Operations:**
1. Add the env-var allowlist entries in `configuration/env.js`: `MMGIS_DEPLOYMENT_MODE`, `STATIC_MODE`, `STATIC_MISSION_NAME`. Keep all existing `WITH_*`, `TITILER_*`, `STAC_*`, `TIPG_*`, `VELOSERVER_*` entries — full mode still needs them.
2. Add a Webpack alias `STATIC_MISSION_CONFIG -> src/pre/staticConfig.js` in `configuration/webpack.config.js`.
3. Create `src/pre/staticConfig.js` as a gitignored stub exporting `{}`. The publish script overwrites it.
4. Create the deployment-mode helpers (`API/utils/deploymentMode.js`, `src/pre/deploymentMode.js`).
5. Add `MMGIS_DEPLOYMENT_MODE=full` to `sample.env` with a comment explaining the two modes and the upstream-compat default.
6. Add `src/pre/staticConfig.js` and `build-static/` to `.gitignore`.

**Verification:**
- `npm run build` succeeds with no behavior change.
- `MMGIS_DEPLOYMENT_MODE` unset: `isFull()` returns `true`, `isLean()` returns `false`.
- `MMGIS_DEPLOYMENT_MODE=lean`: `isLean()` returns `true`.
- Unknown values throw at startup with a clear error.

**Rollback:** Revert the new files and env-allowlist edits.

---

## Phase 2 — Gate the sidecar proxy

**Goal:** Leave the adjacent-server proxy in place. In `lean` mode the proxy front door does not register any routes, and the on-boot spawner is suppressed. The `WITH_*` env vars remain meaningful in `full` mode. (#35, #36, #41 in `features.md`.)

**Files:**
- Edit: `adjacent-servers/adjacent-servers-proxy.js` — wrap the route registration in `if (isFull()) { ... }`. The module's `setup(app, ...)` becomes a no-op in `lean` mode. Add a clear log: `"adjacent-servers proxy disabled (deployment mode = lean)"`.
- Edit: `adjacent-servers/adjacent-servers.js` — same gate around the child-process spawning.
- Edit: `scripts/server.js` — leave the require + setup call intact; the gate is in the module.
- Edit: `API/Backend/Config/setup.js` — the Pug `index.pug` flags (`WITH_STAC`, `WITH_TIPG`, `WITH_TITILER`) continue to be passed; in `lean` mode they are forced to `false` regardless of env. The Configure SPA already honors these flags (it hides the STAC tab when `WITH_STAC=false`); no Configure edit needed.
- Edit: `configure/src/pages/STAC.js` — leave the page intact; it's reached only when the STAC tab is visible.
- Edit: `docker-compose.yml`, `docker-compose.dev.yml` — leave the sidecar services intact under their existing `profiles: ["stac"]` / `profiles: ["veloserver"]` gates. The lean deployment doesn't use docker-compose in production; local dev can still spin up the sidecars when needed.
- Edit: `scripts/init-db.js` — in `lean` mode, skip the `mmgis-stac` database creation and the `pypgstac migrate` shell-out (the `pgstac` extension itself comes from the Postgres image, not from MMGIS). In `full` mode (default) the existing behavior is preserved.

**Operations:**
1. Apply the gates above. Default mode keeps every full path intact.
2. Spot-check that `lean` mode boots without any sidecar warnings, errors, or HTTP route registrations under `/titiler`, `/stac`, `/tipg`, `/titilerpgstac`, `/veloserver`.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean npm start`: `/titiler` etc. return 404.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset) + `WITH_TITILER=true` + a TiTiler at localhost:8883: `/titiler/...` still proxies as before.
- `mmgis-stac` database is not created when `lean` mode is set on a fresh deploy.

**Rollback:** Revert the gate edits; default behavior remains intact regardless because the gates default to `full`.

---

## Phase 3 — Gate the upload surface

**Goal:** In `lean` mode, no upload endpoint accepts files. In `full` mode, today's upload paths work unchanged. (#32 in `features.md`.)

The dataset and geodataset *read* paths remain in both modes (Postgres rows are queryable).

**Files:**
- Edit: `API/Backend/Datasets/routes/datasets.js` — wrap the Busboy upload handler in `if (isLean()) return res.status(404).end()` early-return. Keep the read endpoints unguarded.
- Edit: `API/Backend/Geodatasets/routes/geodatasets.js` — same.
- Edit: `API/Backend/Draw/routes/files.js` — same on the upload paths; Draw write-edits (which write Postgres) stay enabled in both modes.
- Edit: `scripts/server.js` — leave the `bodyParser` 500 MB cap in place. The cap is meaningful in `full` mode for Draw payloads.
- Edit: `configure/src/pages/Datasets.js`, `GeoDatasets.js` — hide the upload affordance when the SPA receives a "deployment mode = lean" hint from the bootstrap. The hint can ride the existing `WITH_*` Pug flags as a sibling `DEPLOYMENT_MODE` flag. Add to `API/Backend/Config/setup.js`.
- Edit: `configure/src/core/calls.js` — leave call definitions; the affordances that invoke them are hidden.

**Operations:**
1. Add the early-return gates on upload routes.
2. Add the `DEPLOYMENT_MODE` flag to the Configure shell Pug template, plumb through to the SPA's Redux store at boot.
3. Update Datasets/GeoDatasets pages to read the flag.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean`: `POST /api/datasets/upload` returns 404; Datasets page in Configure renders the list view but no Add button.
- `MMGIS_DEPLOYMENT_MODE=full`: upload still works.

**Rollback:** Revert the gate edits.

---

## Phase 4 — Gate the `Missions/` middleware and `_time_` compositor

**Goal:** In `lean` mode, the admin does not mount the `Missions/` static middleware or the `_time_` compositor. In `full` mode the existing 3-middleware stack is unchanged. (#26 in `features.md`.) The compositor logic is preserved for the upstream team and for any future opt-in.

This is the surface slesa flagged at "section 3.2 Time-composited layers in dashboards" — the keep variant preserves the code so the discussion can be revisited.

**Files:**
- Edit: `scripts/server.js` — wrap the three middleware mounts (`ensureUser()`, `missions(ROOT_PATH)`, `express.static('Missions')`) in `if (isFull()) { ... }`.
- `scripts/middleware.js` — unchanged. The factory still exists; it just isn't mounted in `lean` mode.
- Edit: `sample.env` — document that `MISSIONS_*` env vars apply only to `full` mode.
- Edit: `package.json` — `sharp` stays in dependencies (the full-mode compositor uses it).

**Operations:**
1. Apply the mount-time gate in `scripts/server.js`.
2. Document in code comments which features depend on `full` mode.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean`: `GET /Missions/whatever` returns 404 from Express (no middleware mounted).
- `MMGIS_DEPLOYMENT_MODE=full`: existing behavior — file served (or path-traversal error).
- `_time_` URLs in `full` mode still composite via `sharp`.

**Rollback:** Revert the gate edit; `full` mode is the default.

---

## Phase 5 — Trim no-op features in lean mode

**Goal:** Link shortener and webhooks have no meaningful role in the lean deployment, but the upstream code path still uses them. Keep both modules; gate their *route mounting* on `full` mode so the admin URL surface is smaller in `lean`.

**Files (link shortener, #34):**
- Edit: `API/Backend/Shortener/setup.js` — wrap the route mount in `if (isFull())`. The model and routes remain in the repo.

**Files (webhooks, #33):**
- Edit: `API/Backend/Webhooks/setup.js` — wrap the route mount in `if (isFull())`.
- Edit: `API/Backend/Draw/routes/draw.js` — the `Webhooks/processes/triggerwebhooks` call is wrapped in `if (isFull())`.
- Edit: `configure/src/pages/WebHooks.js` and its route registration — hide from the SPA when `DEPLOYMENT_MODE === 'lean'`.

**Operations:**
1. Apply the gates.

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean`: shortener and webhook routes return 404; Webhooks tab not visible in Configure.
- `MMGIS_DEPLOYMENT_MODE=full`: existing behavior.

**Rollback:** Revert the gate edits.

---

## Phase 6 — Frontend refactor: dispatcher, sidecar-URL helper, mission-config bake

**Goal:** Activate the dispatcher's dormant `SERVER != 'node'` branch with a bake/reroute/compute/drop table. Centralize the inline sidecar-URL builders in four files into one helper. Generate the baked mission config at publish time. Disable the WebSocket connect and login form in static mode. The activations are tied to the build mode (`static` vs `server`), independent of the server-side `MMGIS_DEPLOYMENT_MODE`. (#10, #14 in `features.md`.)

**Note:** This phase is structurally identical to the burn variant's Phase 6. The frontend code doesn't need a `full/lean` runtime gate because dashboard builds always run in `static` mode and admin builds always run in `server` mode. The helper's reroute disposition table is what holds the runtime difference.

**Files:**
- Edit: `public/index.html` — `mmgisglobal.SERVER` is set from a Webpack `DefinePlugin` value. Server-mode build: `"node"`. Static-mode build: `"static"`.
- Edit: `src/pre/calls.js` — replace the dormant `if (window.mmgisglobal.SERVER != 'node') { console.warn(…); error() }` block with a dispatch into a `STATIC_HANDLERS` table.
- New: `src/pre/staticHandlers.js` — bake/reroute/compute/drop entries keyed by `c[]` name.
- New: `src/essence/Basics/serviceUrls.js` — helper exporting per-service URL functions. Server-mode return value: same-origin paths (so full MMGIS admin still hits `/titiler`). Static-mode return value: the absolute URL from the baked config.
- Edit: `src/essence/Basics/Map_/Map_.js`, `src/essence/Basics/Layers_/Layers_.js`, `src/essence/Tools/Identifier/IdentifierTool.js`, `src/essence/Tools/Layers/LayersTool.js` — replace inline interpolations with helper calls.
- Edit: `API/updateTools.js` — add `bakeStaticConfig` codegen.
- Edit: `src/essence/LandingPage/LandingPage.js` — short-circuit `init` in static mode.
- Edit: `src/essence/essence.js` — login modal skipped in static mode.
- Edit: `src/essence/essence.js` — WebSocket layer-update consumer (`essence.ws` at lines 141–321) short-circuits in static mode.

**Operations:**
1. Wire `DefinePlugin`.
2. Implement `STATIC_HANDLERS`. **Difference from burn variant:** the `reroute` cases for `getbands`, `getprofile`, `proj42wkt` can optionally point at the full admin's same-origin endpoints if a dashboard's audience happens to host one nearby. This is mission-config-driven, not a hard route in the table — the table just gives the mission the option.
3. Implement `serviceUrls.js`.
4. Implement `bakeStaticConfig`.
5. Implement the LandingPage short-circuit, the login skip, the WebSocket skip.

**Verification:**
- Server-mode build (today's `npm run build`) works unchanged.
- Static-mode build produces a `build-static/` that loads without `/api/*` calls.
- `full` admin still uses same-origin sidecar paths.
- Refactored URL builders in the four files use the helper.

**Rollback:** `git revert` the phase. Server mode is unaffected.

---

## Phase 7 — Publish flow: backend module + spawned ECS task + CloudFormation template

**Goal:** Add the admin's Publish and Delete endpoints, the spawned-ECS-task that runs the static build and provisions a per-dashboard CloudFormation stack, and the new `dashboards` Postgres table. (#53, #54, #55 in `features.md`.)

**Note:** This phase is mode-aware. The Dashboards backend module is always loaded but the route mounts are gated on `isLean()` — full deployments do not need or expose the publish endpoints because they're not the deployment that publishes dashboards. The model and migrations still run in both modes (so a full admin can adopt `lean` mode later without a schema migration step).

**Files:**
- New: `API/Backend/Dashboards/setup.js` — `onceSynced`/`onceInit` lifecycle. The `synced` step (Sequelize sync) runs in both modes; the `init` step (route mounting) gates on `isLean()`.
- New: `API/Backend/Dashboards/models/dashboard.js` — Sequelize model. Columns as in burn-variant Phase 7: `id`, `name`, `mission`, `created_by`, `status`, `stack_arn`, `stack_name`, `cloudfront_url` (cached), `settings`, `last_error`, timestamps. Stack outputs come from `DescribeStacks` at read time, not from the row.
- New: `API/Backend/Dashboards/routes/dashboards.js` — endpoints. Mounted only when `isLean()`. The `ensureAdmin` guard remains; full admin routes use the same guard for parity. `GET` paths merge Postgres rows with `DescribeStacks` live state.
- New: `scripts/publish-static.js`, `scripts/lib/cfn-template.js`, `scripts/lib/aws-provision.js` — same as burn variant. The publish task calls `CreateStack` and polls `DescribeStacks` until terminal state, then uploads the bundle. `DeleteStack` is called inline from the admin's `DELETE` handler (no separate teardown script).
- New: `configure/src/pages/Dashboards.js` — admin UI. The Dashboards tab is hidden from the SPA's nav when `DEPLOYMENT_MODE === 'full'`.
- Edit: `configure/src/core/calls.js`, `Configure.js` — same as burn variant.

**Operations:**
1. Implement the model. `setups.synced(s)` syncs on boot in both modes — keep the model passive in full mode (the table is created, but nothing writes to it).
2. Implement the router with the `isLean()` mount gate.
3. Implement the CloudFormation template renderer (`cfn-template.js`) and the publish wiring (`publish-static.js`, `aws-provision.js`). The publish task lives for the ~10 min `CreateStack` → `CREATE_COMPLETE` → upload sequence. The `DELETE` handler empties the bucket, calls `DeleteStack`, and returns immediately.
4. Plumb `DEPLOYMENT_MODE` through Configure as a Pug-rendered flag (already added in Phase 3); hide the Dashboards tab in full mode.
5. Render the CloudFront Function source into the template body with the password baked in as a base64-encoded constant (not as a CFN parameter, which would surface in `DescribeStacks`).

**Verification:**
- `MMGIS_DEPLOYMENT_MODE=lean` + admin deploy: Dashboards page appears, Publish works end-to-end (stack reaches `CREATE_COMPLETE`, bundle uploads, row reaches `published`), Delete works (`DeleteStack` returns immediately, row reaches `deleted` on the next read once `DescribeStacks` returns "no such stack").
- `MMGIS_DEPLOYMENT_MODE=full`: Dashboards tab not visible, `/api/dashboards/*` returns 404, but the `dashboards` table exists in Postgres (silently) so a mode flip later doesn't need a migration.

**Rollback:** `git revert` the phase. Existing stacks need manual cleanup via the AWS console (list stacks under the `mmgis-dashboard-*` prefix, delete each); the `dashboards` table is benign (no FK pressure) and can be left or dropped manually.

---

## Phase 8 — ECS task definitions, IAM, GitHub Actions deploy

**Goal:** Land the AWS infrastructure for the lean deployment. Define IAM scopes. Move CI/CD from `docker-compose` to GitHub Actions.

**Note:** This phase is `lean`-deployment-only. The full deployment continues to use whatever CI/CD it uses today (the original NASA-AMMOS pipeline). Our `infrastructure/` directory is for the VEDA AWS deployment; upstream contributors don't need to touch it.

**Files:**
- New: `.github/workflows/deploy-lean.yml` — GitHub Actions workflow specific to the VEDA AWS deployment. Triggers on push to a release branch tagged for VEDA (e.g., `release/lean-*`). Builds the image with `MMGIS_DEPLOYMENT_MODE=lean` injected as a build-time default in the task definition.
- New: `infrastructure/ecs/admin-task.json` — admin task definition. Environment variables include `MMGIS_DEPLOYMENT_MODE=lean`.
- New: `infrastructure/ecs/publish-task.json` — publish-task definition.
- New: `infrastructure/iam/admin-role.json` — admin's ECS task role. Permissions as in burn-variant Phase 8 (includes `cloudformation:DescribeStacks` for live-state merge and `cloudformation:DeleteStack` + bucket-empty permissions for the inline delete handler).
- New: `infrastructure/iam/publish-role.json` — publish task role. Permissions as in burn-variant Phase 8 (CloudFormation create/describe/delete + the underlying S3/CloudFront permissions CFN exercises on the role's behalf).
- New: `infrastructure/cloudfront-admin.json` — CloudFront distribution config.
- New: `infrastructure/cloudfront-function.js` — reference source for the password-gate Function; embedded into the rendered CloudFormation template at publish time.
- Edit: `Dockerfile` — no edit needed if `MMGIS_DEPLOYMENT_MODE` is passed via ECS env vars (recommended). If baked at build time, multi-stage with an arg.

**Operations:**
1. Author task definitions, IAM roles, CloudFront config.
2. Author the GitHub Actions workflow.
3. Document the prereqs (VPC, subnets, ACM cert, Secrets Manager entries).
4. Document the dual-deployment posture in README: "this repo deploys two ways — `MMGIS_DEPLOYMENT_MODE=full` (the upstream path, default) and `MMGIS_DEPLOYMENT_MODE=lean` (our AWS deployment, via the workflow in `.github/workflows/deploy-lean.yml`)."

**Verification:**
- Deploy to a staging AWS account with `MMGIS_DEPLOYMENT_MODE=lean`. Hit the admin URL; login; configure a mission referencing a public COG URL; publish a dashboard; open the dashboard URL.
- On the same admin image, locally run `MMGIS_DEPLOYMENT_MODE=full npm start` and confirm all sidecar proxies, upload routes, Missions middleware, and dashboards-route 404 behave per the full contract.

**Rollback:** Tear down the staging environment.

---

## Phase 9 — Hardening: DB-down boot, first-signup, superadmin

**Goal:** Address the two open concerns from the ADR that survive the move to CloudFormation, plus the latent WebSocket idle-timeout footgun in the existing code. Apply uniformly to both modes (full and lean) where the change makes sense — `init-db.js` retry, `first_signup` disable, superadmin seed, WebSocket heartbeat. The teardown-reliability concern is dropped because CloudFormation owns the resource-lifecycle dance; the live-reads pattern from Phase 7 surfaces stuck stacks in the UI without a separate reconcile job.

**Files:**
- Edit: `scripts/init-db.js` — bounded retry loop on Postgres connect (applies to both modes; upstream benefits too).
- Edit: `scripts/init-db.js` — when `SEED_SUPERADMIN_USERNAME` + `SEED_SUPERADMIN_PASSWORD` env are present, seed a superadmin. Applies to both modes.
- Edit: `API/Backend/Users/routes/users.js` — gate the `POST /api/users/first_signup` route on a new env var `DISABLE_FIRST_SIGNUP=true`. The lean deployment sets this; full-mode deployments leave it unset to preserve today's behavior. Document the security implication for full mode.
- Edit: `API/websocket.js` — add a server-side ping/pong heartbeat on `wss`. On each tick (default 30s, configurable via `WEBSOCKET_PING_INTERVAL_MS`), iterate `wss.clients`: if a client did not pong since the previous tick, `ws.terminate()`; otherwise mark it unresponsive and call `ws.ping()`. Register a `pong` handler on each connection that clears the unresponsive mark. Clear the interval on `wss.close`. Applies to both modes — the existing code has no heartbeat, leaving the WS vulnerable to any 60s-idle intermediary (ALB default, NAT, corporate proxy, mobile carrier).
- Optional: rename the misleading `webSocketPingInterval` field in `src/essence/essence.js` (line 137) and `configure/src/core/Websocket.js` (line 12) to `webSocketReconnectInterval`. Both are reconnect timers despite the name — the rename is documentation, no functional change. No client-side ping code is needed; the browser `WebSocket` API answers server pings automatically.

**Operations:**
1. Implement the retry loop.
2. Implement the seed mechanism.
3. Gate `first_signup` on the env var.
4. Implement the server-side heartbeat. Document `WEBSOCKET_PING_INTERVAL_MS` in `sample.env`.

**Verification:**
- Postgres-down restart: bounded retry, clean failure, ECS handles.
- Fresh deploy: superadmin user exists after init-db with `SEED_*` env vars.
- `DISABLE_FIRST_SIGNUP=true` deploy: `POST /api/users/first_signup` returns 404. Unset: returns the existing behavior.
- Open the admin, leave Configure idle for 10+ minutes behind the ALB. WS stays connected; no "Websocket disconnected" banner; Essence's `LayerUpdatedControl` does not enter the `DISCONNECTED` state. ALB CloudWatch `IdleTimeoutClosedConnectionCount` does not increment for the admin target group on the WS path.
- Local repro behind a deliberate 60s-idle reverse proxy (e.g. nginx with `proxy_read_timeout 60s`): the heartbeat keeps the connection alive across the 60s window.

**On stuck stacks.** Same as burn variant: failed publishes (`CREATE_FAILED`, `ROLLBACK_COMPLETE`) and failed deletes (`DELETE_FAILED`) surface in the Dashboards page via the live-state pattern from Phase 7. The default escape hatch is the Delete affordance, which retries `DeleteStack`. If failures recur, follow up with a stack-events-via-SNS update path (out of scope for this plan).

**Rollback:** `git revert` the phase.

---

## Phase 10 — Cleanup pass

**Goal:** Catch what the gating left rough. Re-audit, update docs, ensure both modes are covered in tests.

**Operations:**
1. `git grep -E 'isLean|isFull|MMGIS_DEPLOYMENT_MODE'` — confirm every consumer reads through the helper, not directly from `process.env`.
2. Audit test coverage for both modes. Add a CI matrix that runs `npm test` with `MMGIS_DEPLOYMENT_MODE=full` and `=lean`.
3. Update README.md and `AGENTS.md` to document the dual-mode posture.
4. Update `docs/` Jekyll site to document the new env var and the deployment shapes.
5. Add an upstream-contribution note: changes that touch a gated surface should be authored in `full` mode first, then verified to not break `lean` mode.

**Verification:**
- CI passes in both modes.
- Documentation renders correctly.

**Rollback:** N/A — cleanup is incremental.

---

## Cross-mode invariants

The keep variant introduces complexity that has to be enforced over time. The following invariants need to be held to avoid drift.

- **Default mode is `full`.** Upstream contributors who clone the repo and run `npm start` get today's behavior. `MMGIS_DEPLOYMENT_MODE=lean` is opt-in.
- **No silent breakage when mode is unknown.** The helper throws at startup on unrecognized values.
- **Frontend code does not branch on the runtime mode.** The dashboard bundle is built in `static` mode; the admin bundle is built in `server` mode. Build mode and deployment mode are orthogonal but in practice tightly correlated: a `lean`-mode admin serves a `server`-mode bundle; a published dashboard is a `static`-mode bundle.
- **`isLean()` is *additive*, not *destructive*.** A `lean`-only feature gets gated on `if (isLean())`. A *full*-only feature gets gated on `if (isFull())`. Never use `if (!isFull())` — write the explicit `if (isLean())` so the read is unambiguous.
- **CI runs both modes.** A pull request that breaks `full` mode should fail CI.
- **Gates apply at the smallest unit that makes sense** — usually route mounts, occasionally individual handlers, rarely entire files.

## What this plan does *not* cover

- A migration path from `full` to `lean` mode in an existing deployment. Both modes share the same database schema in this plan, but a long-running `full` admin would have `Missions/` filesystem state that `lean` mode can't read; the migration tooling for that is out of scope.
- Mission-config validation that flags configs referencing sidecar URLs in `lean` mode.
- Cross-account audit logging for dashboards published outside our AWS organization.
- A planned removal date for the `full` mode gates, if the keep variant proves vestigial. (See `adr.md` D2 for the "revisit and burn" criterion.)

These are tracked outside this plan.
