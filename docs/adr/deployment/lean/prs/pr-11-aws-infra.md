This is an LLM artifact — a per-PR implementation doc derived from [`../implementation-plan-keep.md`](../implementation-plan-keep.md) Phase 8 and [`../pr-breakdown.md`](../pr-breakdown.md). Draft; verify against current code before acting.

# PR 11 — AWS infrastructure: ECS, IAM, CloudFront, GitHub Actions

**Maps to:** Phase 8. **Depends on:** PR 8 (publish task). **Blocks:** PR 10 (provides the S3 asset bucket).

**Goal:** Land the lean deployment's AWS recipes — ECS task definitions, two-roles-per-task least-privilege IAM, the admin CloudFront config, the password-gate CloudFront Function reference source, the `deploy-lean.yml` pipeline, the `trust proxy 1→2` fix, and the S3 asset bucket (plus its `PutObject` IAM) that PR 10's image upload depends on.

## In plain English

This is the actual cloud setup for the lean deployment. Up to now the other PRs taught the app *how* to behave; this one tells Amazon how to *run* it. It adds the recipe that says "run the admin app as a container," the recipe for the short-lived job that publishes a dashboard, and the narrow lists of permissions each piece is allowed to use. The permissions are deliberately tight: the publishing job can create the hosting for a new dashboard and nothing else, and the admin app can start that job but can't reach into anything it doesn't own. Every permission is pinned to specific resources whose names all start with `mmgis-dashboard-`, so a bug or a compromise can't reach the rest of the account.

It also sets up the content-delivery layer that sits in front of the admin app so that logins work. A delivery network normally strips cookies and headers to make caching fast, but the admin needs those cookies to keep you logged in. So we configure it to forward everything and cache nothing. This PR also corrects a small but important setting about how many layers of network the app sits behind, so that "remember who the real visitor is" works correctly and secure login cookies are honored.

There's an automated pipeline too: when we cut a release, it builds the app image, pushes it to Amazon's image registry, and tells the AWS-managed runtime to roll out the new version. Because we chose the AWS-managed runtime ("Express Mode"), Amazon owns the load balancer, the gradual rollout, and the scaling — we hand it a recipe and it handles the choreography, so there's far less infrastructure for us to write and babysit.

A quick word on storage, because there are **two different kinds of bucket** in this system and it's easy to mix them up. This PR creates exactly one: the **shared admin asset bucket** — a single place where every image an admin uploads lives, sitting behind the admin's own delivery network. That is the only bucket this PR makes. The *other* kind — a **per-dashboard bucket, each with its own delivery network in front of it** — is created fresh every time someone publishes a dashboard, by the publishing job (a different PR), one set per dashboard. When a dashboard is published, its images are copied out of the shared admin bucket into that dashboard's own bucket, so each published dashboard is a sealed, standalone thing with its own storage and its own web address. This PR's job is just to stand up the shared admin bucket and grant the admin the single permission it needs to put files in it (and the publishing job the permission to read from it when it makes those copies).

## Scope / files

