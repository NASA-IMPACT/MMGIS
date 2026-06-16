#!/usr/bin/env bash
# start.sh — start a deployment's dev server in the background and wait for healthcheck.
#   start.sh [dir]   (default: current directory)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

dir="$(mw_resolve_dir "${1:-$PWD}")"
[ -f "$dir/.env" ] || mw_die "no .env in $dir — run create.sh first"
port="$(mw_env_get "$dir/.env" PORT)"
[ -n "$port" ] || mw_die "no PORT in $dir/.env"

if mw_server_up "$port"; then
  mw_die "server already listening on port $port ($(mw_dashboard_url "$port"))"
fi

mkdir -p "$dir/.mmgis"
# Use start:no-docker so we never fight the shared DB container for port 5432.
# No pid file: npm forks node children, so stop.sh kills by port instead.
( cd "$dir" && nohup npm run start:no-docker >"$dir/.mmgis/server.log" 2>&1 & )

echo "starting server (port $port) — waiting for healthcheck..."
if mw_wait_healthy "$port" 120; then
  echo "up: dashboard $(mw_dashboard_url "$port")  ·  api http://localhost:$port"
else
  echo "healthcheck did not pass within timeout. Last log lines:" >&2
  tail -n 30 "$dir/.mmgis/server.log" >&2 || true
  exit 1
fi
