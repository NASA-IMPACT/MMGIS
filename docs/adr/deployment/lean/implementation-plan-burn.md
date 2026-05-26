# Implementation plan — burn variant

**Status:** Draft
**Last updated:** 2026-05-20
**Companion to:** [`adr.md`](./adr.md) (D2 = burn). Parallel structure to [`implementation-plan-keep.md`](./implementation-plan-keep.md) — same phase numbering, so the two can be diffed.

This plan deletes the surfaces that don't ship in the lean angle. The repository state after this plan reflects exactly what the team deploys.

The companion features inventory is [`../features.md`](../features.md); per-feature rows are cited as `#NN`.

Each phase has the same structure: **Goal / Files / Operations / Verification / Rollback**.

Conventions:
- All file paths are relative to the repository root.
- "Delete" means `git rm` the file; "Remove" means edit the file to take out a block.
- Code disposition is recorded inline; the dispatcher table contents are deferred to Phase 6.

---

## Phase 1 — Pre-work: build flag, env allowlist, baked-config stub

**Goal:** Add the build-time switch that the rest of the plan keys off of, and the empty stub that the publish script will overwrite. No behavior change at this point.

**Files:**
- `configuration/env.js`
- `configuration/webpack.config.js`
- `src/pre/staticConfig.js` (new, gitignored)
- `src/essence/Basics/mode.js` (new)
- `.gitignore`

**Operations:**
1. Add the env-var allowlist entries in `configuration/env.js`: `STATIC_MODE`, `STATIC_MISSION_NAME`. (No `STATIC_*_URL` sidecar env vars — no sidecars to point at.)
2. Add a Webpack alias `STATIC_MISSION_CONFIG -> src/pre/staticConfig.js` in `configuration/webpack.config.js`. The file must live under `src/` to satisfy CRA-style `ModuleScopePlugin`.
3. Create `src/pre/staticConfig.js` as a gitignored stub exporting `{}`. The publish script overwrites it; checked-in state is empty.
4. Create `src/essence/Basics/mode.js` exporting a `MODE` constant derived from `window.mmgisglobal.SERVER`. The exported value is `'static'` when `SERVER !== 'node'`, otherwise `'server'`.
5. Add `src/pre/staticConfig.js` and `build-static/` to `.gitignore`.

**Verification:**
- `npm run build` succeeds with no behavior change.
- `import { MODE } from 'src/essence/Basics/mode'` returns `'server'` in dev.

**Rollback:** Revert the four file additions and the env allowlist edit.

---

## Phase 2 — Burn the sidecar proxy

