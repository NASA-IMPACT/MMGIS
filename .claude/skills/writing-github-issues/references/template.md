# Issue template

The *output* shape. Headings in the top half are a **default, not a cage** — deviate when the issue calls for it, but keep the top code-free and keep the plan collapsed and pinned.

Copy from the line below, fill it in, drop empty sections.

---

```markdown
# <Imperative title, scoped> — e.g. "Configure: block saving a configuration with invalid field values"

## Motivation

<Why this matters / what's broken without it. The pain, who feels it, when. No code references.>

## How it should work

<The vision: what it looks like when it works, and how someone interacts with it —
how you turn it on, block someone, edit it, what happens on bad input. Behavior, not implementation.>

## Done when

<Acceptance criteria a verifier can check by using the thing, not by reading code.>

- [ ] ...
- [ ] ...

## Out of scope

<What's tempting to fold in but stays out. Where the line is.>

<details>
<summary>Draft implementation plan — written as of <short-sha> on <YYYY-MM-DD>. Rough guide; re-verify against latest code.</summary>

### Current behavior

<How it works today, where the relevant logic lives. Code references belong HERE, not above.>

### Where the change lands & rough plan

<The pieces, in enough depth to *start* — not a spec. The implementer re-investigates.>

> ⚠️ Gotcha: <a genuinely hard-to-find trap worth stating explicitly, if any. Delete if none.>

### References

<Optional: a few key files/functions as starting points, understood to be snapshot-accurate only.>

</details>
```

---

## Notes for the agent

- The top half comes from the human's brain dump + your clarifying questions. The collapsed half comes from your codebase investigation.
- Get the short SHA with `git rev-parse --short HEAD` and stamp it into the `<summary>` line. The human can see and edit it in the on-disk file before filing.
- Run the self-lint (in `SKILL.md`) before writing the file — the most common failure is code references leaking into the top half.
