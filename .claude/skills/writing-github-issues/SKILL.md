---
name: writing-github-issues
description: Use when authoring or filing a GitHub issue to hand work off for someone (or an agent) to pick up later — a feature, refactor, or bug that needs a scope a reviewer can verify without reading code.
---

# Writing GitHub Issues

## Overview

An issue has two audiences that pull in opposite directions:

- A **verifier** (senior engineer, reviewer, future picker-upper) needs to judge *is this the right thing, in the right shape?* — without reading any code.
- An **implementer** (often an agent) needs a rough map to start from.

Write for both with **two layers**: a clean human-readable top, and a collapsed, commit-pinned implementation sketch underneath. Code references rot; keep them out of the top and honest about being a snapshot in the bottom.

## Core principles

- **Top layer is code-free.** No file paths, no line numbers, no function or symbol names. Vision, motivation, behavior, acceptance — phrased to survive refactors. A reader who has never opened the repo should understand the work and how to verify it.
- **Bottom layer is an honest snapshot.** A collapsed `<details>` block holding the draft plan, stamped *"written as of `<short-sha>` on `<date>` — re-verify against latest."*
- **Specificity is a liability.** The more precise the plan is now, the more wrong it gets and the more it misleads whoever picks it up. Go only as deep as is useful to *start* the task; assume the implementer re-investigates.
- **Except real gotchas.** A genuinely hard-to-find trap is worth stating explicitly and marking — that's the knowledge re-investigation can't cheaply recover.
- **Human owns the top, agent owns the bottom.** Vision and acceptance come from the person; current behavior, where-it-lands, and the rough plan come from you reading the code.
- **Right-size it.** A good issue is roughly one reviewable PR. If the work sprawls across independent pieces, proactively propose a breakdown. The call is the human's — but making the suggestion is yours.

## Workflow

1. **Confirm it's issue-worthy** — a unit of work to hand off later, not something to just go do now.
2. **Get the target** — which GitHub repo, and any parent issue/epic. Detect candidates from git remotes (`git remote -v`) but **confirm with the human**: forks and worktrees mean `origin` is often not the intended target.
3. **Hand over the brain-dump prompts** — give the human `references/braindump-prompts.md` and let them ramble against it (speech-to-text is fine; tell them not to worry about order, structure, or transcription errors). The prompts cover the top layer — the human's vision.
4. **Read the dump, then ask clarifying questions** — one at a time, only to fill real gaps. Don't re-interview what they already said.
5. **Investigate the codebase** for the bottom layer — current behavior, where the change lands, a rough plan, real gotchas. Capture the short SHA (`git rev-parse --short HEAD`) and date for the pin.
6. **Scope-check** — now that you know the true size, ask: is this one reviewable PR? If it sprawls, **proactively propose a breakdown** before assembling (see Right-sizing). Present it and let the human decide; if they split, run the rest of the flow per resulting issue.
7. **Assemble** the body using `references/template.md` — top from the dump + clarifications, bottom in the collapsed pinned block.
8. **Self-lint** (below) before writing.
9. **Write to disk** at `docs/superpowers/issues/YYYY-MM-DD-<topic>.md` as an editing buffer, and tell the human to edit it directly.
10. **File it** — once they're happy, create the issue from the edited file with `gh` (see Filing). Confirm first; it's outward-facing and not easily undone. Report the issue URL.

## Right-sizing (push back on issues that are too big)

A single issue should land as one PR a reviewer can hold in their head. When the scope-check (step 6) trips one of these signals, say so and propose a split:

- It bundles **multiple independent capabilities** a user would describe separately.
- It touches **several subsystems that could each ship and be reverted on their own.**
- The **acceptance list covers unrelated outcomes** — passing one tells you nothing about another.
- The draft plan has **pieces with no shared code** that could be built and reviewed independently.
- The resulting **PR would be too large to review carefully** in one sitting.

How to propose the breakdown:

- Name the **seams** — the independent pieces, in plain language.
- Offer a shape: either a **parent/epic + child issues**, or a **sequence** where each builds on the last.
- Recommend **what ships first** — the smallest slice that delivers real value.
- **Defer to the human.** Make the case, then let them decide; keeping it whole is a legitimate choice. If they split, write each issue through the normal flow (child issues can reference the parent).

Frame it as a question, not a veto: *"This is really three things — A, B, C. I'd file A first as the smallest useful slice and track B/C under a parent. Want me to split it, or keep it as one?"*

## Self-lint (run on the draft before writing the file)

- Scan the **top** section for any file path, line number, function/symbol name, or "the X module." Found one? Delete it or move it into the collapsed plan.
- The top reads standalone — verifiable without the code.
- The collapsed plan is **pinned** (short SHA + date) and carries the **"rough guide, re-verify"** disclaimer.
- Any hard-to-find gotcha is marked; the plan isn't over-specified past what's useful to start.

## Filing

The agent files directly with the GitHub CLI — no wrapper script, so nothing lags `gh`'s evolving sub-issue support.

```bash
gh issue create --repo <owner/repo> --title "<title>" --body-file docs/superpowers/issues/<file>.md
```

Link a parent issue/epic with whatever `gh` supports at the time (a sub-issue relationship if available; otherwise a `Parent: #N` reference in the body or a task-list entry on the parent). Check `gh issue --help` rather than assuming a flag exists.

## Common mistakes

- **Code references creep into the top.** They feel helpful and rot fastest. The self-lint exists to catch this — run it.
- **Over-specifying the plan.** A precise plan that's three commits stale misleads more than a vague one. Resist.
- **Interviewing before the dump.** Let the human brain-dump first; questions come after, and only for gaps.
- **Filing to `origin` by reflex.** Confirm the repo — forks and worktrees make `origin` unreliable.
- **Filing without showing the human.** The on-disk file is theirs to edit first; creating the issue is the final, confirmed step.
- **Letting a mega-issue through.** If it's really three PRs, say so and propose a split before assembling. Silence here ships an unreviewable PR later.

## Worked example

`references/example-top-vs-buried.md` shows the same real issue with code-rot up top (wrong) versus a vision-level top and the detail relocated into the collapsed plan (right).
