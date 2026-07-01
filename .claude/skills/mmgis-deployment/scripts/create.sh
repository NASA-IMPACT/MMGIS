#!/usr/bin/env bash
# create.sh — provision an MMGIS deployment (idempotent; re-running skips finished steps).
#   create.sh <name> [--base <ref>] [--branch <branch>]   # new worktree at ../MMGIS-<name>
#   create.sh --here [--name <name>]                       # provision the current directory
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

name="" base="development" branch="" here=0
while [ $# -gt 0 ]; do
  case "$1" in
    --here) here=1 ;;
    --base) base="$2"; shift ;;
    --branch) branch="$2"; shift ;;
    --name) name="$2"; shift ;;
    -*) mw_die "unknown flag: $1" ;;
    *) [ -z "$name" ] && name="$1" || mw_die "unexpected arg: $1" ;;
  esac
  shift
done

main_dir="$(mw_main_dir)"

if [ "$here" -eq 1 ]; then
  dir="$PWD"
  [ -n "$name" ] || name="$(basename "$dir")"
else
  [ -n "$name" ] || mw_die "usage: create.sh <name> [--base ref] [--branch b]  |  create.sh --here"
  parent="$(dirname "$main_dir")"
  dir="$parent/MMGIS-$name"
  [ -n "$branch" ] || branch="$name"
  if [ -d "$dir" ]; then
    mw_info "worktree dir already exists: $dir (skipping git worktree add)"
  elif git -C "$main_dir" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$main_dir" worktree add "$dir" "$branch"
  else
    git -C "$main_dir" worktree add -b "$branch" "$dir" "$base"
  fi
fi

dir="$(mw_resolve_dir "$dir")"
[ -f "$dir/package.json" ] || mw_die "$dir is not an MMGIS checkout"

mw_db_env "$main_dir/.env"

# --- .env ---
# An existing .env is the source of truth for this deployment's PORT and
# DB_NAME (they may differ from what the name argument would generate).
if [ -f "$dir/.env" ]; then
  port="$(mw_env_get "$dir/.env" PORT)"
  dbname="$(mw_env_get "$dir/.env" DB_NAME)"
  [ -n "$port" ] || mw_die "$dir/.env has no PORT — fix it or delete it and re-run"
  [ -n "$dbname" ] || mw_die "$dir/.env has no DB_NAME — fix it or delete it and re-run"
  mw_info ".env exists (leaving as-is): port=$port db=$dbname"
else
  [ -f "$main_dir/.env" ] || mw_die "no template .env in main checkout: $main_dir/.env"
  dbname="$(mw_db_name_for "$name")"
  cp "$main_dir/.env" "$dir/.env"
  port="$(mw_next_port)"
  mw_env_set "$dir/.env" PORT "$port"
  mw_env_set "$dir/.env" DB_NAME "$dbname"
  mw_env_set "$dir/.env" NODE_ENV development
  mw_env_set "$dir/.env" AUTH none
  mw_env_set "$dir/.env" DB_HOST localhost
  mw_info "wrote .env: port=$port db=$dbname"
fi

# --- database (clone the frozen golden; before npm install so a missing golden fails fast) ---
if mw_db_exists "$dbname"; then
  mw_info "database $dbname already exists (skipping clone)"
else
  mw_db_exists mmgis_golden || mw_die "mmgis_golden does not exist — run seed-golden.sh (builds it from the committed baseline) or refresh-golden.sh (snapshots a live DB)"
  mw_psql postgres "CREATE DATABASE \"$dbname\" TEMPLATE mmgis_golden"
  mw_info "cloned mmgis_golden -> $dbname"
fi

# --- node_modules ---
if [ -d "$dir/node_modules" ]; then
  mw_info "node_modules present (skipping npm install)"
else
  mw_info "running npm install --force (takes a few minutes)..."
  (cd "$dir" && npm install --force)
fi

# --- configure CMS bundle ---
# configure/build is gitignored and the server never builds it live (unlike the
# dashboard), so /configure has no app to serve unless we provide one. Copy the
# prebuilt bundle from the main checkout; it reads its tool list and its API port
# at runtime, so a single prebuilt copy works for any deployment on any port.
if [ -d "$dir/configure/build" ]; then
  mw_info "configure/build present (skipping copy)"
elif [ -d "$main_dir/configure/build" ]; then
  cp -R "$main_dir/configure/build" "$dir/configure/build"
  mw_info "copied configure/build from main checkout"
else
  mw_info "warning: no configure/build in main checkout — /configure will not load."
  mw_info "         build it once:  (cd \"$main_dir/configure\" && npm install && npm run build)"
fi

echo
echo "ready: $dir"
echo "  port $port  ·  db $dbname"
echo "  dashboard  $(mw_dashboard_url "$port")  (after start)"
echo "  configure  $(mw_configure_url "$port")  (after start; log in admin / admin)"
echo "  start it:  $HERE/start.sh \"$dir\""
