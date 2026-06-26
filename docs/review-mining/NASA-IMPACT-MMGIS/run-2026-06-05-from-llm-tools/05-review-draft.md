# DRAFT review artifact — NASA-IMPACT/MMGIS

> **DRAFT — human review required.** Auto-distilled from `04-corpus.md` by the
> `learn-from-pr-reviews` skill (91 substantive lessons across 43 PRs). Every rule
> traces to real review comments (links in the corpus). A human owner must read
> each rule, confirm it reflects a standard the team wants enforced, prune noise,
> and only then promote it into the project's real `review.md` / review agents in
> the [llm-conventions](https://github.com/NASA-IMPACT/llm-conventions) repo. Do
> **not** wire this into CI unedited.

Maps onto the `review.md` pipeline in llm-conventions. Each agent gets the
checklist for its dimension. Rules flagged ⚠ were raised in review but `ignored`
in practice — confirm whether they're standards the harness should now enforce, or
feedback the team consciously dropped.

---

## Agent 1 — Project alignment
- [ ] **Events go through the project event bus** (eventbus + scoped id), not custom
      dispatch / `window.dispatchEvent`. ⚠
- [ ] **Plugins stay generic — no plugin-specific routes in the core framework.** ⚠
- [ ] **Shared adapters/types/interfaces extracted to a common module.** ⚠
- [ ] **Components organized by purpose**, not the domain they're used in. ⚠
- [ ] **ADRs are factually accurate** (scope, capability cardinality). ⚠
- [ ] **Stated architectural constraints validated against real requirements** before
      an ADR is finalized. ⚠
- [ ] **Asset/resource coupling clarified before choosing a naming/storage strategy.** ⚠
- [ ] **New abstractions checked against prior team decisions.** ⚠
- [ ] **Example tools use standard framework patterns** (React/JSX, not jQuery markup).
- [ ] **Partial-config scope documented**; architectural constraints raised early.
- [ ] **New globals/patterns documented in relation to existing ones** (avoid parallel systems).
- [ ] **Sibling components audited for consistency** when adding a capability.

## Agent 2 — Org-convention & security
- [ ] **DOM from user/external data sanitized** — `.attr()`/`.text()`/`.textContent`,
      never template literals (XSS). *(Consistently enforced.)*
- [ ] **Dev-only / security-bypassing features guarded by `NODE_ENV`.** *(Enforced.)*
- [ ] **Plugin/extension namespaces system-enforced** (auto-generated), not manual.
- [ ] **CSS custom properties scoped** with a unique prefix (embedding safety).
- [ ] **Security controls match the threat model** (trusted-admin vs public). ⚠
- [ ] **Auth-behavior claims in comments verified** against real framework semantics. ⚠
- [ ] **Upload allowlists state intent + verify scope.**
- [ ] **Design system supports all deployment contexts** (NASA Horizon) or theming planned.

## Agent 3 — Craftsmanship
- [ ] **Lifecycle ops paired** (register↔unregister, listener add↔cleanup);
      teardown instance-scoped.
- [ ] **Names match behavior**; precise JSDoc.
- [ ] **DRY** — dup logic/types/literals → shared helpers/constants; magic numbers named.
- [ ] **Fail loud** — throw over silent return; try/catch init + surface to user;
      prevent dups, don't just `warn`.
- [ ] **Validate preconditions/inputs** (constrained fields at construction; schema-
      validate external inputs; explicit enum-branch checks).
- [ ] **Prefer native/library APIs** over custom/wasteful workarounds.
- [ ] **No dead/no-op code.**
- [ ] **Single source of truth + consistent invariants** (setters match `init` constraints). ⚠
- [ ] **Log failure reasons** on boolean returns. ⚠
- [ ] **Externalize config** (URLs/styles/endpoints/tokens). ⚠
- [ ] **No hardcoded context-varying values** (planet/mission/user). ⚠
- [ ] **Watch hot-path performance** (no per-interaction expensive recalcs).
- [ ] **Types model real concepts** (raw vs normalized; consistent verified alias tables).
- [ ] **No pre-added unused/future code or premature TODOs.**
- [ ] **Avoid speculative complexity.**

## Agent 4 — Test quality
- [ ] **New files (validators, controllers, lifecycle handlers) have tests.** ⚠
- [ ] ⚠ **Coverage-gap signal:** test quality was raised only once across 43 PRs, and
      ignored. Decide whether testing expectations must be made explicit — this
      dimension is nearly absent from the review history.

## Agent 5 — Documentation freshness
- [ ] **Comment hygiene** — concise top-level JSDoc; inline only when non-obvious.
- [ ] **No dangling docs at merge** (empty headers, placeholder keys, truncated text).
- [ ] **Docs match code** (`@throws` + behavioral promises backed by logic).
- [ ] **ADR consistency when dropping features**; explain activation of dormant code. ⚠
- [ ] **No stale external refs** (no time estimates / task IDs in ADRs/comments).
- [ ] **Document constraints/failure modes upfront.**
- [ ] **One decision per ADR.**
- [ ] **Config examples complete** (all keys + defaults).

## Agent 6 — Open-ended
Free pass for anything the dimensioned agents miss.

---

## Review-agent prompt skeleton
One per dimension. Template:

```
You are the {DIMENSION} reviewer for NASA-IMPACT/MMGIS.

Context you are given:
- The PR diff and the originating issue.
- {vision.md + overview for alignment | the org security/convention refs |
  the dimension checklist below}.

Your checklist (each item traces to real prior review feedback):
{paste the {DIMENSION} checklist items}

For each item, inspect the diff and report only CONCRETE violations: cite the
file:line, state the rule, and quote/point to the offending code. Do not invent
issues; if the diff doesn't touch a concern, skip it. Prefer precision over
volume — a senior reviewer's few sharp comments, not a lint dump.

Output: a list of findings { file, line, rule, severity, suggestion }.
```

## Harness-improvement note (for the team)
Per `overview.md`'s improvement loop: **27 of 91 substantive lessons (≈30%) were
ignored** — clustered in **#75** (craftsmanship, 10), **#111** (alignment/security,
8), and **#112** (the ADR, 4). That's the clearest signal of review feedback the
team values but didn't act on. Encoding those rules so a review *agent* enforces
them automatically is exactly the gap this harness is meant to close.
