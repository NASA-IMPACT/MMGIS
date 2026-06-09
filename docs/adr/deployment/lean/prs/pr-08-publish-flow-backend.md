This is an LLM artifact — a per-PR implementation doc derived from [`../pr-breakdown.md`](../pr-breakdown.md). Draft; verify against current code before acting.

# PR 8 — Publish flow: backend + Deployments Configure page

**Maps to:** Phase 7. **Depends on:** PR 3 (mode flag), PR 7 (static build). **Blocks:** PR 9, PR 11.

**Goal:** Add the admin-only Publish/Update/Delete/list flow — a new `Deployments` backend module (model in both modes, routes gated to lean), the ECS publish-task scripts that build the static bundle and provision a per-dashboard CloudFormation stack, and a Configure page to drive it all.

## In plain English

This is the headline new feature of the lean deployment. Today the admin app can build and edit a mission's configuration; this PR lets an admin take a finished mission and turn it into a standalone, public, read-only version of the map app. There are two ways in: a dedicated Deployments page (to see all published dashboards and their status), and a quick **Publish** button right on the mission's own config screen — next to "Preview Changes" / "Save" — that saves the latest edits and publishes in one click. From the Deployments page, the admin picks a mission and clicks Publish. The server kicks off a background job that builds a frozen copy of the app with that one mission baked in, then stands up its own tiny piece of cloud hosting for it — a storage bucket plus a content-delivery network with a shared password at the edge — and hands back a web address. Any images the mission uploaded are copied into that bucket too, so the dashboard is fully self-contained. Anyone with the address and password can open that dashboard; it talks to no server of its own.

Two more buttons round it out. Update rebuilds the frozen copy in place against the mission's latest configuration and replaces the files in the same bucket, so the address never changes. Delete tears the whole hosting setup back down. The app keeps a small registry — one row per published dashboard — recording its name, which mission it came from, who made it, and the handle to its cloud stack. Whenever the admin views the list, the app asks the cloud provider for each dashboard's current status live, so the page reflects reality rather than a stale cached value.

There is a naming clash to be careful about. Some recently merged "modern interface" code already uses the word "Dashboard" internally for an unrelated thing — the panel layout of the map UI. This PR's "dashboard" means a published, hosted copy of the app. The two are completely different concepts that happen to share a word. To keep them from getting tangled, the new publish feature is named "Deployments" and the modern-ui `Dashboard*` symbols are left untouched. Separately: the published copies must be able to boot the modern interface, so we add a check that a modern-mode mission actually renders its panels once published.

