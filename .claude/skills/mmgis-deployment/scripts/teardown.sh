#!/usr/bin/env bash
# teardown.sh — remove a deployment: stop server, drop its database, remove the worktree.
#   teardown.sh <name|dir> [--force]
# Safety: refuses if the deployment has uncommitted or unpushed work, unless --force.
# Never touches the main checkout or the protected databases (mmgis, mmgis_template_db, mmgis-stac).
# NOTE: the agent must show this plan and get explicit user confirmation before running.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

force=0 target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) force=1 ;;
    *) target="$1" ;;
  esac
  shift
done
[ -n "$target" ] || mw_die "usage: teardown.sh <name|dir> [--force]"

main_dir="$(mw_main_dir)"
if [ -d "$target" ]; then dir="$(mw_resolve_dir "$target")"; else dir="$(dirname "$main_dir")/MMGIS-$target"; fi
[ -d "$dir" ] || mw_die "no such deployment dir: $dir"
[ "$dir" != "$main_dir" ] || mw_die "refusing to tear down the main checkout"

db="$(mw_env_get "$dir/.env" DB_NAME)"
port="$(mw_env_get "$dir/.env" PORT)"
mw_db_env "$main_dir/.env"

is_wt=0
git -C "$main_dir" worktree list --porcelain | grep -qx "worktree $dir" && is_wt=1

# Ignore known churn that normal operation produces (not source work worth protecting):
# our runtime dir, the install lockfile, and the dev-server-regenerated tool config.
churn='\.mmgis/|package-lock\.json|configure/public/toolConfigs\.json'
dirty="$(git -C "$dir" status --porcelain 2>/dev/null | grep -vE "$churn" || true)"
# unpushed = commits unique to THIS worktree's HEAD not yet on its upstream — or, if the
# branch was never pushed, commits beyond the integration branch (MW_MAIN_BRANCH, default
# development). Scoped to this worktree so a shared, unpushed base branch doesn't false-positive.
main_branch="${MW_MAIN_BRANCH:-development}"
if up="$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  cnt="$(git -C "$dir" rev-list --count "${up}..HEAD" 2>/dev/null || echo 0)"
else
  cnt="$(git -C "$dir" rev-list --count "${main_branch}..HEAD" 2>/dev/null || echo 0)"
fi
cnt="${cnt//[^0-9]/}"; cnt="${cnt:-0}"
unpushed=""; [ "$cnt" -gt 0 ] && unpushed="$cnt commit(s) not pushed/merged"

echo "teardown plan for $dir:"
echo "  drop database   : ${db:-<none>}"
echo "  remove worktree : $([ $is_wt -eq 1 ] && echo yes || echo 'no (not a worktree)')"
if [ -n "$port" ]; then echo "  stop server on  : $port/$((port + 1))"; else echo "  stop server on  : <none — no PORT in .env>"; fi
if [ -n "$dirty" ]; then echo "  WARNING: uncommitted changes:"; echo "$dirty" | sed 's/^/      /'; fi
[ -n "$unpushed" ] && echo "  WARNING: $unpushed"

if [ "$force" -ne 1 ] && { [ -n "$dirty" ] || [ -n "$unpushed" ]; }; then
  mw_die "uncommitted or unpushed work present — re-run with --force to override."
fi
case "$db" in
  mmgis|mmgis_template_db|mmgis-stac|"") [ -z "$db" ] || mw_die "refusing to drop protected database: $db" ;;
esac

# stop server
if [ -n "$port" ]; then
  mw_kill_ports "$port" $((port + 1)) >/dev/null
fi
# drop database
if [ -n "$db" ] && mw_db_exists "$db"; then
  mw_psql postgres "DROP DATABASE \"$db\" WITH (FORCE)"
  echo "dropped database $db"
fi
# remove worktree
if [ "$is_wt" -eq 1 ]; then
  # plain string flag (not an array) — macOS bash 3.2 errors on empty "${arr[@]}" under set -u
  fflag=""; [ "$force" -eq 1 ] && fflag="--force"
  git -C "$main_dir" worktree remove $fflag "$dir" || git -C "$main_dir" worktree remove --force "$dir"
  echo "removed worktree $dir"
fi
echo "teardown complete."