| File | Change | Plan ref | Notes (verified against code) |
|---|---|---|---|
| `infrastructure/` *(new dir)* | New top-level directory for the VEDA AWS deployment recipes | Ph8 Note | **Confirmed new** — no `infrastructure/` exists today. Upstream/full deployment doesn't touch it. |
| `.github/workflows/deploy-lean.yml` *(new)* | Lean deploy pipeline: build image → push to ECR → trigger ECS Express Mode rollout. Reuse action versions/patterns from `docker-build.yml` | Ph8 Files | The four existing workflows are confirmed: `docker-build.yml`, `bump-version.yml`, `playwright-tests.yml`, `security-scan.yml`. Nothing moves; this lands alongside. Trigger on a release tag/branch (existing `docker-build.yml` triggers on push branches + tags + `release`). |
| `infrastructure/ecs/admin-task.json` *(new)* | Admin task definition. `environment[]` carries `MMGIS_DEPLOYMENT_MODE=lean` + `DISABLE_FIRST_SIGNUP=true`; `secrets[]` injects DB URL + `SESSION_SECRET` + `SEED_SUPERADMIN_USERNAME` + `SEED_SUPERADMIN_PASSWORD` from Secrets Manager. References admin **execution** role + admin **task** role separately | Ph8 Files | Mode is a **runtime ECS env var**, not a Dockerfile build-arg (see Discrepancies). Must run `build:themes`-baked image (theme assets). The seed creds + `DISABLE_FIRST_SIGNUP` close the seam PR 12 depends on (superadmin seed + first-signup gate); without them PR 12's hardening is inert on a fresh lean deploy. Publish task def does **not** need these. |
| `infrastructure/ecs/publish-task.json` *(new)* | Publish task definition. **Same image** as admin, entrypoint `node scripts/publish-static.js`. References its own execution role + its own (broader) task role | Ph8 Files | Spawned per publish by the admin via `RunTask` (PR 8). |
| `infrastructure/iam/admin-task-execution-role.json` *(new)* | ECS-side pull/log/secret-inject perms | Ph8 Conventions | ECR pull (`GetAuthorizationToken`, `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`), `logs:CreateLogStream`/`PutLogEvents`, `secretsmanager:GetSecretValue` on the DB-creds + session-secret secret ARNs only. |
| `infrastructure/iam/admin-task-role.json` *(new)* | Admin runtime SDK perms (scoped) | Ph8 Files | `ecs:RunTask` on the publish task-def ARN; `iam:PassRole` on **both** publish roles (PassRole gotcha — see steps); `cloudformation:DescribeStacks`/`DeleteStack` on `mmgis-dashboard-*`; `s3:DeleteObject`/`ListBucket` on `mmgis-dashboard-*`; **plus** `s3:PutObject` on the asset bucket (PR 10 dependency). |
| `infrastructure/iam/publish-task-execution-role.json` *(new)* | ECS-side pull/log/secret-inject perms for the publish task | Ph8 Conventions | Same shape as admin execution role. |
| `infrastructure/iam/publish-task-role.json` *(new)* | Publish runtime SDK perms (the broad-but-scoped one) | Ph8 Files | CFN create/describe/delete + the S3/CloudFront actions CFN acts on its behalf, all on `mmgis-dashboard-*`; **plus `s3:GetObject`/`s3:ListBucket` on the shared asset bucket** (reads source assets to copy into each dashboard bucket at publish — the PR 10 / PR 8 asset-copy step); `secretsmanager:GetSecretValue` on the dashboards-shared-password secret. **No `rds-db:connect`** (code uses password auth). |
| `infrastructure/cloudfront-admin.json` *(new)* | Admin CloudFront distribution config: default behavior → ALB with AllViewer origin request policy + CachingDisabled cache policy; **`/assets/*` behavior → shared asset bucket** (same-origin uploads); CF→ALB hop is HTTPS | Ph8 Files | Defaults forward nothing → login breaks silently. AllViewer forwards cookies/headers/query (login, sessions, WS upgrade headers). The `/assets/*` behavior makes PR 10's root-relative `/assets/…` paths resolve same-origin. |
| `infrastructure/cloudfront-function.js` *(new)* | Reference source for the dashboard password-gate Function | Ph8 Files | Checks `Authorization: Basic` against a baked password, returns `401` on mismatch. **Reference only** — PR 8's `cfn-template.js` embeds it into the per-dashboard CFN template at publish time with the password base64-baked into the Function body. |
| `infrastructure/s3-asset-bucket.json` *(new)* | Asset bucket definition (CFN snippet or provisioning doc) for admin-uploaded static mission assets | ADR Deployment Overview; PR 10 dep | One shared bucket. **This PR provisions it; PR 10 repoints upload code to it.** Served same-origin under `/assets/…` by the admin CloudFront `/assets/*` behavior (added here). Assets carry **no special auth** — they inherit the serving distribution's gate. |
| `scripts/server.js` (L510) | `app.set("trust proxy", 1)` → `2` | Ph8 Files | **Verified:** line 510 currently reads `app.set("trust proxy", 1)`. Two hops now (CloudFront→ALB→ECS). Wrong value breaks `Secure` cookies, rate-limiting, and `X-Forwarded-For`. |
| `Dockerfile` | **No edit** | Ph8 Files | **Verified single-stage** (`FROM node:20-slim`, micromamba install, `ARG WITH_STAC`). Mode flows via ECS `environment[]`. Do not add a build-arg or a second stage. |
| `infrastructure/Dockerfile.lean` *(optional)* | Trimmed lean image: skip micromamba install + `adjacent-servers/` | Ph8 Files | **Defer** until image size is a real problem. Note: the `COPY adjacent-servers/` the plan cites was **not found** in the current `Dockerfile`; only the micromamba install block is present — confirm the copy step's location before trimming. |

