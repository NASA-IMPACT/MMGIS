#!/usr/bin/env bash
# refresh-golden.sh — (re)create the frozen mmgis_golden baseline from a source database.
#   refresh-golden.sh [source-db]   (default: mmgis)
# Only affects FUTURE deployments; existing ones keep their own databases.
# NOTE: the agent must confirm with the user before running (it overwrites the baseline).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

src="${1:-mmgis}"
mw_db_env
case "$src" in mmgis_golden|mmgis_golden_new) mw_die "source cannot be $src" ;; esac
mw_db_exists "$src" || mw_die "source database '$src' does not exist"

echo "Refreshing mmgis_golden from '$src'."
echo "(Only affects future deployments; existing deployments keep their own databases.)"

# Restore into a staging database first and swap only on success, so a failed
# dump/restore can never leave mmgis_golden existing-but-broken (create.sh only
# checks existence before cloning it).
staging="mmgis_golden_new"
if mw_db_exists "$staging"; then mw_psql postgres "DROP DATABASE $staging WITH (FORCE)"; fi
mw_psql postgres "CREATE DATABASE $staging"

docker exec -e PGPASSWORD="$MW_DB_PASS" "$MW_DB_CONTAINER" pg_dump -U "$MW_DB_USER" "$src" \
  | docker exec -i -e PGPASSWORD="$MW_DB_PASS" "$MW_DB_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$MW_DB_USER" -d "$staging" >/dev/null

if mw_db_exists mmgis_golden; then mw_psql postgres "DROP DATABASE mmgis_golden WITH (FORCE)"; fi
mw_psql postgres "ALTER DATABASE $staging RENAME TO mmgis_golden"

echo "mmgis_golden ready (snapshot of $src)."
