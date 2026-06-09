This is an LLM artifact — a per-PR implementation doc derived from [`../implementation-plan-keep.md`](../implementation-plan-keep.md) Phase 10 and [`../pr-breakdown.md`](../pr-breakdown.md). Draft; verify against current code before acting.

# PR 13 — Cleanup pass + dual-mode CI

**Maps to:** Phase 10. **Depends on:** all prior PRs. **Blocks:** none (final).

**Goal:** Sweep the codebase so every deployment-mode check goes through the shared helper, make CI run the test suite in both `full` and `lean` modes, and update the project docs so contributors understand the two-mode posture and how to change gated code without breaking either shape.

## In plain English

The previous PRs added a bunch of on/off switches so MMGIS can run as either the full app or the stripped-down lean deployment from a single codebase. This PR is the wrap-up. It walks back through everything that was added and double-checks the switches were all wired the same consistent way, instead of some code peeking at the raw setting directly and some going through the shared helper. Consistency here is what keeps the two modes from drifting apart over time.

It also teaches the automated tests to run the app both ways. Today the test suite only exercises one shape; after this PR, the same tests run once as the full app and once as the lean app, so a future change that quietly breaks one of the two modes gets caught automatically before it merges.

Finally, it updates the written docs. Right now nothing in the README, the agent-context file, or the public documentation site mentions that there are two deployment modes. This PR adds that, including a short rule for contributors: when you change something that one of the modes turns off, write and test it in full mode first, then confirm you didn't break lean mode. That rule is what lets the upstream NASA-AMMOS team keep contributing without having to think about the lean deployment.

## Scope / files

| File | Change | Plan ref | Notes (verified against code) |
|---|---|---|---|
| (audit only — no edits expected) | `git grep -E 'isLean\|isFull\|MMGIS_DEPLOYMENT_MODE'`; fix any consumer that reads `process.env.MMGIS_DEPLOYMENT_MODE` directly to go through the helper instead | Ph10 Op 1 | Today the only `isLean/isFull` hits are unrelated OpenSeadragon `isFullScreen` code (`src/external/OpenSeadragon/openseadragon.js`) — exclude `src/external/` and `node_modules/` from the audit grep. The helper and all gates land in PRs 1–12; this PR verifies, it should not introduce new gates. |
| `.github/workflows/playwright-tests.yml` | Add a job matrix over `MMGIS_DEPLOYMENT_MODE: [full, lean]`; write the value into `.env` in the existing "Setup test environment" step; keep the existing unit + e2e steps | Ph10 Op 2 | **Plan says "`npm test`"; the actual test command is `playwright test`** (`package.json` `"test": "playwright test"`; no Jest, no `jest.config.js`). The existing workflow runs `npx playwright test tests/unit --project=chromium` then `tests/e2e`. The matrix wraps this one job; each leg spins up its own Postgres service (already defined). |
| `README.md` | Add a "Deployment modes" section: `full` (default, upstream path) vs `lean` (VEDA AWS), the `MMGIS_DEPLOYMENT_MODE` env var, and a pointer to the ADR / lean docs | Ph10 Op 3 | File exists at repo root. |
| `AGENTS.md` | Add a short dual-mode note near the top (Architecture or a new section): the mode gate, the `isLean()`/`isFull()` helper, and the "author in full first" contributor rule | Ph10 Op 3, Op 5 | File exists at repo root; `CLAUDE.md` already `@AGENTS.md`-includes it, so the note reaches Claude Code too. |
| `docs/pages/Setup/ENVs/ENVs.md` | Document `MMGIS_DEPLOYMENT_MODE`, `STATIC_MODE`, `STATIC_MISSION_NAME` (Phase 1) and the Phase 9 vars that landed (`DISABLE_FIRST_SIGNUP`, `SEED_SUPERADMIN_USERNAME`/`_PASSWORD`, `WEBSOCKET_PING_INTERVAL_MS`) as `#### \`VAR=\`` blocks matching the file's existing format | Ph10 Op 4 | Jekyll page, permalink `/setup/envs`; this is the page CLAUDE.md/AGENTS.md link to as "Environment Variables Documentation." Cross-check the final list against `sample.env` so docs and sample stay in sync. |
| `docs/pages/Setup/Setup.md` (or a new sibling page under `docs/pages/Setup/`) | Add a "Deployment shapes" subsection describing the full vs lean topologies (full = monolith + sidecars; lean = admin behind CloudFront + published static dashboards) | Ph10 Op 4 | Jekyll `layout: page`, `parent: Setup`. If adding a new page, give it a `permalink`, `parent: Setup`, and `nav_order` per the existing front-matter convention. |
| `docs/adr/deployment/lean/` (link only) | From README/AGENTS, link to the lean ADR and this PR set rather than duplicating the detail | Ph10 Op 3 | The ADR and plans already live here; keep the top-level docs short and point inward. |

