#!/usr/bin/env bash
# Deploys a commit of Vertex Hub as an atomic release. Runs as the `vertexhub` user, started by
# /usr/local/bin/vertexhub-deploy (root), which always runs the latest copy of this script.
#
#   deploy.sh [<git ref>]   build and switch to a release (default: origin/main)
#   deploy.sh rollback      switch back to the previous release (migrations are not reverted)
#
# Nothing touches the running release until the new one is built, the database is backed up
# and migrated. If the new release fails its health check, the previous one is restored.
set -euo pipefail
umask 022

SITE_DIR=/srv/hub.vertexmedia.pro
REPO="$SITE_DIR/repo.git"
RELEASES="$SITE_DIR/releases"
SHARED="$SITE_DIR/shared"
CURRENT="$SITE_DIR/current"
ECOSYSTEM="$CURRENT/deploy/ecosystem.config.cjs"
HEALTH_URL="http://127.0.0.1:3050/api/health"
KEEP_RELEASES=5
KEEP_DB_SNAPSHOTS=10

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export TURBO_TELEMETRY_DISABLED=1
export CI=1

log() { printf '\033[1m[deploy %s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { log "FAILED: $*"; exit 1; }

[ "$(id -un)" = vertexhub ] || fail "run as vertexhub (use /usr/local/bin/vertexhub-deploy)"
exec 9>"$SITE_DIR/.deploy.lock"
flock -n 9 || fail "another deploy is running"

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to() {
  ln -sfn "$1" "$SITE_DIR/current.next"
  mv -T "$SITE_DIR/current.next" "$CURRENT"
  pm2 startOrReload "$ECOSYSTEM" --update-env >/dev/null
  pm2 save >/dev/null
}

if [ "${1:-}" = rollback ]; then
  active=$(readlink -f "$CURRENT")
  # Release names start with a UTC timestamp, so the previous one sorts just before the active one.
  previous=$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort |
    awk -v active="$active" '$0 < active' | tail -1)
  [ -n "$previous" ] || fail "no previous release to roll back to"
  log "rolling back to $(basename "$previous")"
  switch_to "$previous"
  healthy || fail "previous release is not healthy either; check: pm2 logs"
  log "rolled back to $(basename "$previous")"
  exit 0
fi

ref="${1:-origin/main}"
log "fetching"
git -C "$REPO" fetch --quiet --prune origin '+refs/heads/*:refs/remotes/origin/*'
sha=$(git -C "$REPO" rev-parse --verify "$ref^{commit}") || fail "unknown ref $ref"
release="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:7}"
log "building ${sha:0:7} in $(basename "$release")"

mkdir -p "$release"
cleanup_failed() { log "removing unfinished release"; rm -rf "$release"; }
trap cleanup_failed ERR

git -C "$REPO" archive "$sha" | tar -x -C "$release"
echo "$sha" >"$release/REVISION"
ln -s "$SHARED/.env" "$release/.env"

(
  cd "$release"
  corepack pnpm install --frozen-lockfile --reporter=append-only
  corepack pnpm build
)

# A snapshot right before migrating, restorable with pg_restore if a migration goes wrong.
mkdir -p "$SHARED/db-snapshots"
set -a
# shellcheck disable=SC1091
. "$SHARED/.env"
set +a
snapshot="$SHARED/db-snapshots/$(basename "$release").dump"
log "database snapshot"
(umask 077 && pg_dump --format=custom --file="$snapshot" "$DATABASE_URL")
ls -1t "$SHARED"/db-snapshots/*.dump 2>/dev/null | tail -n +$((KEEP_DB_SNAPSHOTS + 1)) | xargs -r rm -f

log "migrating"
node "$release/packages/db/dist/cli/migrate.js"
trap - ERR

previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
log "switching to $(basename "$release")"
switch_to "$release"

if ! healthy; then
  log "new release failed its health check"
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    switch_to "$previous"
    healthy && log "restored $(basename "$previous")" || log "previous release is unhealthy too"
  fi
  fail "release ${sha:0:7} is not healthy; logs: pm2 logs vertexhub-api --err"
fi

log "pruning old releases"
active=$(readlink -f "$CURRENT")
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort | head -n -"$KEEP_RELEASES" |
  grep -v -x "$active" | xargs -r rm -rf

log "deployed ${sha:0:7}"