## Implementation steps

1. **Create `infrastructure/` and its subtree** (`ecs/`, `iam/`, plus the top-level CloudFront config + Function + asset-bucket files). This directory is lean-only; document at its root that the full/upstream deployment does not use it.

2. **Admin task definition** (`infrastructure/ecs/admin-task.json`): put `MMGIS_DEPLOYMENT_MODE=lean` and `DISABLE_FIRST_SIGNUP=true` in `environment[]`. Inject DB URL, `SESSION_SECRET`, `SEED_SUPERADMIN_USERNAME`, and `SEED_SUPERADMIN_PASSWORD` through `secrets[]` (Secrets Manager ARNs) so they never appear in the task-def plaintext. The two `SEED_SUPERADMIN_*` secrets feed PR 12's automatic superadmin seed on a fresh lean deploy, and `DISABLE_FIRST_SIGNUP=true` is the env PR 12 gates the open first-signup route on — these injections **close the seam PR 12 depends on**. Reference `admin-task-execution-role` under `executionRoleArn` and `admin-task-role` under `taskRole arn` — they are **two distinct roles** (execution = ECS infrastructure; task = container code).

3. **Publish task definition** (`infrastructure/ecs/publish-task.json`): identical image, `command` overridden to `node scripts/publish-static.js`. Its own execution role + its own (broader) task role. Both task defs must build from a `build:themes`-baked image so `dist/` CSS/fonts ship; otherwise themed missions/dashboards render unstyled.

4. **Execution roles** (`admin-`/`publish-task-execution-role.json`): ECR pull set + CloudWatch Logs stream-write + `secretsmanager:GetSecretValue` scoped to the exact secret ARNs each `secrets[]` block injects — for the admin execution role that includes the DB-creds, session-secret, and the two `SEED_SUPERADMIN_*` ARNs. No wildcards.

5. **Admin task role** (`admin-task-role.json`), least-privilege, explicit ARNs:
   - `ecs:RunTask` on `arn:aws:ecs:<region>:<account>:task-definition/<publish-family>:*`.
   - **`iam:PassRole` on both the publish execution role ARN and the publish task role ARN.** This is the classic gotcha: `RunTask` attaches those roles to the task it spawns, and ECS requires the *caller* to hold `PassRole` for each role it hands off. Missing this → `RunTask` fails with an opaque AccessDenied that does not name PassRole. Scope each `PassRole` to the exact role ARN; do not use `Resource: "*"`.
   - `cloudformation:DescribeStacks` on `arn:aws:cloudformation:<region>:<account>:stack/mmgis-dashboard-*/*` (live-state merge for the Deployments page).
   - `cloudformation:DeleteStack` on the same prefix, plus `s3:DeleteObject` on `arn:aws:s3:::mmgis-dashboard-*/*` and `s3:ListBucket` on `arn:aws:s3:::mmgis-dashboard-*` (the inline empty-then-delete handler).
   - **`s3:PutObject` on the asset bucket ARN** (`arn:aws:s3:::<asset-bucket>/*`) — this is the grant PR 10's upload repoint consumes. Provisioned here so PR 10 only changes code, not IAM.

