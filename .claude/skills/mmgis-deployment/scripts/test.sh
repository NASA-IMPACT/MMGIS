#!/usr/bin/env bash
# test.sh — run a deployment's tests safely.
#   test.sh [dir] [unit|e2e|all]   (default dir: current; default mode: all)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

dir="$PWD" mode="all"
for a in "$@"; do
  case "$a" in unit|e2e|all) mode="$a" ;; *) dir="$a" ;; esac
done
dir="$(mw_resolve_dir "$dir")"
[ -f "$dir/package.json" ] || mw_die "not an MMGIS checkout: $dir"

run_unit() { ( cd "$dir" && npm run test:unit ); }
run_e2e() {
  # E2E auto-starts the server via `npm run start:test`, which hardcodes PORT=8888.
  # If something is already listening on 8888, Playwright's reuseExistingServer would
  # attach to THAT server and silently test the wrong code. Fail fast instead.
  if mw_port_in_use 8888; then
    mw_die "port 8888 is in use — e2e would attach to that server and test the wrong code. Stop it first. (Parallel e2e across deployments needs app changes; out of scope.)"
  fi
  ( cd "$dir" && npm run test:e2e )
}

case "$mode" in
  unit) run_unit ;;
  e2e) run_e2e ;;
  all) run_unit; run_e2e ;;
esac