## Implementation steps

1. **Audit the gate reads.** Run `git grep -nE 'isLean|isFull|MMGIS_DEPLOYMENT_MODE' -- ':!src/external' ':!node_modules' ':!docs/adr'`. Confirm every backend hit imports the helper (the PR 1 module) and every direct `process.env.MMGIS_DEPLOYMENT_MODE` read outside the helper itself is replaced with `isLean()`/`isFull()`. Confirm Configure/frontend consumers read the plumbed `DEPLOYMENT_MODE` flag (PR 3) or `mmgisglobal.SERVER` (PR 7), not `process.env`. This step should turn up little to nothing if PRs 1–12 followed the plan; treat any direct read as a defect to fix here.
2. **Add the CI matrix.** In `playwright-tests.yml`, add `strategy.matrix.mode: [full, lean]` to the `test` job, append `echo "MMGIS_DEPLOYMENT_MODE=${{ matrix.mode }}" >> .env` to the "Setup test environment" step, and surface the mode in the job name / report artifact names so the two legs are distinguishable. Leave the unit and e2e steps as they are (`npx playwright test tests/unit`/`tests/e2e --project=chromium`).
3. **Make the lean leg honest.** The lean leg needs the lean preconditions the suite assumes (e.g. sidecar env vars off, no `mmgis-stac` DB). Verify `node scripts/init-db.js` and the e2e boot succeed with `MMGIS_DEPLOYMENT_MODE=lean` in CI; if a test hard-codes a full-only route (sidecar proxy, `/api/datasets`, `/Missions/...`, `/api/draw`), make it mode-aware or skip it in lean rather than letting it fail. Document any such skips inline.
4. **Update README.md** with the deployment-modes section and the env-var pointer.
5. **Update AGENTS.md** with the dual-mode note and the upstream-contribution rule.
6. **Update the Jekyll docs** — the new env vars in `ENVs.md` and the deployment-shapes subsection under `Setup`. Reconcile the env list against `sample.env`.
7. **Add the upstream-contribution note** (Op 5): a short paragraph — in README or AGENTS, or both — stating that a change touching a gated surface is authored and tested in `full` mode first, then verified not to break `lean` mode, with the both-modes CI matrix as the backstop.

## Verification

Acceptance is the plan's **Cross-mode invariants** (`implementation-plan-keep.md`):

- **Default is `full`.** A fresh clone + `npm start` with `MMGIS_DEPLOYMENT_MODE` unset behaves exactly as upstream.
- **No silent breakage on unknown mode.** An unrecognized value throws at startup (helper behavior from PR 1; re-confirm it still holds end-to-end).
- **`isLean()` is additive, never `if (!isFull())`.** Spot-check the audit results: lean-only code gated on `if (isLean())`, full-only on `if (isFull())`.
- **CI runs both modes** and a PR that breaks `full` (or `lean`) fails CI.

Concrete checks:

- The audit grep shows zero direct `process.env.MMGIS_DEPLOYMENT_MODE` reads outside the helper module.
- `playwright-tests.yml` runs two legs (`full`, `lean`); both go green on a no-op PR.
- README, AGENTS, and the Jekyll pages render; `ENVs.md` lists the new vars; the env list matches `sample.env`.

## Rollback

Revert the workflow edit and the doc edits. The audit step makes no functional change of its own (any fixes it surfaces are tiny, isolated, and individually revertible). Reverting the CI matrix leaves the single-mode workflow that exists today; reverting the docs leaves the prior text. No runtime impact in either mode.

## Discrepancies vs plan

- **The plan's "`npm test`" is wrong for this repo.** `npm test` runs `playwright test`, not Jest — there is no `jest.config.js`, and the AGENTS.md "Jest 29" stack note does not match the actual test tooling. The both-modes matrix must wrap the existing Playwright workflow (`.github/workflows/playwright-tests.yml`), parameterizing the `MMGIS_DEPLOYMENT_MODE` line in its `.env` setup step — not a hypothetical Jest config.
- **The audit grep needs exclusions.** Bare `git grep isLean|isFull` is dominated by unrelated OpenSeadragon `isFullScreen` matches in `src/external/`; scope the audit to first-party code or the result is noise.
- **Out of scope (per the plan's "What this plan does *not* cover"), explicitly not addressed by this PR:** a `full`→`lean` data/`Missions/` migration path; mission-config validation that flags sidecar URLs in `lean`; cross-account audit logging for externally-published dashboards; and a removal date for the `full`-mode gates. These are tracked outside this plan.