6. **Publish task role** (`publish-task-role.json`), the broad-but-scoped one:
   - `cloudformation:CreateStack|DescribeStacks|DescribeStackEvents|DeleteStack` on `mmgis-dashboard-*`.
   - The resource-creation actions CFN performs on its behalf, all on `mmgis-dashboard-*`: `s3:CreateBucket|PutObject|DeleteBucket|PutBucketPolicy|GetBucketLocation`; `cloudfront:CreateDistribution|GetDistribution|UpdateDistribution|DeleteDistribution|CreateFunction|PublishFunction|DescribeFunction|DeleteFunction|GetFunction`.
   - **`s3:GetObject`/`s3:ListBucket` on the shared asset bucket** (`arn:aws:s3:::<asset-bucket>` and `/*`) — the publish job reads the mission's referenced assets here to copy them into the dashboard's bucket (PR 8's asset-copy step). Read-only on the shared bucket; the write side is the `mmgis-dashboard-*` `PutObject` above.
   - `secretsmanager:GetSecretValue` on the dashboards-shared-password secret ARN (read at runtime to bake into the Function source).
   - **Do not add `rds-db:connect`** — that action only applies under RDS IAM authentication, and the code in `scripts/server.js` uses password auth via `DB_USER`/`DB_PASS`. Add it only if/when the deployment switches to RDS IAM auth.

7. **Asset bucket** (`infrastructure/s3-asset-bucket.json`): one shared bucket for admin-uploaded static mission assets. Provision it here. The matching `s3:PutObject` grant lives on the admin task role (step 5). It is served same-origin via the admin CloudFront `/assets/*` behavior (step 8).

8. **Admin CloudFront** (`infrastructure/cloudfront-admin.json`): default origin is the admin ALB over HTTPS — attach the **AllViewer** origin request policy (forwards all cookies, headers, query strings — needed for login, Postgres sessions, and the WebSocket upgrade headers) and the **CachingDisabled** cache policy. Defaults forward nothing and would silently break auth. Add a second cache behavior for **`/assets/*`** whose origin is the shared asset bucket, so admin-uploaded images resolve same-origin under `/assets/…` (matching the root-relative paths PR 10 stores). Asset auth is **settled — no special auth**: these images inherit the serving distribution's gate (here, the admin distribution serves the non-sensitive uploads directly; on a published dashboard the same `/assets/…` paths sit behind that dashboard's password Function, same as the bundle), so there is no separate public-vs-authenticated decision to make.

9. **Password-gate Function reference** (`infrastructure/cloudfront-function.js`): write the viewer-request Function that compares the `Authorization: Basic` header to a baked password and returns `401` on mismatch. This is the **canonical reference**; PR 8's `cfn-template.js` inlines it into each dashboard stack with the password base64-baked into the body (not a CFN parameter — parameters surface in `DescribeStacks`).

10. **`scripts/server.js`**: change line 510 from `app.set("trust proxy", 1)` to `app.set("trust proxy", 2)` to match the CloudFront→ALB→ECS hop count.

11. **`deploy-lean.yml`**: build the MMGIS image (including `build:themes`), push to ECR, register the new admin task-def revision, and let ECS Express Mode roll it out (see D1 note below — the workflow registers the revision and triggers the managed deployment rather than hand-rolling an ALB/target-group swap). Reuse action versions and auth patterns from `docker-build.yml`. Trigger on the release convention (tag or release branch).

