This is an LLM artifact — design notes from the first real staging use of the Deployments page (2026-06-10), for a planned amendment to PR 8 (#138). Not yet implemented.

# Deployments registry redesign — one identity row per dashboard

## The problem, as discovered

During staging, three failed publish attempts (debugging infra issues) plus one success left the Deployments page showing five rows for two missions. The first real user's reaction — "it seems like it is showing multiple lines for the same mission" — is the design bug in one sentence: a row currently means *a publish attempt*, but the ADR, the 1:1 mission↔dashboard rule, the save-bar Publish button, and the user's mental model all treat a row as *the dashboard for a mission*. The ADR already says the intended thing: "a small registry — **one row per published dashboard**." Per-attempt rows are implementation drift (same species as the lost "SPA polling" detail).

Concrete harms beyond clutter:

- **The save-bar Publish wedges after any failed publish.** Its publish-vs-update decision treats any non-deleted row for the mission as "dashboard exists" → it fires an *update* at a row with no stack, which can only fail. The mission is stuck until someone deletes the failed row.
- **A failed *update* misreports a live dashboard as dead.** If an update fails, the old bundle is still serving — but the row flips to `failed`, telling the admin their dashboard is down when it isn't.
- 1:1 semantics are ambiguous everywhere a "the deployment for mission X" lookup happens.

## Target design

1. **At most one live row per mission**, enforced by a partial unique index on `mission` where `status != 'deleted'`. The row is the dashboard's identity: mission, name, stack name/ARN, `cloudfront_url`, status, `last_error`, timestamps.
2. **Publish = upsert + state transition, not insert.** No row → create + provision. Row in `failed` → **retry the same row**: the task deletes any `CREATE_FAILED`/`ROLLBACK_COMPLETE` stack remnant first, then recreates (stack name stays bound to the row id — idempotency improves as a side effect). Row `published` → this is an update.
3. **Status means "state of the dashboard", not "result of the last attempt".** `failed` is reserved for "no working dashboard exists" (create-path failure). An update failure keeps `published` and surfaces the error separately (e.g. `last_error` + an `updated`-vs-`update_failed` marker) — the URL keeps serving the previous bundle.
4. **Delete** tears down and tombstones. Default page view shows live dashboards only; a "show deleted" toggle reveals tombstones (cheap history, already exists in the data).
5. **Save-bar logic collapses** to: no row → publish; `failed` → retry; `published` → update. No list-scan heuristics.
6. **Page layout**: one line per dashboard — mission, name, status, URL, last updated, error-if-any — actions Open / Update / Retry / Delete.

## History (separate, later enhancement)

Tombstones + CloudWatch publish-task logs (full forensic record per attempt) + CloudFormation's 90-day deleted-stack history cover audit needs today. If real audit requirements exist (ask the senior dev — NASA contexts sometimes require it), add a `deployment_events` table (attempt started / published / update_failed / deleted; timestamp, actor, config version, error) rendered as an expandable per-dashboard history drawer. Webhooks already emit submission events for external capture.

## Scope of the change (amendment to PR 8 / #138)

- `API/Backend/Deployments/models/deployment.js`: partial unique index; possibly an `update_failed` marker field.
- `routes/deployments.js`: publish handler becomes upsert/retry-aware; update-failure status semantics; list keeps returning tombstones (UI filters).
- `scripts/publish-static.js`: on retry, clear failed stack remnants before CreateStack; on update failure, terminal write preserves `published`.
- `configure/.../Deployments.js`: live-only default view + toggle; Retry action; status copy.
- `SaveBar.js`: simplified decision.
- Tests for the transitions (esp. update-failure-keeps-published and retry-after-create-failed).

Estimated effort: a focused day including review. PRs are drafts, so amending #138 is clean.

## Decision status

Recommended (it is an ADR-conformance fix, found by first real use). Awaiting go-ahead; staging currently works with the append-only model + manual tombstone cleanup.
