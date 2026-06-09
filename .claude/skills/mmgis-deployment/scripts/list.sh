#!/usr/bin/env bash
# list.sh — show every MMGIS deployment with its port, database, and server status.
# All state is derived from reality (git worktrees, each .env, the DB container).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

mw_db_env
printf '%-26s %-30s %-6s %-22s %-8s %s\n' DIR BRANCH PORT DB DB? SERVER
while IFS=$'\t' read -r dir branch; do
  port="$(mw_env_get "$dir/.env" PORT)"; [ -n "$port" ] || port="-"
  db="$(mw_env_get "$dir/.env" DB_NAME)"; [ -n "$db" ] || db="-"
  dbex="no"; if [ "$db" != "-" ] && mw_db_exists "$db"; then dbex="yes"; fi
  srv="down"; if [ "$port" != "-" ] && mw_server_up "$port"; then srv="up"; fi
  printf '%-26s %-30s %-6s %-22s %-8s %s\n' "$(basename "$dir")" "$branch" "$port" "$db" "$dbex" "$srv"
done < <(mw_each_deployment)