One more thing worth stating plainly: the outbound notification feature ("webhooks") stays fully on in the lean deployment. Every publish, update, and delete fires a notification, which is exactly the kind of event outside systems (CI/CD, monitoring, audit logs) want to hear about.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `API/Backend/Deployments/setup.js` *(new)* | Module lifecycle. `onceSynced(s)` runs in both modes (model sync). `onceInit(s)` mounts the router **only when `isLean()`**. | Auto-discovered by `API/setups.js` (reads each dir under `API/Backend/`, requires its `setup.js`, calls `onceInit(s)`/`onceSynced(s)` at L173/L183). New dir ⇒ new `setup.js` is all that's needed to register. Mirror `Webhooks/setup.js` shape. |
| `API/Backend/Deployments/models/deployment.js` *(new)* | Sequelize model `deployments`: `id`, `name`, `mission`, `created_by`, `status`, `stack_arn`, `stack_name`, `cloudfront_url` (cached), `settings` (JSON), `last_error`, timestamps. | Define via `sequelize.define("deployments", {...}, { timestamps: true })` and `require("../../../connection").sequelize`, matching `Webhooks/models/webhooks.js`. Live status comes from `DescribeStacks` at read time, not the row. |
| `API/Backend/Deployments/routes/deployments.js` *(new)* | Router: `POST /api/deployments/publish`, `POST /:id/update`, `DELETE /:id`, `GET /api/deployments`, `GET /:id`. All admin-only. Fire `triggerWebhooks` on publish/update/delete after the terminal row update. | See steps. Webhooks **kept** in lean (not gated). |
| `scripts/publish-static.js` *(new)* | ECS publish-task entrypoint: read mission config → bake → `build:themes` + Webpack (`STATIC_MODE=true`) → `CreateStack` → poll `DescribeStacks` → **same-key copy the mission's assets from the shared admin bucket into the dashboard bucket under the same `/assets/<mission>/…` keys** → upload bundle → mark row `published`. | Same image as admin, invoked with `node scripts/publish-static.js` (PR 11 task def). Depends on PR 7's static build + `bakeStaticConfig`. No URL rewriting — stored references are root-relative `/assets/…` and resolve same-origin against the dashboard's CloudFront (PR 10's storage model). Needs `s3:GetObject` on the shared bucket (IAM in PR 11). |
| `scripts/lib/cfn-template.js` *(new)* | Render the CloudFormation template body: S3 bucket + CloudFront distribution + CloudFront Function. Bake the shared password into the Function source as a base64 constant. | Password is **not** a CFN parameter (would surface in `DescribeStacks`). |
| `scripts/lib/aws-provision.js` *(new)* | AWS SDK wrappers: `CreateStack` + `DescribeStacks` poll-to-terminal, bundle PutObject upload, `DeleteStack`, empty-bucket helper. | `DeleteStack` is called **inline from the DELETE handler** — no separate teardown script. |
| `configure/src/pages/Deployments/Deployments.js` *(new)* | Admin page: list dashboards w/ live status, Publish (mission picker + name), Update, Delete. | SPA convention is `pages/<Name>/<Name>.js` (see existing `pages/STAC/STAC.js`, `pages/WebHooks/WebHooks.js`). Nav label "Deployments" — see collision note. |
| `configure/src/components/Main/Main.js` | Register the page in the `switch (page)` dispatch (~L219, alongside the `webhooks`/`stac` cases) and import the component (~L42–49 import block). | `Main.js` is the page-switch dispatcher; `core/Configure.js` is layout, not the route table. |
| `configure/src/components/Panel/Panel.js` | Add a nav button that `dispatch(setPage({ page: "deployments" }))`, **gated to hide in full mode**. | Reuse the exact `WITH_STAC` conditional pattern (Panel.js L343: `window.mmgisglobal.WITH_STAC === "true" ? (...)`). Gate on the PR 3 mode flag instead (e.g. `window.mmgisglobal.DEPLOYMENT_MODE === "lean"`). |
| `configure/src/core/calls.js` | Add call defs: `getDeployments`, `getDeployment`, `publishDeployment`, `updateDeployment`, `deleteDeployment`. | Entries are `{ type, url }` objects keyed by name (see existing `get`/`add`/`upsert`). |
| `configure/src/components/SaveBar/SaveBar.js` | Add a **Publish** button next to "Preview Changes"/"Save" that runs *save → publish*, **gated to lean only**. | The save bar already has `Preview Changes` (opens the preview modal) and `Save` (`dispatch(saveConfiguration({cb}))`) at L77–88. Publish reuses `saveConfiguration`, then on success calls `publishDeployment` (or `updateDeployment` if this mission already has a dashboard — lean is 1:1). Gate the button on `window.mmgisglobal.DEPLOYMENT_MODE === "lean"`; disable on `lockConfig`/`validationErrors` like Save. |

## Implementation steps

1. **Model.** Create `models/deployment.js` per the column list above. In `setup.js`, `onceSynced` ensures the table syncs in both `full` and `lean` (Sequelize sync on boot via the `setups.js` `onceSynced` pass at L183) so a later mode flip needs no migration. Keep the model passive in full mode — the table exists but nothing writes to it because the routes aren't mounted.

2. **Router + lean gate.** In `setup.js` `onceInit`, mount the router **only when `isLean()`** (helper from PR 1):
   ```js
   if (isLean()) {
     s.app.use(s.ROOT_PATH + "/api/deployments", s.ensureAdmin(), s.checkHeadersCodeInjection, router);
   }
   ```
   `s.ensureAdmin` is the admin guard defined in `scripts/server.js` (L298) and exposed on the `s` object passed to every module (L501). Match `Config/setup.js` / `Webhooks/setup.js`, which mount admin routers the same way. In full mode the routes are simply never registered ⇒ `/api/deployments/*` returns 404.

