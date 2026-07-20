#!/usr/bin/env bash
# _lib.sh — shared helpers for the mmgis-deployment skill scripts.
# Source this from the other scripts: `source "$(dirname "$0")/_lib.sh"`.
#
# Conventions:
#   - A "deployment" is an MMGIS checkout directory with its own .env (PORT + DB_NAME).
#   - State is derived from reality: `git worktree list`, each .env, and the DB container.
#   - All DB work goes through the shared Postgres container via `docker exec` (no host psql needed).

set -euo pipefail

# Anchor for all repo discovery: this file's own location, NOT $PWD. The skill is
# tracked in the repo, so invoking any copy of these scripts must act on the repo
# that copy lives in — never on whatever repo the caller happens to be cd'd into.
MW_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mw_die() { echo "error: $*" >&2; exit 1; }
mw_info() { echo "  $*"; }

# Absolute path of a deployment dir (default: current directory).
mw_resolve_dir() {
  local d="${1:-$PWD}"
  [ -d "$d" ] || mw_die "no such directory: $d"
  (cd "$d" && pwd)
}

# The primary working tree (where .env is templated from). Resolved from the
# scripts' own repo, so it is correct even when invoked from a worktree's copy
# of the skill or from an unrelated cwd.
mw_main_dir() {
  local cdir
  cdir="$(git -C "$MW_SCRIPTS_DIR" rev-parse --git-common-dir 2>/dev/null)" \
    || mw_die "skill scripts are not inside a git repo: $MW_SCRIPTS_DIR"
  case "$cdir" in
    /*) : ;;                                 # already absolute
    *)  cdir="$MW_SCRIPTS_DIR/$cdir" ;;      # make relative path absolute
  esac
  (cd "$(dirname "$cdir")" && pwd)
}

# Read KEY from a .env file. Prints value (quotes stripped) or empty string.
# Always returns 0 so `var=$(mw_env_get ...)` is safe under `set -e`.
mw_env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  # tr strips CR first (some .env files use CRLF line endings), then sed peels key= and quotes.
  grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 | tr -d '\r' | sed -E "s/^${key}=//; s/^[\"']//; s/[\"']$//" || true
  return 0
}

# Set KEY=VAL in a .env file (update in place or append).
mw_env_set() {
  local file="$1" key="$2" val="$3" tmp
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    tmp="$(mktemp)"
    sed -E "s|^${key}=.*|${key}=${val}|" "$file" >"$tmp" && mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >>"$file"
  fi
}

# Name of the running Postgres+PostGIS container (detected, not hardcoded).
mw_db_container() {
  local c
  c="$(docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null | awk -F'\t' '$2 ~ /postgis/ {print $1; exit}')"
  [ -n "$c" ] || mw_die "no running postgis container found — start the shared DB (npm run db:start in the main checkout)"
  echo "$c"
}

# Load DB connection settings from a deployment's .env into MW_DB_* globals.
# Falls back to the main checkout's .env, then to mmgis/mmgis defaults.
mw_db_env() {
  local envfile="${1:-}"
  [ -n "$envfile" ] && [ -f "$envfile" ] || envfile="$(mw_main_dir)/.env"
  MW_DB_USER="$(mw_env_get "$envfile" DB_USER)"; : "${MW_DB_USER:=mmgis}"
  MW_DB_PASS="$(mw_env_get "$envfile" DB_PASS)"; : "${MW_DB_PASS:=mmgis}"
  MW_DB_CONTAINER="$(mw_db_container)"
}

# Run SQL against a database in the container. Usage: mw_psql <dbname> <sql>
mw_psql() {
  docker exec -e PGPASSWORD="$MW_DB_PASS" "$MW_DB_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$MW_DB_USER" -d "$1" -tAc "$2"
}

# True if a database exists.
mw_db_exists() {
  [ "$(mw_psql postgres "SELECT 1 FROM pg_database WHERE datname='$1'")" = "1" ]
}

# Sanitize a deployment name into a Postgres identifier: mmgis_<name>.
mw_db_name_for() {
  local name="$1"
  name="$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//')"
  echo "mmgis_${name}"
}

# True if a TCP port has a LISTEN socket.
mw_port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# Kill the node process(es) listening on the given ports. Prints 1 if anything
# was killed, else 0. Non-node listeners are skipped with a warning rather than
# killed — a deployment's server is always node, so anything else on the port is
# not ours to kill.
mw_kill_ports() {
  local killed=0 p pid comm
  for p in "$@"; do
    for pid in $(lsof -tnP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null || true); do
      comm="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
      case "$comm" in
        *node*) kill "$pid" 2>/dev/null && killed=1 || true ;;
        *) echo "  warning: leaving pid $pid on port $p alone (${comm:-unknown}, not a node process)" >&2 ;;
      esac
    done
  done
  echo "$killed"
}

# All PORT values declared across worktree .env files (space-separated).
mw_all_env_ports() {
  local line dir p
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) dir="${line#worktree }" ;;
      *) continue ;;
    esac
    p="$(mw_env_get "$dir/.env" PORT)"
    if [[ "$p" =~ ^[0-9]+$ ]]; then printf '%s ' "$p"; fi
  done < <(git -C "$MW_SCRIPTS_DIR" worktree list --porcelain)
  return 0
}

# Next free port: base 8888, stepped by 10, skipping ports used by an .env or
# currently listening (checks PORT and PORT+1 since dev uses both).
mw_next_port() {
  local base=8888 used cand
  used=" $(mw_all_env_ports) "
  cand=$base
  while :; do
    if [[ "$used" != *" $cand "* ]] && ! mw_port_in_use "$cand" && ! mw_port_in_use $((cand + 1)); then
      echo "$cand"; return
    fi
    cand=$((cand + 10))
  done
}

# Iterate deployments. Emits "<dir>\t<branch>" per worktree that looks like MMGIS.
mw_each_deployment() {
  local dir="" branch="" line
  _mw_emit_dep() {
    if [ -n "$dir" ] && [ -f "$dir/package.json" ]; then printf '%s\t%s\n' "$dir" "$branch"; fi
  }
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) dir="${line#worktree }" ;;
      "branch "*)   branch="${line#branch refs/heads/}" ;;
      "detached")   branch="(detached)" ;;
      "")           _mw_emit_dep; dir=""; branch="" ;;
    esac
  done < <(git -C "$MW_SCRIPTS_DIR" worktree list --porcelain)
  _mw_emit_dep
  return 0
}

# Dashboard URL for a deployment (dev serves UI on PORT+1).
mw_dashboard_url() {
  local port="$1"
  echo "http://localhost:$((port + 1))"
}

# Configure (CMS) URL for a deployment (served on PORT itself, not PORT+1).
mw_configure_url() {
  local port="$1"
  echo "http://localhost:${port}/configure"
}

# Poll the API healthcheck until it returns 200 or timeout (seconds).
mw_wait_healthy() {
  local port="$1" timeout="${2:-90}" url
  url="http://localhost:${port}/api/utils/healthcheck"
  for ((i = 0; i < timeout; i++)); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

# True if a deployment's server appears up (API port listening).
mw_server_up() { mw_port_in_use "$1"; }
