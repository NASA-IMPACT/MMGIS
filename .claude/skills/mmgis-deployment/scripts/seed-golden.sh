#!/usr/bin/env bash
# seed-golden.sh — build mmgis_golden from the committed seed (no existing database needed).
#   seed-golden.sh [--force]
# For fresh machines: boots a temporary server from the main checkout against a scratch
# database, seeds an admin user + the baseline mission through MMGIS's own APIs
# (first_signup → login → configure/add), then freezes the result as mmgis_golden.
# To re-baseline from your live mmgis database instead, use refresh-golden.sh.
#
# Env:
#   MAPBOX_TOKEN        basemap token injected into the seed config (never committed to git;
#                       falls back to MAPBOX_TOKEN in the main checkout's .env, else empty)
#   MW_SEED_ADMIN_USER  seeded admin username (default: admin)
#   MW_SEED_ADMIN_PASS  seeded admin password (default: admin)
#   MW_GOLDEN_DB        target database name (default: mmgis_golden)
# NOTE: the agent must confirm with the user before running with --force (overwrites the baseline).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_lib.sh"

force=0
[ "${1:-}" = "--force" ] && force=1

target="${MW_GOLDEN_DB:-mmgis_golden}"
seed_json="$HERE/../seed/baseline-mission.json"
[ -f "$seed_json" ] || mw_die "seed file missing: $seed_json"

main_dir="$(mw_main_dir)"
[ -d "$main_dir/node_modules" ] || mw_die "main checkout has no node_modules — run npm install --force in $main_dir first"
mw_db_env "$main_dir/.env"

if mw_db_exists "$target" && [ "$force" -ne 1 ]; then
  mw_die "$target already exists — use refresh-golden.sh to re-baseline from a live DB, or --force to overwrite with the committed seed"
fi

admin_user="${MW_SEED_ADMIN_USER:-admin}"
admin_pass="${MW_SEED_ADMIN_PASS:-admin}"
token="${MAPBOX_TOKEN:-$(mw_env_get "$main_dir/.env" MAPBOX_TOKEN)}"
[ -n "$token" ] || echo "warning: MAPBOX_TOKEN not set (env or main .env) — basemaps won't render until a token is added in Configure" >&2

scratch="${target}_seed"
port="$(mw_next_port)"
log="$main_dir/.mmgis/seed-server.log"
mkdir -p "$main_dir/.mmgis"

cleanup() { mw_kill_ports "$port" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if mw_db_exists "$scratch"; then mw_psql postgres "DROP DATABASE \"$scratch\" WITH (FORCE)"; fi

echo "seeding $target via a temporary server (port $port, scratch db $scratch)..."

# init-db creates the scratch DB + extensions; the server's Sequelize sync creates the
# tables on boot. Real env vars beat .env values (dotenv never overrides existing env),
# so the main checkout can be reused safely. AUTH=none matches deployment behavior;
# NODE_ENV=test serves the API without webpack.
( cd "$main_dir" && DB_NAME="$scratch" PORT="$port" NODE_ENV=test AUTH=none node scripts/init-db.js >>"$log" 2>&1 )
( cd "$main_dir" && DB_NAME="$scratch" PORT="$port" NODE_ENV=test AUTH=none nohup node scripts/server.js >>"$log" 2>&1 & )

mw_wait_healthy "$port" 60 || { tail -n 20 "$log" >&2; mw_die "temporary seed server never became healthy — see $log"; }

base="http://localhost:$port"
jar="$(mktemp)"
api() { curl -fsS -X POST -H 'Content-Type: application/json' -b "$jar" -c "$jar" -d "$2" "$base$1"; }

# Sequelize sync can finish a beat after the healthcheck passes; retry signup briefly.
ok=0 out=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  out="$(api /api/users/first_signup "{\"username\":\"$admin_user\",\"password\":\"$admin_pass\"}" || true)"
  case "$out" in *'"status":"success"'*) ok=1; break ;; esac
  sleep 2
done
[ "$ok" -eq 1 ] || mw_die "first_signup failed: ${out:-no response}"

out="$(api /api/users/login "{\"username\":\"$admin_user\",\"password\":\"$admin_pass\"}")"
case "$out" in *'"status":"success"'*) : ;; *) mw_die "login failed: $out" ;; esac

# Inject the token and POST the baseline mission. add() deep-merges the provided config
# into MMGIS's mission template and sets msv.mission/missionFolderName itself.
# (Mapbox pk. tokens are [A-Za-z0-9._-], so plain sed substitution is safe.)
payload="$(mktemp)"
{ printf '{"mission":"arst","config":'; sed "s|{{MAPBOX_TOKEN}}|${token}|" "$seed_json"; printf '}'; } >"$payload"
out="$(curl -fsS -X POST -H 'Content-Type: application/json' -b "$jar" -d @"$payload" "$base/api/configure/add")"
rm -f "$payload" "$jar"
case "$out" in *'"status":"success"'*) : ;; *) mw_die "mission add failed: $out" ;; esac

mw_kill_ports "$port" >/dev/null
# Let the server's DB connections drain so the rename below can take the lock.
for _ in 1 2 3 4 5; do
  [ "$(mw_psql postgres "SELECT count(*) FROM pg_stat_activity WHERE datname='$scratch'")" = "0" ] && break
  sleep 1
done

if mw_db_exists "$target"; then mw_psql postgres "DROP DATABASE \"$target\" WITH (FORCE)"; fi
mw_psql postgres "ALTER DATABASE \"$scratch\" RENAME TO \"$target\""

echo "$target ready (admin: $admin_user/$admin_pass · mission: arst)."
