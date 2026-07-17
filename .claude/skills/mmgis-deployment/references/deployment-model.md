# MMGIS local deployment model

How MMGIS runs on a developer machine — both the simple single-instance case and the multi-instance pattern this skill automates.

## What a deployment is

A deployment is one MMGIS instance: a server process on a `PORT`, a database named `DB_NAME`, an `.env`, and its own `node_modules`, in one directory. The only backing service required is **one Postgres+PostGIS container**. STAC / TiTiler / tipg / veloserver are optional (`--profile stac`, `--profile veloserver`) and off by default — not needed for a dashboard or for tests.

## The three run modes (from package.json)

- **`npm start`** — has a `prestart` hook that runs `docker-compose -f docker-compose.db.yml up -d --wait` to bring up a DB container, then `node scripts/init-db.js && node scripts/server.js`. The vanilla single-machine path.
- **`npm run start:no-docker`** — `init-db.js` + `server.js` with **no** `prestart` hook (npm only fires `prestart` before `start`). Assumes a DB is already reachable. **This is what coexisting deployments use**, because the `prestart` container always binds host port 5432 and would collide when a shared container already holds it.
- **`npm run start:test`** — `NODE_ENV=test PORT=8888 node scripts/server.js`. What Playwright auto-launches for e2e.

## Database

- **Auto-init.** `init-db.js` creates the `$DB_NAME` database, the `postgis` + `btree_gist` extensions, the `session` table, and spatial indexes. Idempotent ("already exists → nothing to do").
- **Auto-schema.** `server.js` runs Sequelize `.sync()`, which creates all tables on boot. **No manual migrations.**
- **Cross-branch schema.** `.sync()` reconciles *additive* changes automatically. Dropping/renaming columns across branches is the only case needing manual care.

## Ports

- In `NODE_ENV=development`: the API + WebSocket run on `PORT`; the **dashboard UI is served by webpack-dev-server on `PORT+1`**. `/` on `PORT` redirects to `PORT+1`. So dev uses **two** adjacent ports.
- In test/production: everything is on `PORT` (no `+1`).
- The API healthcheck is `GET /api/utils/healthcheck` on `PORT` (returns "Alive and Well!"). It comes up before webpack finishes its first compile, so the API can be healthy while the dashboard is still compiling for a few seconds.

## Coexisting many deployments

They differ only in `PORT` and `DB_NAME`, against one shared container:

- **One shared Postgres container.** `docker-compose.db.yml` hardcodes host `5432:5432`, so only one can run. Start it once from the main checkout (`npm run db:start`); every deployment points at `localhost:5432` with a distinct `DB_NAME`. Coexisting deployments launch with `start:no-docker`.
- **Ports stepped by 10** (dev burns `PORT` and `PORT+1`), starting at 8888 and skipping any already in an `.env` or listening.
- **`.env` and `node_modules` are gitignored** — never present in a fresh worktree; each deployment provisions its own (`npm install --force`; `--force` is required by this dependency tree, not `--legacy-peer-deps`).

## Config: how a deployment gets a working dashboard

A fresh database has no admin and no missions, so the landing page would be empty. Two ways to populate it:

- **Template-DB clone (default).** A frozen baseline database `mmgis_template_db` holds a baseline admin (`admin`, permission `111`) and a mission. Each new deployment's database is created as `CREATE DATABASE <db> TEMPLATE mmgis_template_db`, so it boots already populated and then evolves independently. Postgres requires the template to have no active connections — that's why `mmgis_template_db` is frozen (nothing connects to it) and why you must never clone from the live `mmgis` database.
- **First-run signup.** Without a template DB, the `/first_signup` endpoint makes the first account created a full admin (permission `111`); you then build missions in the Configure page.

Where the template DB itself comes from — it lives only in the local Docker volume, so each machine builds its own:

- **Seed (fresh machine).** `seed-template-db.sh` builds it from the committed `mission-profiles/generated/full-demo-mission.json` (generated from `mission-profiles/full-demo.json` by `scripts/generate-mission-config.js`): it boots a temporary server against a scratch database (Sequelize creates the schema), seeds an admin + the baseline mission through MMGIS's own APIs (`first_signup` → `login` → `/api/configure/add`), then renames the scratch DB to `mmgis_template_db`. The basemap token is injected at seed time from `MAPBOX_TOKEN` (env or the main checkout's `.env`) — **tokens are never committed to git**; the seed file holds a `{{MAPBOX_TOKEN}}` placeholder.
- **Snapshot (existing machine).** `refresh-template-db.sh` re-baselines from a live database via `pg_dump` (default source: `mmgis`).

Note the template DB does **not** survive `docker-compose down -v` or deleting the `mmgis_mmgis-local-db` volume — that wipes every database. Re-seed or re-snapshot afterward.

`FORCE_CONFIG_PATH=<file.json>` forces a single read-only mission from a file and **bypasses the Configure system** — a special case, not how normal deployments are configured.

## Tests

- **Unit (`npm run test:unit`)** — pure JS, no server, no database. Run anywhere in parallel, no collisions.
- **E2E (`npm run test:e2e`)** — Playwright auto-starts the server via `start:test`, which hardcodes `PORT=8888`, and `reuseExistingServer` is on locally. If another server is already on 8888, Playwright attaches to it and tests the wrong code. Run e2e only when 8888 is free (the `test.sh` helper enforces this). Parallel e2e across deployments would need app changes and is out of scope.

## Gotchas

- **CRLF in `.env`.** Some `.env` files use Windows line endings; a naive shell read yields values with a trailing `\r` (e.g. role `mmgis\r` → "role does not exist"). Always strip CR when reading `.env` in shell.
- **Stray DB containers.** Running plain `npm start` in a worktree spins up that worktree's *own* DB container (e.g. `mmgis-<name>-db-1`). These can linger (often in "Created" state) and confuse "which container is the shared one." The shared one is whichever publishes host port 5432.