3. **Publish handler** (`POST /api/deployments/publish`, body `{ mission, name }`): insert a `provisioning` row, spawn the ECS publish task (`ecs:RunTask` on the publish task def — IAM in PR 11), return `{ deployment_id, status }` immediately. The publish task (`publish-static.js`) does the long-running work: bake config → `build:themes` + Webpack static build → `CreateStack` → poll `DescribeStacks` to `CREATE_COMPLETE` → **same-key copy the mission's assets (images/icons) from the shared admin asset bucket into the new dashboard bucket under the same `/assets/<mission>/…` keys** (no URL rewriting — the baked config's references are root-relative `/assets/…` and resolve same-origin, surviving a later custom-domain swap; see PR 10's storage model) → upload bundle → update row to `published` with `stack_arn`, `stack_name`, cached `cloudfront_url`. Copied assets live in the dashboard's own bucket, so they inherit its CloudFront password gate as ordinary bundle content — no separate asset auth. On failure, write `last_error` and a failed status.

   **Viewer-panel mosaic file (conditional).** If the mission uses the Photosphere or ModelViewer panes, the bundle fetches a hardcoded same-origin path `Missions/<mission>/Data/mosaic_parameters.csv` (`Viewer_.js:186–187`, *not* dispatcher-routed — see PR 7). For that pane to work in the dashboard, the file must be served at that exact key. When it lives in the shared admin asset bucket, same-key copy it into the dashboard bucket under `Missions/<mission>/Data/mosaic_parameters.csv` (no URL rewrite — relative path resolves same-origin). **Caveat:** in lean the admin has no `Missions/` disk (PR 5 gates it out), so the *source of truth* for this file is the same open question as all other large mission data — either it's an uploaded asset in the admin bucket (copy it) or the mission owner hosts mission data externally (their responsibility, per [`feature-gaps.md`](../feature-gaps.md)). Skip entirely when the mission uses neither pane; absent the file, both panes fail silently rather than erroring.

4. **Update handler** (`POST /:id/update`): same ECS task shape as publish minus `CreateStack`/polling — re-bake from the current mission config, same-key re-copy the mission's assets into the existing dashboard bucket, and PutObject the new bundle to that bucket. The distribution is **not** replaced; same id, same stack, same URL. Bump `updated_at`.

5. **Delete handler** (`DELETE /:id`): mark the row `deleting`, then **inline** (no spawned task) empty the bucket and call `DeleteStack` via `aws-provision.js`, and return immediately. CFN handles the multi-step teardown async; the row flips to `deleted` on the next read once `DescribeStacks` 404s.

6. **List/get handlers** (`GET /api/deployments`, `GET /:id`): read the Postgres rows for identity (id, name, mission, owner, stack ARN) and merge each with a live `DescribeStacks` call for current status. No reconcile job.

   **Stuck stacks (operational model).** Failed provisions (`CREATE_FAILED` / `ROLLBACK_COMPLETE`) and failed teardowns (`DELETE_FAILED`) surface through this same live status — there is no separate detection or reconcile job. The escape hatch is the **Delete** affordance, which re-issues `DeleteStack` (idempotent; retries a stuck teardown). A stack-events-via-SNS feed for richer failure detail is a possible future follow-up, explicitly out of scope here.

7. **Webhooks (kept in lean).** From the publish, update, and delete handlers, after the terminal row update, call `triggerWebhooks(eventType, payload)`. Import exactly as the existing call sites do:
   - `Config/setup.js` L2/L59: `const triggerWebhooks = require("../Webhooks/processes/triggerwebhooks.js");` then `triggerWebhooks("getConfiguration", {});`
   - `Draw/routes/draw.js` L23/L99: `require("../../Webhooks/processes/triggerwebhooks")` then `triggerWebhooks("drawFileChange", {...})`.
   From `Deployments/routes/deployments.js` the relative path is `require("../../Webhooks/processes/triggerwebhooks")`. Use distinct event types, e.g. `deploymentPublish` / `deploymentUpdate` / `deploymentDelete`, with a payload carrying the deployment id, dashboard name, mission, and `cloudfront_url`.

8. **CFN template + provisioning.** Implement `cfn-template.js` (bucket + distribution + viewer-request Function; password baked as a base64 constant in the Function source, never a CFN parameter) and `aws-provision.js` (`CreateStack`, `DescribeStacks` poll, bundle upload, empty-bucket, `DeleteStack`). Stack name encodes the dashboard id for idempotency (`mmgis-dashboard-<id>`).

