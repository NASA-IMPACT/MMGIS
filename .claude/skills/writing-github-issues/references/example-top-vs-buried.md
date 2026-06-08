# Worked example: top-level vision vs. buried detail

A real draft (the "block saving a configuration with invalid field values" issue) started with its **current behavior described up top, full of file paths and line numbers**. That's the most common failure this skill prevents. Below: the same content the wrong way, then the right way.

## ❌ Before — code-rot in the top half

> ## Current behavior
>
> - Inline field validation exists. `Maker.js` computes a per-field format error and renders it:
>   - `configure/src/core/Maker.js:421` — `const formatError = hasError ? "" : getFieldFormatError(...)`
>   - Rendered as MUI `error` + `helperText` (e.g. `Maker.js:470-471`).
> - A `validationErrors` store slice exists but is unused for gating:
>   - `configure/src/core/ConfigureStore.js:22` — `validationErrors: []`
>   - `SaveBar.js:88` — `saveDisabled` is gated only by `lockConfig`.

**Why it's wrong:** a reviewer can't tell *what should change or why* without decoding the code. Every line number is a future lie — the moment someone edits `Maker.js`, `:421` points at something else, and the issue now misleads. The verifier audience is unserved.

## ✅ After — vision up top, detail collapsed and pinned

> ## Motivation
>
> A trusted admin types what they think is a valid link, gets no real stop, saves, and ships a dead card. The failure is invisible until someone clicks it. We already detect the bad value — we just don't act on it.
>
> ## How it should work
>
> When a configuration holds an invalid field value, saving is **blocked** with a clear, specific message that names what to fix. The block triggers even when the bad field is inside a collapsed editor the admin never opened. The existing inline red underline stays as a live hint while typing; this adds the hard stop.
>
> ## Done when
>
> - [ ] Finishing an editor that has an invalid field is blocked until it's fixed.
> - [ ] Saving with an invalid value anywhere is blocked, even in an unopened editor.
> - [ ] A valid value clears the block.
>
> <details>
> <summary>Draft implementation plan — written as of a1b2c3d on 2026-06-08. Rough guide; re-verify against latest code.</summary>
>
> ### Current behavior
> Inline validation already exists (`Maker.js` computes a per-field format error and renders it as MUI `error`/`helperText`). A `validationErrors` store slice exists but nothing gates on it — `SaveBar` disables save only on the concurrent-edit lock.
>
> ### Rough plan
> Connect the existing per-field validator to the save path; add a whole-config walk so collapsed editors are covered.
>
> > ⚠️ Gotcha: tool field schemas are fetched async — validation that runs in the reducer needs them already loaded, or it silently passes everything. Run at save-time if that's simpler.
>
> </details>

**Why it's right:** the top is verifiable by anyone, survives refactors, and reads as intent. The fragile detail lives in the collapsed block, pinned to a commit and flagged as a snapshot — and the one genuinely non-obvious trap (async schema load) is called out where it won't get lost.
