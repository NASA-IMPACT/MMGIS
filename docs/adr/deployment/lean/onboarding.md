This is an LLM artifact — a new-developer orientation for the lean deployment effort. Last updated 2026-06-10.

# Lean deployment — start here

MMGIS is gaining a second deployment shape from one codebase: `full` (the upstream NASA-AMMOS app, unchanged, the default) and `lean` (an AWS-hosted admin that publishes static, backend-less, password-gated dashboards). One env var — `MMGIS_DEPLOYMENT_MODE` — decides which shape a server runs; one build flag (`SERVER=static`) decides whether the frontend bundle expects a backend at all.

## Reading order

1. **[`/vision.md`](../../../../vision.md)** — why any of this exists (plugin-based spatial tool builder; the statically-deployable app is a vision commitment).
2. **[`adr.md`](./adr.md)** — the contract: admin-stack + many-dashboards architecture, the 12 settled constraints, the publish flow, decisions D1 (ECS Express Mode) and D2 (keep code, env-gate it — lean is a *mode*, not a fork).
3. **[`prs/00-overview.md`](./prs/00-overview.md)** — the 13-PR implementation map and dependency graph. Then dip into the per-PR docs (`prs/pr-NN-*.md`) for whatever area you're touching; each is code-verified with file:line anchors.
4. **[`api.md`](./api.md)** — how every named frontend API call behaves in a static dashboard (Bake / Reroute / Compute / Drop), and [`shared/features.md`](../shared/features.md) + [`feature-gaps.md`](./feature-gaps.md) for per-feature dispositions.
5. **[`prs/follow-up.md`](./prs/follow-up.md)** — the honest ledger: out-of-scope findings, plugin-overhaul debt, non-coder UX gaps, and what staging taught us.
6. **[`prs/next-steps.md`](./prs/next-steps.md)** — review → merge → deploy path, and [`prs/deployments-registry-redesign.md`](./prs/deployments-registry-redesign.md) for the planned Deployments-page rework.

## The PRs (all draft, stacked)

PRs 1–12 are open as #129–#140 on `NASA-IMPACT/MMGIS`; PR 13 (gate audit + dual-mode CI + docs) is written last. Every PR body carries the same merge-order graph — read any one of them. The stack roots at `feature/mmgis-deployment-skill`; #129 (foundation) merges first; the gate PRs are siblings; #138/#140 sit on integration branches (`lean/pr-08-base`, `lean/pr-10-base`) that merge their two parents so each diff shows only its own work.

| Area | PRs |
|---|---|
| Mode switch foundation | #129 |
| Backend gates (sidecars, datasets, draw, missions/utils) | #130, #131, #132, #133 |
| Configure polish | #134 |
| Static frontend (dispatcher, ServiceUrls, short-circuits) | #136, #137 |
| Publish flow + Configure Deployments page | #138 |
| AWS recipes + deploy pipeline | #139 |
| S3 asset uploads | #140 |
| Hardening (boot retry, seed, signup gate, WS heartbeat) | #135 |

**Working agreement:** fixes land on the owning PR branch first, then propagate *down* the stack by merge (never rebase — branches are public and reviewed). The local-only `lean/integration-check` branch (worktree `MMGIS-lean-integration`) merges all heads and is what staging images build from.

## Key code touchpoints

- `API/Backend/Utils/deploymentMode.js` — the one true mode read (`isLean()`/`isFull()`); gates live inside each module's `setup.js` (modules are auto-discovered by `API/setups.js`).
- `src/pre/calls.js` + `src/pre/staticHandlers.js` — the static dispatcher (all 40 named calls; parity is test-enforced). Beware **direct-`$.ajax` bypasses** that skip it — several staging bugs lived there (see follow-up.md).
- `src/essence/Basics/ServiceUrls/ServiceUrls.js` — external service URL resolution; static mode never falls back to same-origin.
- `API/Backend/Deployments/` + `scripts/publish-static.js` + `scripts/lib/{cfn-template,aws-provision}.js` — the publish flow (registry, ECS task, per-dashboard CloudFormation stack).
- `infrastructure/` + `.github/workflows/deploy-lean.yml` — AWS recipes (ECS Express Mode, least-privilege IAM, CloudFront VPC origin) with an operator README and placeholder table.

## Running it

- **Local:** the `mmgis-deployment` skill (`.claude/skills/mmgis-deployment/`) provisions per-worktree deployments (own port + Postgres DB). Flip `MMGIS_DEPLOYMENT_MODE=lean` in a worktree's `.env` to exercise the gates. Unit tests: `npx playwright test tests/unit/` (the runner is Playwright — ignore stale "Jest" references).
- **Staging:** a live lean admin + published dashboard run in the team's AWS account; URLs, resource names, and credentials live in the team's deployment plan file and Secrets Manager (ask the deploy owner — deliberately not committed here). Five-plus real bugs were found and fixed through it; the ledger and lessons are in follow-up.md.
