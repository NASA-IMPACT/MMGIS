---
name: orchestrating-issues
description: Use when the user hands off one or more GitHub issues for you to take from intake to a draft PR — especially when they ask you to pull latest, spin up a worktree per issue, run sub-agents in parallel to implement and review, commit and push, and report back when branches are ready for a live smoke test.
---

# Orchestrating Issues to Draft PRs

## Overview

Run one or more GitHub issues end-to-end — intake to draft PR — as a **thin orchestrator**: sequence the phases, hold the human gates, and delegate the actual work to the skills named in the phase table below.

**Core principle: one issue = one worktree = one branch = one booted deployment = one draft PR.** Issues never share state. Run independent issues in parallel; when one depends on another, sequence them. You are the conductor — sub-agents do the implementing and reviewing inside their own worktrees.

## Human gates (do not blow past these)

The whole point is that the user stays in the loop at three moments. Stop and wait for them:

1. **After intake** — present your plan back: per-issue scope against each issue's acceptance criteria, the dependency/parallelism graph, and any file/migration overlap between issues. Surface clarifying questions. *Wait* for approval before touching code.
2. **At smoke test** — report each branch as ready and *wait* while you and the user go back and forth on the live deployment until it actually works.
3. **At PR review** — open *draft* PRs, then read the user's GitHub comments and address them in a loop until they're satisfied. Re-verify each change in proportion to its size — a logic change re-runs tests + smoke (Verify 6, Smoke 7); a comment/doc tweak gets a lighter check.

Everything between gates runs autonomously.

## Phases

| Phase | What you do | Delegate to |
|-------|-------------|-------------|
| 1. Intake | Read each issue — **body and all comments** (`gh issue view <n> --comments`). Distill scope against each issue's acceptance criteria; map dependencies (seed from the issues' own parent/sequence links); spot file/migration overlap between issues; list genuine clarifying questions. **Gate: present the plan, wait for approval.** | — |
| 2. Sync | Pull the latest default branch (usually `development`) so worktrees branch from current code. | — |
| 3. Provision | Create each issue's branch **linked to the issue**, then a worktree + local deployment on it (see *Branch creation* below). | **mmgis-deployment** (`create.sh`, `start.sh`) |
| 4. Implement | Dispatch one sub-agent per worktree, scoped to that directory, to do the work — committing and pushing as it goes. Tell it the issue's collapsed plan is a stale sketch to re-investigate, but to heed any marked gotcha. Run independent issues in parallel; sequence dependent ones (downstream branches off the upstream branch, not bare `development`). | **superpowers-extended-cc:dispatching-parallel-agents** |
| 5. Review | After each implementation, have a **fresh agent that didn't write the code** review it; the implementer addresses findings, then the reviewer re-checks the changed lines. | **superpowers-extended-cc:requesting-code-review** (or the `code-reviewer` agent) |
| 6. Verify | Run that branch's tests **and check the issue's acceptance criteria** (coverage is partial — acceptance is the real bar). Never report "tested" without seeing the output. | **mmgis-deployment** (`test.sh`), **superpowers-extended-cc:verification-before-completion** |
| 7. Smoke handoff | Boot each deployment, capture the dashboard URL/port, and report (see contract below). Make sure the branch is pushed first. **Gate: iterate with the user until it works live.** | **mmgis-deployment** (`start.sh`) |
| 8. Draft PR | Open a **draft** PR per issue; body must close the issue (`Closes #N`). | **superpowers-extended-cc:finishing-a-development-branch** |
| 9. Address feedback | Read the user's PR comments from GitHub and resolve them. Each substantive change loops back through **Verify (6) and Smoke (7)** before it counts as resolved. Repeat until the user is satisfied. | **superpowers-extended-cc:receiving-code-review** |

## Branch creation (link the branch to its issue)

Make each branch with **`gh issue develop`** so it's natively tied to the issue (the
only way — you can't link a branch after the fact), then hand it to `create.sh`:

```bash
gh issue develop <issue#> --name <branch>     # add --base <upstream-branch> for a dependent/stacked issue
git fetch origin <branch>:<branch>            # local ref so create.sh reuses it (plain `fetch origin <branch>` won't)
.../mmgis-deployment/scripts/create.sh <name> --branch <branch>
```

This covers the pre-PR and stacked window that `Closes #N` (Phase 8) can't.

## The smoke-test report contract

At the Phase 7 gate, report per issue — only claim what you've verified:

- **Issue / branch / worktree** — `#N`, branch name, worktree path.
- **Tested** — which suites ran and that they passed (cite the result, don't assert it).
- **Acceptance** — each criterion from the issue's top layer, met or not.
- **Reviewed** — review done and findings addressed.
- **Committed & pushed** — branch is on the remote.
- **Live** — the booted dashboard URL/port the user opens to smoke-test.

Then hand control back: the user drives the live test, you fix what they find, and you only open draft PRs once the smoke test passes.

## Parallelism and ordering

Work out the dependency graph at intake. **Independent issues** run concurrently — provision and dispatch them at once, one sub-agent per worktree, each blind to the others. **Dependent issues** run in sequence — the downstream worktree branches off the upstream branch so it builds on that work, and its sub-agent starts only once the upstream is committed.

A stacked downstream's base keeps moving — the upstream branch changes through review, smoke fixes, and PR feedback. Each time it does, **rebase the downstream worktree onto the updated upstream and re-run Verify**, so the base never drifts. The downstream draft PR targets the **upstream branch** (a stacked PR); retarget it to the default branch once the upstream merges — only then does its `Closes #N` fire.

Isolation holds regardless of ordering: the orchestrator (you) owns the deployment lifecycle and the gates; sub-agents own implementation and review inside their assigned directory. Don't let one agent reach into another's worktree.

## When to stop and ask

You run autonomously between gates, but stop and surface these rather than pushing through:

- **An issue is bigger than one PR.** Even right-sized issues sometimes sprawl once you're in the code. Propose a split (per the issue right-sizing convention) instead of ballooning the PR.
- **Tests can't pass locally** (flaky, infra, environment). Don't claim a green you didn't get — document why and get the user's call.
- **Merge conflicts you can't cleanly resolve** — surface them, especially across stacked issues.



## Common mistakes

- **Skipping the issue comments.** The body is half the story; decisions and corrections live in the comments. Read both.
- **Following the issue's bottom-layer plan literally.** It's pinned to an old commit and meant to be re-verified — re-investigate the current code; only the explicitly marked gotchas are meant to be trusted.
- **Starting before the intake gate.** Surfacing questions *and then coding anyway* defeats the purpose. Wait for real answers.
- **Claiming "tested/reviewed/ready" without evidence.** The report contract is a verification claim — back each line with the actual run, per verification-before-completion.
- **Sharing state across issues.** One worktree, branch, DB, and port per issue. Cross-contamination here is the one failure this structure exists to prevent.
- **Opening a non-draft PR, or merging.** PRs are drafts the user reviews; they decide when it's ready. Never merge on their behalf.
- **Forgetting `Closes #N`.** Each PR body must close its issue (per the repo's PR convention).
- **Creating the branch unlinked.** A plain `git checkout -b` / bare `create.sh` makes a branch with no tie to its issue, and you can't link it afterward. Always create it via `gh issue develop` (see *Branch creation*).
