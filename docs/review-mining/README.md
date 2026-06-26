# Review-mining archive

Preserved output of the `learn-from-pr-reviews` skill run against this
repository (`NASA-IMPACT/MMGIS`). The skill mines the repo's pull-request
review history into a verified, categorized **wisdom corpus** and a **DRAFT**
`review.md` checklist + review-agent prompt.

These files are normally **gitignored** in the skill's working repos
(`review-mining/` is ignored), so this branch exists purely to keep the
generated artifacts from being lost. It is an **archive branch — not intended
to be merged** into `development`.

## Contents

`NASA-IMPACT-MMGIS/` holds two runs:

- **`run-2026-06-23-from-llm-conventions/`** — newest, fullest run. Copied from
  `~/github/llm-conventions-impact/review-mining/NASA-IMPACT-MMGIS/`.
  Largest corpus + review draft; includes a Haiku verdict pass
  (`03-verdicts.haiku.jsonl`) and a phase-2 error log.
- **`run-2026-06-05-from-llm-tools/`** — earlier run. Copied from
  `~/github/llm-tools/review-mining/NASA-IMPACT-MMGIS/`. Retains the
  intermediate `02-threads/` and `03-input/` per-record breakdowns.

## Key artifacts (per run)

- `05-review-draft.md` — the human-facing deliverable (DRAFT review checklist +
  review-agent prompt skeleton). **Human review required.**
- `04-corpus.md` — the verified, categorized wisdom corpus.
- `03-verdicts*.jsonl` — per-comment verdicts (the judged evidence).
- `01-prs.json`, `03-all-threads.json`, `02-threads/`, `03-input/` — raw and
  intermediate scaffolding (regenerable).

## Source skill

The canonical home of the `learn-from-pr-reviews` skill is
`NASA-IMPACT/llm-tools` (`skills/learn-from-pr-reviews/`).