**Goal:** Remove the adjacent-server proxy front door, the spawner, the env-flagged `WITH_*` switches, and the four sidecar directories. After this phase the codebase has no concept of TiTiler / STAC / tipg / veloserver / TiTiler-pgSTAC as in-process services. (#35, #36, #41 in `features.md`.)

**Files:**
- Delete: `adjacent-servers/adjacent-servers-proxy.js`
- Delete: `adjacent-servers/adjacent-servers.js`
- Delete: `adjacent-servers/titiler/`, `adjacent-servers/titiler-pgstac/`, `adjacent-servers/stac/`, `adjacent-servers/tipg/` (note: veloserver is proxy-only and has no vendored directory — only its proxy route needs removing).
- Edit: `scripts/server.js` — remove the `require('../adjacent-servers/adjacent-servers-proxy.js')` and the line(s) where its `setup(app, ...)` is called.
- Edit: `scripts/server.js` — remove the `require('../adjacent-servers/adjacent-servers.js')` spawn-on-boot block.
- Edit: `configuration/env.js` — remove `WITH_TITILER`, `WITH_STAC`, `WITH_TIPG`, `WITH_TITILER_PGSTAC`, `WITH_VELOSERVER`, every `TITILER_*`, `STAC_*`, `TIPG_*`, `VELOSERVER_*` env, and the `ADJACENT_SERVER_CUSTOM_<N>` registry.
- Edit: `API/Backend/Config/setup.js` — the Pug `index.pug` rendering passes `WITH_STAC` / `WITH_TIPG` / `WITH_TITILER` flags into the Configure shell template; remove those passes.
- Edit: `configure/src/pages/STAC.js` (or its parent route registration) — the STAC tab in Configure exists for the embedded STAC sidecar. Remove the page, the route, and any nav entry.
- Delete: `docker-compose.yml` — remove the `stac`, `titiler`, `tipg`, `titiler-pgstac`, `veloserver` services and their `profiles: ["stac"]` / `profiles: ["veloserver"]` entries. The MMGIS app + Postgres services stay.
- Delete: `docker-compose.dev.yml` — same edits as `docker-compose.yml`.
- Delete: `docker-compose.db.yml` mentions of the STAC database initialization. (The `mmgis-stac` database is not created in this angle.)
- Edit: `scripts/init-db.js` — remove the `mmgis-stac` database creation and the `pypgstac migrate` shell-out (the `pgstac` extension itself is provided by the Postgres image, not installed by MMGIS). Leave `btree_gist` alone (it's installed on the main MMGIS DB regardless).
- Edit: `sample.env` — remove all `WITH_*`, `TITILER_*`, `STAC_*`, `TIPG_*`, `VELOSERVER_*`, `TITILER_PGSTAC_*` entries.

**Operations:**
1. Delete the listed files and directories.
2. Edit the listed files to remove proxy mounting, spawning, env-var allowlisting, Pug-flag passing, and Configure UI surface.
3. Grep the repository for any remaining mention of `/titiler`, `/stac`, `/tipg`, `/veloserver`, `/titilerpgstac`, `WITH_TITILER`, etc., and remove. Spot-check known consumers:
   - `src/essence/Basics/Map_/Map_.js`
   - `src/essence/Basics/Layers_/Layers_.js`
   - `src/essence/Tools/Identifier/IdentifierTool.js`
   - `src/essence/Tools/Layers/LayersTool.js`
4. Remove the `API/Backend/Stac/` backend module entirely (the per-route handler that decorates STAC responses with mission/layer occurrences — that decoration runs on the proxy path that no longer exists).

**Verification:**
- `git grep -E 'WITH_TITILER|WITH_STAC|WITH_TIPG|WITH_VELOSERVER|/titiler|/stac|/tipg|/veloserver|adjacent-servers'` returns no hits outside `docs/adr/deployment/preserve/` (which we leave for reference) and `features.md` (the inventory, also kept for reference).
- `npm start` boots without any sidecar-related warnings or errors.
- `npm run build` succeeds.
- `npm test` passes; remove any tests that exist solely for the deleted modules.

**Rollback:** `git revert` the phase. The deleted directories return as-was.

---

## Phase 3 — Burn the upload surface

**Goal:** Remove every path that ingests files into the MMGIS server. (#32 in `features.md`.) The admin no longer accepts dataset CSV uploads, geodataset GeoJSON uploads, or mission-asset file uploads.

The dataset and geodataset *models* and *read paths* survive — datasets-as-rows in Postgres remain queryable; only the ingest is gone. Layered: the route still exists, the upload mechanism does not.

**Files:**
- Edit: `API/Backend/Datasets/routes/datasets.js` — remove the Busboy upload handler, the multipart parsing, and the `makeNewDatasetTable` codegen path. Keep the read endpoints (`GET /api/datasets/...`) and the query endpoints. The CSV-via-csvtojson code path is deleted; the `makeNewDatasetTable` helper file `API/Backend/Datasets/utils/makeNewDatasetTable.js` (or wherever it is) is also deleted.
- Edit: `API/Backend/Geodatasets/routes/geodatasets.js` — remove the upload handler; keep `GET /api/geodatasets/.../mvt` and `/geojson` read paths.
- Edit: `API/Backend/Draw/routes/files.js` — drawing-file *upload* paths drop; in-line drawing edits stay. The "publish a baked drawing as a feature file" admin action stays because it writes to Postgres, not disk.
- Edit: `package.json` — remove `busboy`, `csvtojson` if not used elsewhere. Re-run `npm install` to update the lockfile.
- Edit: `configure/src/pages/Datasets.js` — remove the upload-form components and their wiring; keep the table/list view of existing datasets. Same for `configure/src/pages/GeoDatasets.js`.
- Edit: `configure/src/core/calls.js` — remove `uploadDataset`, `uploadGeodataset`, and any other `upload*` entries.
- Edit: `scripts/server.js` — remove the `bodyParser` 500 MB cap; restore the framework default (1 MB is fine for the Draw payload sizes we still accept). Verify by checking the largest Draw POST payload size in production traces if available.

**Operations:**
1. Edit the listed routers to remove upload handlers.
2. Delete the upload helper utilities (`makeNewDatasetTable.js` and similar).
3. Edit the Configure SPA pages.
4. Update `package.json`; run `npm install`.
5. Re-run `npm test` and remove tests pinned to deleted upload paths.

**Verification:**
- `POST /api/datasets/upload` returns 404.
- The Datasets page in Configure renders the existing datasets list but the "Add" affordance is gone.
- `git grep -E "busboy|csvtojson|multipart"` returns no hits outside the preserve folder.

**Rollback:** `git revert` the phase. Re-install the removed npm deps.

---

## Phase 4 — Burn the `Missions/` middleware and `_time_` compositor

**Goal:** Remove the static-file middleware that serves `/Missions/*`, the path-traversal hardening, and the `sharp`-driven `_time_` time-window compositing. (#26 in `features.md`.) The admin no longer serves mission assets at all.

This is the surface slesa flagged at "section 3.2 Time-composited layers in dashboards" — the server-side compositing logic.

**Files:**
- Delete: `scripts/middleware.js` (the file contains the `missions(ROOT_PATH)` factory and the `_time_` compositor).
- Edit: `scripts/server.js` — remove the import of `./middleware` and the three middleware mounts (`ensureUser()`, `missions(ROOT_PATH)`, `express.static('Missions')`).
- Edit: `package.json` — remove `sharp` from dependencies if no other code consumes it. (Grep first; some legend-rendering paths may.)
- Edit: `sample.env` — remove any `MISSIONS_*` env vars.
- Delete: any `Missions/Demo/` checked-in mission data (the only mission data in the repo is for local dev examples; if `npm run start:prod:with_examples` references them, that path also goes).
- Edit: `package.json` — remove `start:prod:with_examples` if it relied on the checked-in `Missions/` data.

**Operations:**
1. Delete `scripts/middleware.js`.
2. Edit `scripts/server.js`.
3. Audit `package.json` for `sharp` consumers; only delete if no others.
4. Delete or trim the Missions example data; update `.gitignore` to remove `Missions/` if it was tracked.

**Verification:**
- `GET /Missions/whatever` returns 404 from Express.
- `npm test` passes after removing tests targeting `missions()`.
- The local dev server boots and the admin UI works without any `Missions/` content (the mission picker is empty unless seeded via Configure).

**Rollback:** `git revert` the phase. Restore `sharp`.

---

## Phase 5 — Trim other unused server features

**Goal:** Remove the link shortener and the webhooks module if neither has consumers in the lean angle. These are not high-cost surfaces but they are surface, and the burn variant's value proposition is "the codebase reflects the deployment."

Re-evaluate before deleting; this phase may shrink based on whether VEDA wants to keep webhook integrations.

**Files (link shortener, #34):**
- Delete: `API/Backend/Shortener/`
- Edit: `API/setups.js` — confirm autoload uses directory scan; no edit needed.
- Edit: `sample.env` — remove `DISABLE_LINK_SHORTENER`.

**Files (webhooks, #33):**
- Delete: `API/Backend/Webhooks/`
- Edit: `API/Backend/Draw/routes/draw.js` — remove the `Webhooks/processes/triggerwebhooks` call from the Draw write paths.
- Edit: `configure/src/pages/WebHooks.js` and its route registration — remove from Configure SPA.

**Operations:**
1. Confirm with stakeholders that neither has consumers. If webhooks is wanted, skip its deletion and treat this phase as link-shortener-only.
2. Delete the directories.
3. Remove call sites.
4. Run `npm test` and drop any tests for the removed modules.

**Verification:**
- Routes `/short/*` (or wherever the shortener mounted) return 404.
- Routes `/api/webhooks` return 404.
- Draw writes succeed and do not log webhook errors.

**Rollback:** `git revert` the phase.

---

## Phase 6 — Frontend refactor: dispatcher, sidecar-URL helper, mission-config bake

**Goal:** Activate the dispatcher's dormant `SERVER != 'node'` branch with a bake/reroute/compute/drop table. Centralize the inline sidecar-URL builders in four files into one helper. Generate the baked mission config at publish time. Disable the WebSocket connect and login form in static mode. (#10, #14 in `features.md`.)

**Files:**
- Edit: `public/index.html` — change line 341 so `mmgisglobal.SERVER` is set from a Webpack `DefinePlugin` value. In server-mode builds the value is `"node"` (no change); in static-mode builds the value is `"static"`.
- Edit: `src/pre/calls.js` — replace the dormant `if (window.mmgisglobal.SERVER != 'node') { console.warn(…); error() }` block with a dispatch into a `STATIC_HANDLERS` table. The table is populated from imports — see below.
- New: `src/pre/staticHandlers.js` — the bake/reroute/compute/drop table. Each entry keyed by call name from `c[]` in `calls.js`. Cases:
  - **Bake** — read from `STATIC_MISSION_CONFIG` (the Webpack-aliased module that resolves to `src/pre/staticConfig.js`). Calls: `getMission`, `getConfig`, `getMissions`, `getGeneralOptions`.
  - **Reroute** — point at an external URL baked into the config. Calls (in lean): none by default — the natural `reroute` targets would be sidecars we no longer deploy. If a mission's audience wants client-side calls against their VEDA microservices, those URLs are in the layer config directly, not in the dispatcher.
  - **Compute** — answer in browser using baked data. Candidates: `query_tileset_times` (use baked `tilesetTimes`), possibly elevation profile (if baked DEM is available — usually not).
  - **Drop** — return an error gracefully. Calls: `login`, `signup`, all write endpoints (`saveConfig`, `addDataset`, `uploadFile`, every Draw write, etc.), `first_signup`.
- New: `src/essence/Basics/serviceUrls.js` — a helper exporting `getTitilerBaseUrl()`, `getStacBaseUrl()`, `getTipgBaseUrl()`, etc. In server mode it returns same-origin paths (`/titiler`, `/stac`, ...) — except in the burn variant those paths don't exist in production, so the helper's server-mode return value is *only* used in development against a local sidecar. In static mode it returns the absolute URL from `STATIC_MISSION_CONFIG`. *Note for the burn variant:* a layer in a lean mission config points directly at an external service; the helper exists for the four inline-URL files to import a single source of truth, but its production behavior is "return whatever the config says, never construct a path."
- Edit: `src/essence/Basics/Map_/Map_.js` — replace inline `/titiler/...` interpolations with `serviceUrls` helper calls.
- Edit: `src/essence/Basics/Layers_/Layers_.js` — same.
- Edit: `src/essence/Tools/Identifier/IdentifierTool.js` — same.
- Edit: `src/essence/Tools/Layers/LayersTool.js` — same.
- Edit: `API/updateTools.js` — add a `bakeStaticConfig({ configData, missionsList, generalOptions, mission })` codegen function that writes `src/pre/staticConfig.js` with the mission config frozen as `export default {...}`.
- Edit: `src/essence/LandingPage/LandingPage.js` — short-circuit `init` when `MODE === 'static'`. Skip the mission-picker grid, immediately call `essence.init(...)` with the baked config.
- Edit: `src/essence/essence.js` — when `MODE === 'static'`, don't render the login modal in any flow; treat the user as anonymous read-only.
- Edit: `src/essence/essence.js` — short-circuit the WebSocket connect call (`essence.ws = new WebSocket(...)` at lines 141–321) to no-op in static mode. This is the layer-update-notification consumer for the main map client. The Configure SPA's WebSocket consumer is admin-only and doesn't ship in dashboards, so no separate edit needed. Draw is not a WebSocket subscriber.

**Operations:**
1. Wire `DefinePlugin` in `configuration/webpack.config.js` to inject the build mode into `public/index.html`'s `mmgisglobal.SERVER` assignment.
2. Implement `STATIC_HANDLERS`.
3. Implement `serviceUrls.js` and rewrite the four inline-URL files to use it. Grep verifies (`git grep -E "/titiler/|/stac/|/tipg/"` returns no matches in `src/`).
4. Implement `bakeStaticConfig`.
5. Implement the LandingPage short-circuit, the `essence.js` login skip, and the WebSocket skip.

**Verification:**
- Server-mode `npm run build` + `npm start` works exactly as today.
- A unit spec: set `STATIC_MODE=true` and a fixture `staticConfig.js`, run the static build, serve `build-static/` with `npx serve`, observe that the page loads without any `/api/*` network calls.
- The dispatcher returns the baked mission config when `getMission` is called in static mode.
- The mission picker is not rendered in static mode.
- A WebSocket connection attempt is not made in static mode (DevTools Network shows no ws upgrade).

**Rollback:** `git revert` the phase. Server mode is unaffected; static mode wasn't deployed yet.

---

## Phase 7 — Publish flow: backend module + spawned ECS task + CloudFormation template

**Goal:** Add the admin's Publish and Delete endpoints, the spawned-ECS-task that runs the static build and provisions a per-dashboard CloudFormation stack, and the new `dashboards` Postgres table. (#53, #54, #55 in `features.md`.)

**Files:**
- New: `API/Backend/Dashboards/setup.js`
- New: `API/Backend/Dashboards/models/dashboard.js` — Sequelize model. Columns: `id (PK)`, `name (string, unique per mission)`, `mission (string)`, `created_by (FK users)`, `status (enum: provisioning, published, deleting, deleted, failed)`, `stack_arn (string, unique, nullable until CreateStack returns)`, `stack_name (string, derived from id)`, `cloudfront_url (string, cached for list rendering)`, `settings (JSONB)`, `last_error (text, nullable)`, `created_at`, `updated_at`, `deleted_at`. Stack outputs (`bucket_name`, `cloudfront_id`, `function_arn`) are not duplicated into the row — they come from `DescribeStacks` at read time. The password value is not stored per-dashboard; it lives in Secrets Manager and is baked into the Function source at template-render time.
- New: `API/Backend/Dashboards/routes/dashboards.js` — endpoints: `POST /api/dashboards/publish`, `DELETE /api/dashboards/:id`, `GET /api/dashboards`, `GET /api/dashboards/:id`. All admin-only via `s.ensureAdmin(true, false, false)`. The `GET` paths call `DescribeStacks` for each row's `stack_arn` (batched into one `DescribeStacks` call for the list endpoint) and merge live status into the response.
- New: `scripts/publish-static.js` — CLI invoked by the spawned ECS task. Argument: `--dashboard-id`. Sequence: read the dashboard row + mission config from RDS, run `bakeStaticConfig`, spawn Webpack with `STATIC_MODE=true`, render the CloudFormation template via `cfn-template.js`, call `CreateStack`, poll `DescribeStacks` until terminal state, upload `build-static/` contents to the stack's bucket on success, update the row to `published` (or `failed` with the rollback reason surfaced from `DescribeStackEvents`).
- New: `scripts/lib/cfn-template.js` — pure function that returns the CloudFormation template JSON for a dashboard. Inputs: `stackName`, `passwordBase64`. Outputs declared on the stack: `BucketName`, `DistributionDomainName`, `DistributionId`, `FunctionArn`. The Function source is rendered into the template as an inline string with the `EXPECTED_BASIC_AUTH` base64 constant pre-baked. Keep the template in JSON (not YAML) so it round-trips through `JSON.stringify` cleanly.
- New: `scripts/lib/aws-provision.js` — thin wrappers over the AWS SDK so the publish script stays declarative and unit-testable. Functions: `createStack(stackName, templateBody)`, `pollStackUntilTerminal(stackArn, { timeoutMs })`, `describeStack(stackArn)`, `describeStackEvents(stackArn)`, `uploadBundle(bucketName, buildDir)`, `deleteStack(stackArn)`. Modules: `@aws-sdk/client-cloudformation`, `@aws-sdk/client-s3`, `@aws-sdk/client-ecs` (the last used by `routes/dashboards.js` to spawn the publish task). No direct `@aws-sdk/client-cloudfront` use — CloudFormation owns the CloudFront and Function lifecycle.
- New: `configure/src/pages/Dashboards.js` — the admin UI. List dashboards (status from merged Postgres + `DescribeStacks` response), Publish modal (mission picker + name field), Delete confirmation, status-polling indicator.
- Edit: `configure/src/core/calls.js` — add `getDashboards`, `publishDashboard`, `deleteDashboard`, `getDashboard`.
- Edit: `configure/src/core/Configure.js` — register the Dashboards page in the route table.

**CloudFormation details to handle in `cfn-template.js` / `aws-provision.js`:**

- The S3 bucket needs `DeletionPolicy: Delete` and the stack template needs to declare it as such, so `DeleteStack` can clean up an empty bucket. Buckets with objects can't be deleted by CFN — the publish task is responsible for clearing the bucket as part of `deleteStack` if rollback is mid-publish; otherwise the dashboard's bucket only has the bundle, and CFN handles it once the publish task empties it. For the lean case (small bundle, no per-dashboard layer data), use a CloudFormation Custom Resource (a one-shot Lambda) declared in the stack template that empties the bucket on stack delete. Alternative: the admin's `DELETE` handler calls `emptyBucket` before `DeleteStack`. We choose the latter — simpler, no Lambda.
- CloudFront Functions in CloudFormation: declare via `AWS::CloudFront::Function` with the source inlined under `FunctionConfig`. CFN handles the two-step `CreateFunction`/`PublishFunction` dance internally.
- The CloudFront distribution declares `FunctionAssociations` pointing at the Function. CFN handles the ordering (Function published before distribution references it).
- Stack create can take 10+ minutes and CFN doesn't always emit `CREATE_COMPLETE` immediately after all resources are ready (final propagation buffer). `pollStackUntilTerminal` should treat any of `CREATE_COMPLETE`, `CREATE_FAILED`, `ROLLBACK_COMPLETE`, `ROLLBACK_FAILED` as terminal and exit promptly.
- Use `Capabilities: ['CAPABILITY_IAM']` on `CreateStack` if the template declares any IAM resources (none in the current shape, but the Custom Resource alternative above would need it).

**Operations:**
1. Implement the Sequelize model. `setups.synced(s)` auto-syncs new models on boot.
2. Implement the router with admin guards. The `publish` endpoint inserts the row in status `provisioning`, computes a deterministic `stack_name` from the dashboard ID (e.g., `mmgis-dashboard-<id>`), calls `ECSClient.runTask({...})` with the dashboard ID as an environment variable, returns the row immediately. The `delete` endpoint marks the row `deleting`, empties the bucket via `aws-provision.js`, calls `DeleteStack`, returns immediately — no spawned task needed because `DeleteStack` itself returns in milliseconds; CloudFormation handles the long teardown asynchronously.
3. Implement `cfn-template.js`. Validate the rendered template against `cfn-lint` in CI so syntax errors don't reach AWS.
4. Implement `publish-static.js` end-to-end. The publish task lives for the duration of the `CreateStack` → `CREATE_COMPLETE` → upload sequence (~10 min). Cross-AWS-account considerations: the spawned task runs under the admin's ECS execution role; that role is scoped per Phase 8.
5. Implement the Configure UI page. The status-polling pattern is net-new for Configure — no other page has it. Poll every 5s while any visible row is in `provisioning` or `deleting`; the response merges row state with `DescribeStacks` output.
6. Render the CloudFront Function source into the template body. Use base64-encoded `username:password` baked into a constant at template-render time so the password isn't passed in as a CloudFormation parameter (CFN parameters are stored on the stack as plaintext and surfaced by `DescribeStacks`).

**Verification:**
- Manual: publish a small mission from Configure, observe the stack reaches `CREATE_COMPLETE` and the dashboard URL appears in the list, open the URL in a browser, see the basic-auth challenge, enter the shared password, see the map render.
- Manual: delete the dashboard, observe the row transition to `deleting`, wait ~30 min, refresh the Dashboards page, observe the row reaches `deleted` once `DescribeStacks` returns "no such stack."
- Manual: introduce a deliberate template error (e.g., reference a missing resource), publish, observe the stack reaches `ROLLBACK_COMPLETE` and the row reflects `failed` with the rollback reason surfaced from `DescribeStackEvents`. Click Delete on the failed row; the rolled-back stack deletes cleanly.
- Integration test: mock the AWS SDK calls in `lib/aws-provision.js` and verify the publish endpoint inserts the row, the task is spawned with the right env vars, and a `getDashboard` response shape merges row + stack outputs correctly.

**Rollback:** `git revert` the phase. Existing stacks in AWS need manual cleanup via the AWS console (list stacks under the `mmgis-dashboard-*` prefix, delete each — CFN handles the teardown ordering).

---

## Phase 8 — ECS task definitions, IAM, GitHub Actions deploy

**Goal:** Land the AWS infrastructure that runs the admin and the publish-task. Define IAM scopes. Move CI/CD from `docker-compose` to GitHub Actions.

**Files:**
- New: `.github/workflows/deploy.yml` — GitHub Actions workflow. Triggers on push to a release branch. Steps: build the MMGIS image, push to ECR, update ECS service. Optionally builds the publish-task image as a separate ECR repo if the publish-task uses a different base.
- New: `infrastructure/ecs/admin-task.json` — admin task definition. Container, environment variables (database URL from Secrets Manager, session secret from Secrets Manager, admin URL, `MMGIS_DEPLOYMENT_MODE=lean` or omit since burn = no mode flag), log driver to CloudWatch.
- New: `infrastructure/ecs/publish-task.json` — publish-task task definition. Same image as admin (the publish script is in the same repo) but invoked with `node scripts/publish-static.js`. Different IAM role with scoped permissions.
- New: `infrastructure/iam/admin-role.json` — admin's ECS task role. Permissions: read its Secrets Manager entries, write CloudWatch logs, `ecs:RunTask` scoped to the publish task definition ARN, `cloudformation:DescribeStacks` (for the `GET /api/dashboards/*` live-state merge), `cloudformation:DeleteStack` and `s3:DeleteObject|ListBucket` on `mmgis-dashboard-*` (for the `DELETE` handler's empty-then-delete sequence).
- New: `infrastructure/iam/publish-role.json` — publish task role. Permissions: `cloudformation:CreateStack|DescribeStacks|DescribeStackEvents|DeleteStack`, plus the resource-creation permissions CloudFormation needs to provision the dashboard stack on the role's behalf: `s3:CreateBucket|PutObject|DeleteBucket|PutBucketPolicy|GetBucketLocation` on `mmgis-dashboard-*`, `cloudfront:CreateDistribution|GetDistribution|UpdateDistribution|DeleteDistribution|CreateFunction|PublishFunction|DescribeFunction|DeleteFunction|GetFunction`. Also `rds-db:connect` for the admin Postgres and `secretsmanager:GetSecretValue` for the dashboards-shared-password secret.
- New: `infrastructure/cloudfront-admin.json` — CloudFront distribution config in front of the admin ALB.
- New: `infrastructure/cloudfront-function.js` — reference source for the password-gate Function. Read by `cfn-template.js` at publish time, embedded as a string into the rendered CloudFormation template with the password constant baked in. Checked in to make the auth logic reviewable independently of the template render.

**Operations:**
1. Author the task definitions. The admin task is a long-running ECS service; the publish task is a one-off `runTask` invocation per publish.
2. Author the IAM roles. Test by simulating a publish with the AWS SDK locally against a staging AWS account.
3. Author the GitHub Actions workflow. The minimum is build-image, push-to-ECR, update-service. Add a deploy-gate (e.g., manual approval on prod) per the team's CI/CD norms.
4. Document the manual prereqs: VPC ID, subnet IDs, hosted zone ID (if D3 = B/C), ACM cert ARN, Secrets Manager entries.

**Verification:**
- Deploy to a staging AWS account. Hit the admin URL; login; configure a mission referencing a public COG URL; publish a dashboard; open the dashboard URL.
- Roll forward and back via the GitHub Actions workflow; observe ECS service updates cleanly.

**Rollback:** Tear down the staging environment by listing stacks under the `mmgis-dashboard-*` prefix and deleting each via the AWS console or `aws cloudformation delete-stack` from a workstation.

---

## Phase 9 — Hardening: DB-down boot, first-signup, superadmin

**Goal:** Address the two open concerns from the ADR that survive the move to CloudFormation — admin boot when Postgres is unreachable, and the first-superadmin / `first_signup` security gap — plus the latent WebSocket idle-timeout footgun in the existing code. The teardown-reliability concern is dropped because CloudFormation owns the resource-lifecycle dance; the live-reads pattern from Phase 7 surfaces stuck stacks in the UI without a separate reconcile job.

**Files:**
- Edit: `scripts/init-db.js` — wrap the connection-establishment loop in a bounded retry (e.g., 10 attempts × 5s = 50s), and exit non-zero with a clear log on exhaustion. The ECS task definition's restart policy then takes over; ECS will mark the task unhealthy and the service will retry, giving RDS room to recover.
- Edit: `scripts/init-db.js` — when `process.env.SEED_SUPERADMIN_USERNAME` and `SEED_SUPERADMIN_PASSWORD` are present (injected from Secrets Manager), create the user with permission `"111"` if no users exist. Idempotent — does nothing if a user with that username already exists.
- Edit: `API/Backend/Users/routes/users.js` — delete the `POST /api/users/first_signup` route entirely. The seed mechanism above replaces it.
- Edit: `API/websocket.js` — add a server-side ping/pong heartbeat on `wss`. On each tick (default 30s, configurable via `WEBSOCKET_PING_INTERVAL_MS`), iterate `wss.clients`: if a client did not pong since the previous tick, `ws.terminate()`; otherwise mark it unresponsive and call `ws.ping()`. Register a `pong` handler on each connection that clears the unresponsive mark. Clear the interval on `wss.close`. The existing code has no heartbeat, leaving the WS vulnerable to any 60s-idle intermediary (ALB default, NAT, corporate proxy, mobile carrier).
- Optional: rename the misleading `webSocketPingInterval` field in `src/essence/essence.js` (line 137) and `configure/src/core/Websocket.js` (line 12) to `webSocketReconnectInterval`. Both are reconnect timers despite the name — the rename is documentation, no functional change. No client-side ping code is needed; the browser `WebSocket` API answers server pings automatically.

**Operations:**
1. Implement the retry loop in `init-db.js`. Test with Postgres down; observe bounded retries; observe the ECS service marks the task unhealthy after the retries fail.
2. Implement the superadmin seed. Test on a fresh database.
3. Delete `first_signup`. Spot-check that the Configure SPA's signup flow doesn't reference it (it shouldn't; the public route was for the bootstrap case only).
4. Implement the server-side heartbeat. Document `WEBSOCKET_PING_INTERVAL_MS` in `sample.env`.

**Verification:**
- Bring Postgres down, restart the admin ECS task, observe the bounded retry and the clean failure mode.
- Verify `POST /api/users/first_signup` returns 404.
- Verify the superadmin user exists in Postgres after a fresh deploy.
- Open the admin, leave Configure idle for 10+ minutes behind the ALB. WS stays connected; no "Websocket disconnected" banner; Essence's `LayerUpdatedControl` does not enter the `DISCONNECTED` state. ALB CloudWatch `IdleTimeoutClosedConnectionCount` does not increment for the admin target group on the WS path.
- Local repro behind a deliberate 60s-idle reverse proxy (e.g. nginx with `proxy_read_timeout 60s`): the heartbeat keeps the connection alive across the 60s window.

**On stuck stacks.** Failed publishes (`CREATE_FAILED`, `ROLLBACK_COMPLETE`) and failed deletes (`DELETE_FAILED`) surface in the Dashboards page via the live-state pattern from Phase 7. The default escape hatch is: an admin clicks Delete on the failed row, which calls `DeleteStack`; CloudFormation either succeeds (rolled-back stacks are deletable) or returns `DELETE_FAILED`, in which case the admin opens the AWS console and resolves manually. If this becomes a recurring operational burden, follow up with a stack-events-via-SNS update path (out of scope for this plan).

**Rollback:** `git revert` the phase. The system returns to today's "hard gate on DB" and the now-deleted `first_signup`.

---

## Phase 10 — Cleanup pass

**Goal:** Catch what the burn left behind. Re-grep, prune docs, prune dead code paths discovered during the implementation.

**Operations:**
1. `git grep -E 'WITH_|ADJACENT|adjacent-server|titiler|stac|tipg|veloserver|busboy|csvtojson|sharp|Missions/'` over the whole tree. Each hit is either a) intentional (this plan, the `features.md` inventory, the preserve folder, comments) or b) cleanup. Resolve each.
2. Audit the `configure/` SPA for orphaned routes after removing STAC, Datasets-upload, Dashboards-WebHooks pages. The router will silently 404 on a navigation to a removed page; better to remove the route entries.
3. Audit `sample.env` and `.env.example` files; remove every env that no longer has a consumer.
4. Update README.md and `AGENTS.md` to reflect the post-burn deployment posture. Remove the "Docker Compose" section's references to optional sidecar profiles.
5. Update `docs/` Jekyll site references. Same edits.

**Verification:**
- `git grep -E '...'` returns zero unintended hits.
- README rebuilds; Jekyll docs build.
- `npm start` + `npm run build` + `npm test` all green on a fresh clone.

**Rollback:** N/A — cleanup is incremental.

---

## What this plan does *not* cover

- Mission-config validation tooling for lean configs (a mission with sidecar URL references should fail validation early). Suggest a separate small feature later.
- Mission-config schema migration tooling for missions authored against today's MMGIS data model (raster filesystem references, sidecar URLs).
- VEDA-microservice URL conventions and per-feature client-side adapters (these are mission-config authoring concerns, not MMGIS deployment).
- Data-residency / cross-account audit logging for dashboards published outside our AWS organization.

These are tracked outside this plan.