9. **Configure page.** Add `pages/Deployments/Deployments.js`, import + register the `deployments` case in `Main.js`, add the nav button in `Panel.js` gated on the PR 3 mode flag, and add the five `calls.js` entries. The mode flag arrives through the same Pug→global path every other flag uses: `Config/setup.js` `res.render` (L19–42) → `#{...}` interpolation in `configure/public/index.html` → `window.mmgisglobal.*`, read directly in `Panel.js` (no Redux slice). PR 3 adds `DEPLOYMENT_MODE` to that render block; this PR only consumes it.

10. **Save-bar Publish button (UX).** In `configure/src/components/SaveBar/SaveBar.js`, add a **Publish** button alongside the existing `Preview Changes`/`Save` (L77–88), gated on `window.mmgisglobal.DEPLOYMENT_MODE === "lean"` and disabled on `lockConfig`/validation errors (same as Save). On click: run `saveConfiguration({ cb })`; on save success, call `publishDeployment` for `state.core.mission` — or `updateDeployment` if a dashboard already exists for that mission (lean is 1:1, a mission *is* a dashboard). Publishing is a background job, so surface a snackbar ("Publishing… — see Deployments") and let the Deployments page show live status; don't block the save bar on completion.

10. **Naming collision (resolved).** The merged modern-ui work uses "Dashboard" internally for panel-layout config — verified present: `src/essence/Validators/DashboardConfigValidator.js`, `src/essence/Basics/PanelManager_/DashboardConfigFactory.js`, `src/essence/types/dashboard.ts`. That is unrelated to this PR's publish concept. **Resolution:** the publish feature is named "Deployments" — backend module, table, routes, and Configure page all — and the modern-ui `Dashboard*` symbols are left untouched (zero churn in freshly merged code). "dashboard" survives only in prose, where it means the published artifact a deployment produces.

11. **Modern-interface boot check.** A baked mission with `msv.mode: "modern"` boots through `src/essence/modern.js` / `PanelManager_` (both verified present), not the classic interface. The static publish bundle (PR 7) must support that path. Add an e2e check: publish a `modern`-mode mission and confirm the dashboard renders panels.

## Verification

- `MMGIS_DEPLOYMENT_MODE=lean`, admin deploy: the Deployments nav button appears; Publish runs end-to-end (stack reaches `CREATE_COMPLETE`, bundle uploads, row reaches `published` with a `cloudfront_url`); the returned URL loads the frozen single-mission app with no `/api/*` calls; Update republishes to the same URL; Delete returns immediately and the row reaches `deleted` once `DescribeStacks` 404s.
- `MMGIS_DEPLOYMENT_MODE=full`: the Deployments nav button is not visible, `/api/deployments/*` returns 404, but the `deployments` table still exists in Postgres (so a later mode flip needs no migration).
- Publish, update, and delete each fire a webhook (confirm against a configured test endpoint or `NODE_ENV=development` `/api/testwebhooks`).
- E2e: a published `modern`-mode mission renders its panels.

## Rollback

`git revert` the PR. Default-`full` deployments are unaffected (routes never mounted; the empty `deployments` table is benign, no FK pressure — leave or drop manually). Any stacks already created need manual cleanup via the AWS console: list and delete stacks under the `mmgis-dashboard-*` prefix.

## Discrepancies vs plan

- **"Dashboards" naming collision (resolved):** the modern-ui `Dashboard*` symbols stay as-is and this feature is named "Deployments" across module, table, routes, and Configure page, so there is no symbol clash.
- The plan references `configure/src/components/Panel/Panel.js` for the nav gate and `Main.js` for page dispatch — both confirmed; the conditional-tab pattern to copy is the `WITH_STAC` check at `Panel.js` L343, reading `window.mmgisglobal` directly (no Redux). `core/Configure.js` is layout, not a route table.
- The mode flag (`DEPLOYMENT_MODE`) is **not yet** present in `configure/public/index.html` / the `Config/setup.js` render block — it is introduced by PR 3. This PR depends on that and only reads the flag; if PR 3 has not landed, the nav gate has nothing to read.
