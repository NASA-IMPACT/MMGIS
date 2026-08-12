#!/usr/bin/env bash
# doctor.sh — diagnose a deployment. Read-only.
#   doctor.sh [dir]   (default: current directory)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

dir="$(mw_resolve_dir "${1:-$PWD}")"
echo "doctor: $dir"
ok() { echo "  [ok]   $*"; }
bad() { echo "  [FAIL] $*"; }
warn() { echo "  [warn] $*"; }

if c="$(mw_db_container 2>/dev/null)"; then ok "db container: $c"; else bad "no postgis container running — 'npm run db:start' in the main checkout"; fi
mw_db_env "$dir/.env" 2>/dev/null || true

[ -f "$dir/.env" ] && ok ".env present" || bad ".env missing — run create.sh"
port="$(mw_env_get "$dir/.env" PORT)"
db="$(mw_env_get "$dir/.env" DB_NAME)"
[ -n "$port" ] && ok "PORT=$port" || bad "PORT not set in .env"
[ -n "$db" ] && ok "DB_NAME=$db" || bad "DB_NAME not set in .env"
[ -d "$dir/node_modules" ] && ok "node_modules present" || bad "node_modules missing — npm ci"

if [ -n "${MW_DB_CONTAINER:-}" ]; then
  if mw_psql postgres "SELECT 1" >/dev/null 2>&1; then ok "db reachable"; else bad "cannot connect to postgres in container"; fi
  if [ -n "$db" ]; then mw_db_exists "$db" && ok "database $db exists" || bad "database $db missing — create.sh clones it from the template DB"; fi
fi

if [ -n "$port" ]; then
  if mw_server_up "$port"; then
    if mw_wait_healthy "$port" 3; then ok "server up + healthcheck passing ($(mw_dashboard_url "$port"))"; else warn "port $port listening but healthcheck failing — check the log below"; fi
  else
    echo "  [info] server not running — start.sh to boot"
  fi
fi

if [ -f "$dir/.mmgis/server.log" ]; then
  echo "  --- last 15 log lines ---"
  tail -n 15 "$dir/.mmgis/server.log" | sed 's/^/  /'
fi
echo "  Fixes: references/troubleshooting.md"
