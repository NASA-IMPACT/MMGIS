---
name: mmgis-deployment
description: Use when deploying MMGIS locally — standing up or booting a dev instance, running several MMGIS deployments or git worktrees in parallel, tearing one down, or debugging a local deployment that won't start or serve.
---

# Deploying MMGIS locally

## Overview

A **deployment** is one MMGIS instance: a server process on a `PORT`, a database named `DB_NAME`, an `.env`, and its own `node_modules`, in one directory. All deployments share a single Postgres+PostGIS container and coexist simply by using different `PORT` and `DB_NAME` values. A git worktree is just one convenient way to get an independent directory — a separate clone, or the main checkout itself, works the same.

Each deployment has its **own database**, so its Configure page, users, and missions are fully independent and persistent. New deployments start from a frozen baseline database (`mmgis_template_db`) so they boot as a working app (admin user + a mission) with no manual setup.

To understand the internals (the single-instance deploy and the multi-instance pattern), read `references/deployment-model.md`.

## Prerequisites

- The shared DB container must be running. From the main checkout: `npm run db:start`.
- `mmgis_template_db` must exist. On a fresh machine run `scripts/seed-template-db.sh` once — it builds the baseline (admin/admin + the seed mission, named by the seed's `msv.mission`) from the committed seed via a temporary server; no existing database needed. Set `MAPBOX_TOKEN` (env or main `.env`) first if you want basemaps to render — tokens are never committed to git. `scripts/refresh-template-db.sh` instead re-snapshots the baseline from a live database you already have.

## Routing — which script for which intent

Scripts live in `scripts/` next to this file. Invoke them by path; each takes a deployment directory (default: current dir) or, for `create`/`teardown`, a name.

| Intent | Command |
|--------|---------|
| Understand how local deploy works | read `references/deployment-model.md` |
| Provision a new deployment | `scripts/create.sh <name>` (new worktree) or `scripts/create.sh --here` |
| Boot the dashboard | `scripts/start.sh <dir>` — prints the dashboard URL when healthy |
| Stop the server | `scripts/stop.sh <dir>` |
| See everything running | `scripts/list.sh` |
| Diagnose a sick deployment | `scripts/doctor.sh <dir>` |
| Run tests | `scripts/test.sh <dir> [unit\|e2e\|all]` |
| Remove a deployment | `scripts/teardown.sh <name\|dir>` |
| Bootstrap the baseline on a fresh machine | `scripts/seed-template-db.sh` |
| Re-baseline from a live DB | `scripts/refresh-template-db.sh [source-db]` |

A typical new-feature flow: `create.sh <name>` → `start.sh <dir>` → open the dashboard URL. When done: `teardown.sh <name>`.

## Autonomy and safety

Run these **autonomously** when the user's intent is clear: `create`, `start`, `stop`, `list`, `doctor`, `test`, and `seed-template-db` when no template DB exists (it refuses to overwrite one without `--force`).

**Confirm with the user first** — show exactly what will change, then wait for explicit approval — before:

- `teardown.sh` — drops a database and removes a worktree. It refuses when the deployment has uncommitted or unpushed work unless `--force`; never bypass that for the user without surfacing the warning. Show its printed plan and get a yes.
- `refresh-template-db.sh`, or `seed-template-db.sh --force` — both overwrite the baseline all future deployments clone from.

## Common mistakes

- **Using `npm start` in a coexisting deployment.** Its `prestart` hook starts another DB container fighting for port 5432. Coexisting deployments use `start:no-docker` (which `start.sh` does). The main checkout may still use `npm start`.
- **Cloning a deployment DB from the live `mmgis` database.** Postgres can't use a connected database as a clone template. Always clone the frozen `mmgis_template_db` (`create.sh` does this).
- **Expecting `refresh-template-db` to update existing deployments.** It only changes the baseline for *future* clones; existing deployments keep their own databases.
- **Reaching for `FORCE_CONFIG_PATH`.** It forces one read-only mission and bypasses the Configure system — special-case only, not how normal deployments are configured.
- **Running e2e while another server holds port 8888.** Playwright would attach to it and test the wrong code. `test.sh e2e` guards against this.