12. **Document prereqs** in the workflow/README: existing VPC + subnets, ACM cert, Secrets Manager entries (DB creds, session secret, dashboards-shared-password, and the superadmin seed creds `SEED_SUPERADMIN_USERNAME`/`SEED_SUPERADMIN_PASSWORD` that the admin task def injects for PR 12's seed), and the **outbound HTTPS egress** requirement — the admin fires `triggerWebhooks(...)` to external URLs on Config saves and Dashboards Publish/Update/Delete; a private-subnet task needs a NAT gateway or VPC endpoints or webhooks hang and time out silently. Document the dual-deployment posture (`full` = upstream default; `lean` = this workflow).

### D1 reconciliation — ECS Express Mode (decided 2026-06-05)

The plan text predates D1 and says "update ECS service" generically, implying the team owns the ALB, target groups, and rollout. **D1 chose ECS Express Mode**, so AWS manages the ALB, the canary/rollout strategy, and scaling. Concretely:

- **No** ALB, listener-rule, target-group, or scaling-policy definitions belong in `infrastructure/` — Express Mode owns them. The CloudFront admin config still points at the AWS-managed ALB endpoint Express Mode exposes.
- `deploy-lean.yml` **registers a new task-def revision and triggers the Express-managed deployment**; it does not script a blue/green or target-group cutover.
- Open verification carried from D1: confirm the internal-only `RunTask` for the publish flow interacts cleanly with Express Mode-managed networking (same cluster). Validate during staging deploy.

## Verification

- **Staging lean deploy** (`MMGIS_DEPLOYMENT_MODE=lean`): hit the admin URL, log in (proves AllViewer + CachingDisabled + `trust proxy 2` are correct), configure a mission referencing a public COG URL, publish a dashboard (proves `RunTask` + PassRole + publish-role CFN/S3/CloudFront scopes), open the dashboard URL and confirm the password gate `401`s without credentials and serves with them.
- **Full-mode regression** on the same image: locally `MMGIS_DEPLOYMENT_MODE=full npm start` — sidecar proxies, upload routes, Missions middleware all mount, `/api/deployments/*` 404s. Confirms the image is mode-agnostic and the env var is the only switch.
- **IAM least-privilege spot-check:** simulate each role with the IAM Policy Simulator against an out-of-prefix ARN (e.g. `arn:aws:s3:::some-other-bucket/*`) and confirm **deny**. Confirm `iam:PassRole` is present for both publish roles on the admin role (drop one and watch `RunTask` fail).
- **Asset bucket:** confirm the admin role can `PutObject` to the asset bucket and cannot to any `mmgis-dashboard-*` bucket beyond delete/list.
- **Pipeline:** `deploy-lean.yml` runs green on the release trigger; the image carries `dist/` theme assets; Express Mode reports the new revision healthy.

## Rollback

- `git revert` the PR (removes `infrastructure/`, `deploy-lean.yml`, and the one-line `server.js` change). The `trust proxy` revert is the only code change and is inert outside the CloudFront-fronted deployment.
- AWS resources: tear down the staging environment. Any dashboard stacks remain under the `mmgis-dashboard-*` prefix and are deleted via the admin Delete affordance or the AWS console. The asset bucket is removed with the environment; if it holds uploads (only after PR 10 lands), empty it first.

## Discrepancies vs plan

- **D1 (Express Mode) postdates the plan.** Phase 8 says "update ECS service" and implies team-owned ALB/target-groups/scaling. Reconciled above: Express Mode owns the ALB/rollout/scaling, so `infrastructure/` defines **no** ALB/target-group/scaling resources, and `deploy-lean.yml` registers a task-def revision + triggers the managed deployment instead of scripting a cutover.
- **Mode injection conflict resolved to runtime env var.** The plan flags that an earlier draft contradicted itself (build-arg vs env). This PR uses ECS `environment[]` only; `Dockerfile` is confirmed single-stage and gets no edit.
- **`rds-db:connect` dropped** from the publish task role — code uses password auth (`DB_USER`/`DB_PASS` in `scripts/server.js`), so the RDS-IAM-auth action does not apply.
- **`COPY adjacent-servers/` not found in `Dockerfile`.** The plan's optional `Dockerfile.lean` trim cites skipping a `COPY adjacent-servers/`; the current `Dockerfile` shows the micromamba install block but no such copy line. Re-confirm what actually pulls `adjacent-servers/` into the image before authoring any lean trim. The optional trim is deferred regardless.
