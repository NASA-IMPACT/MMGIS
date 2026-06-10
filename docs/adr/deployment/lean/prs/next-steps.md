This is an LLM artifact — the path from the current state (12 draft PRs, #129–#140, nothing on AWS) to reviewed, merged, and deployed. Written 2026-06-10.

# Lean deployment — next steps

## Where things stand

PRs 1–12 of the series are open as stacked drafts (see any PR body's "Merge order" for the graph). PR 13 (cleanup + dual-mode CI) is unwritten by design — it lands last. Nothing has touched AWS; `infrastructure/` is unapplied recipes and `deploy-lean.yml` has never run. Out-of-scope findings live in [`follow-up.md`](./follow-up.md).

## 1. Review

1. Flip drafts to "Ready for review" in dependency order — #129 first, then the rest in any order; reviewing a child before its parent works fine since each diff shows only its own work.
2. Review-fix churn propagates by **merge, never rebase**: a fix lands on its own PR's branch; children pick it up by merging the parent in (only needed when the fix functionally affects them). For #138/#140, fixes to a parent also get merged into their integration branches (`lean/pr-08-base`, `lean/pr-10-base`) to keep diffs clean.
3. The local worktrees (`MMGIS-lean-pr-NN`, each with its own port + DB) are still up for hands-on testing of any PR — flip `MMGIS_DEPLOYMENT_MODE` in the worktree `.env` and use the deployment skill's `start.sh`.

## 2. Merge

1. Merge **#129** into `feature/mmgis-deployment-skill`, deleting its branch — GitHub auto-retargets the siblings.
2. Merge the independent tier in any order: #130, #131, #132, #133, #136, #135. Known trivial conflict: #130 and #131 both touch `API/Backend/Config/setup.js`; whichever merges second resolves a few lines.
3. Merge the children as their parents land: #134 (after #131), #137 (after #136), #138 (retarget its base from `lean/pr-08-base` to the skill branch once #131 + #136 are in, then delete `lean/pr-08-base`), #139 (after #138), #140 (same retarget dance with `lean/pr-10-base` once #139 + #133 are in).
4. After everything merges: write and land **PR 13** (gate audit, CI matrix running both modes, README/AGENTS/docs updates — fold in the AGENTS.md Jest→Playwright fix), convert [`follow-up.md`](./follow-up.md) items into real issues, regenerate the stale `configure/public/toolConfigs.json`, and tear down the local worktrees (`teardown.sh`, which prompts per deployment).
5. Eventually this all rides `feature/mmgis-deployment-skill` → `development` through whatever review that merge gets.

## 3. Deploy (staging first)

Prereqs are operator setup, detailed in [`infrastructure/README.md`](../../../../infrastructure/README.md) (on the #139 branch until merged):

1. **One-time AWS setup:** ECR repository; the five Secrets Manager entries (DB creds, `SECRET` session secret, `SEED_SUPERADMIN_USERNAME`/`_PASSWORD`, dashboards shared password); managed Postgres reachable from the VPC; CloudWatch log groups; the shared asset bucket; the GitHub OIDC deploy role; admin hostname + ACM cert (operator-owned DNS); NAT/egress for outbound webhooks.
2. **Fill placeholders** (`<ACCOUNT_ID>`, `<REGION>`, ARNs, …) in `infrastructure/`, register the two task definitions, create the ECS **Express Mode** service for the admin, and put the admin CloudFront distribution in front of the endpoint it exposes.
3. **First deploy** via `deploy-lean.yml` (release trigger or `workflow_dispatch`): builds the image (with themes), pushes to ECR, registers new task-def revisions, triggers the managed rollout.
4. **Staging verification checklist** (from the PR 11 spec — this is where the deliberately-unverified items get proven):
   - Log in at the admin URL (proves AllViewer + CachingDisabled + `trust proxy 2`); confirm the seeded superadmin works and `first_signup` is gated.
   - Configure a mission against a public COG URL; upload an image (proves the asset bucket + `/assets/*` behavior + PR 10's S3 write).
   - **Publish** a dashboard end-to-end (proves `RunTask` + PassRole + the publish role's CFN/S3/CloudFront scopes, and the open D1 question of RunTask under Express Mode networking); open the URL, confirm the password gate 401s without credentials and the map renders with them, with zero `/api/*` calls.
   - **Update** the dashboard (same URL re-baked), then **Delete** it (proves the admin role's teardown set — watch for `DELETE_FAILED`; the CFN-service-role alternative in follow-up.md is the fallback).
   - IAM least-privilege spot-check with the policy simulator against out-of-prefix ARNs.
   - Publish a `modern`-mode mission and confirm panels render (the PR 8 spec's e2e check that can't run locally).
5. Fix what staging surfaces (expected suspects are listed in follow-up.md), then repeat for production with its own secrets/cert/hostname.
