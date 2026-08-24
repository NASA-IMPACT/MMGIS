# Troubleshooting MMGIS deployments

`doctor.sh` points here. Find the symptom, apply the fix.

## Server won't start / healthcheck never passes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `start.sh` times out; log shows DB connection error | Shared DB container not running | `npm run db:start` in the main checkout |
| Log: `role "mmgis\r" does not exist` or auth fails on a clean DB | CRLF in `.env` (trailing `\r` in values) | The scripts strip CR when reading `.env`; if you hand-edit, save with LF endings |
| Log: `database "<name>" does not exist` and it isn't created | `DB_NAME` mismatch, or DB never cloned | `doctor.sh`; if DB missing, `create.sh` (clones the template DB) or clone manually |
| `start.sh` says "already up on port N" | A server (maybe a stale one) is on that port | `stop.sh <dir>`, or find the listener with `lsof -nP -iTCP:N -sTCP:LISTEN` |
| API healthy but dashboard (PORT+1) returns 000/connection refused | webpack-dev-server still compiling | Wait ~30–90s for the first compile; re-curl |

## Port conflicts

| Symptom | Cause | Fix |
|---------|-------|-----|
| Two deployments show the same PORT in `list.sh` | They were configured with the same `PORT` (e.g. both copied 8888) | Edit one deployment's `.env` to a free port (`create.sh` picks free ports automatically for new deployments) |
| `start.sh` fails immediately, port in use | Another deployment or stray process holds the port | `lsof -nP -iTCP:<port> -sTCP:LISTEN`; stop the owner |
| Plain `npm start` failed with port 5432 in use | `npm start`'s `prestart` tried to start a second DB container | Use `start:no-docker` (what `start.sh` does); remove the stray container `docker rm mmgis-<name>-db-1` |

## Database / template DB

| Symptom | Cause | Fix |
|---------|-------|-----|
| `create.sh`: "mmgis_template_db does not exist" | Baseline never created on this machine | `seed-template-db.sh` (builds from the committed seed — works on a fresh machine) or `refresh-template-db.sh` (snapshots a live `mmgis`) |
| Basemap blank in a fresh deployment | The template DB was seeded without `MAPBOX_TOKEN` | Set `MAPBOX_TOKEN` and `seed-template-db.sh --force`, or paste a token into the mission's basemap settings in Configure |
| Clone fails: "source database is being accessed by other users" | Tried to use a live DB as a TEMPLATE | Clone only from frozen `mmgis_template_db`, never from `mmgis`; if refreshing the template DB, the dump/restore path avoids this |
| New deployment opens to an empty landing page | DB cloned from a template DB that had no mission, or `first_signup` not done | Refresh the template DB from a DB that has the mission, or sign up the first admin and build a mission |
| `DROP DATABASE` fails: in use | Server still connected | `stop.sh <dir>` first; `teardown.sh` stops the server before dropping |

## Teardown

| Symptom | Cause | Fix |
|---------|-------|-----|
| "refusing: uncommitted or unpushed work" | Real source changes or local-only commits in the worktree | Review the listed files/commits; commit or push them, or re-run with `--force` if you truly want to discard |
| `git worktree remove` fails: "contains modified or untracked files" | Build churn (node_modules, lockfile) in the worktree | Expected — `teardown.sh` falls back to `--force` for the worktree removal step automatically |
| Branch still exists after teardown | `teardown.sh` removes the worktree + database but leaves the branch | Delete it yourself if unwanted: `git branch -D <branch>` |

## Tests

| Symptom | Cause | Fix |
|---------|-------|-----|
| e2e passes but didn't seem to test your changes | Playwright `reuseExistingServer` attached to another server on 8888 | `test.sh e2e` refuses when 8888 is busy; stop the other server and re-run |
| e2e can't start its server | Port 8888 occupied | Free it; `test.sh` reports the conflict |
| Unit tests fail to import modules | `node_modules` missing/incomplete | `npm ci` in the deployment (never `--legacy-peer-deps` — it drops the deck.gl peer packages) |

## Stray containers

`docker ps -a | grep postgis` may show extra `mmgis-<name>-db-1` containers from accidental `npm start` runs. The shared container is the one publishing host port 5432 (`docker ps --format '{{.Names}} {{.Ports}}'`). Remove strays: `docker rm <name>` (add `-f` if running).
