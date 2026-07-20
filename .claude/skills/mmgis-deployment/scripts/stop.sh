#!/usr/bin/env bash
# stop.sh — stop a deployment's dev server (kills the node processes on its PORT and PORT+1).
#   stop.sh [dir]   (default: current directory)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

dir="$(mw_resolve_dir "${1:-$PWD}")"
port="$(mw_env_get "$dir/.env" PORT)"
[ -n "$port" ] || mw_die "no PORT in $dir/.env"

killed="$(mw_kill_ports "$port" $((port + 1)))"

if [ "$killed" -eq 1 ]; then
  echo "stopped server for $dir (ports $port/$((port + 1)))"
else
  echo "no server was listening for $dir"
fi
