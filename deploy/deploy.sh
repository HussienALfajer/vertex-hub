#!/usr/bin/env bash
# Deploys a commit of Vertex Hub as an atomic release. Runs as the `vertexhub` user, started by
# /usr/local/bin/vertexhub-deploy (root), which always runs the latest copy of this script.
#
#   deploy.sh [<git ref>]       build and switch to a release (default: origin/main)
#   deploy.sh rollback          switch back to the previous release (migrations are not reverted)
#   deploy.sh restore <release> restore the database snapshot taken before that release migrated
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

# Returns non-zero instead of exiting when PM2 fails, so the caller can still restore the
# previous release (set -e does not apply inside a function called from a condition).
# The worker process is online in PM2 and has stayed up (it has no HTTP health endpoint).
worker_online() {
  sleep 5
  pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => (input += chunk));
    process.stdin.on("end", () => {
      const worker = JSON.parse(input).find((app) => app.name === "vertexhub-worker");
      process.exit(worker && worker.pm2_env.status === "online" ? 0 : 1);
    });'
}

switch_to() {
  ln -sfn "$1" "$SITE_DIR/current.next" &&
    mv -T "$SITE_DIR/current.next" "$CURRENT" &&
    pm2 startOrReload "$ECOSYSTEM" --update-env >/dev/null &&
    pm2 save >/dev/null
}

# libpq reads the password from the environment of pg_dump/pg_restore only: other users on the
# server can read process arguments (as provision.sh notes), never another user's environment.
load_database_env() {
  set -a
  # shellcheck disable=SC1091
  . "$SHARED/.env"
  set +a
  PGPASSWORD=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).password))')
  export PGPASSWORD
  # The connection string without its password, safe to pass as an argument.
  DATABASE_TARGET=$(node -e 'const u = new URL(process.env.DATABASE_URL); u.password = ""; process.stdout.write(u.href)')
}

if [ "${1:-}" = rollback ]; then
  active=$(readlink -f "$CURRENT")
  # Release names start with a UTC timestamp, so the previous one sorts just before the active one.
  previous=$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort |
    awk -v active="$active" '$0 < active' | tail -1)
  [ -n "$previous" ] || fail "no previous release to roll back to"
  log "rolling back to $(basename "$previous")"
  switch_to "$previous" || fail "PM2 could not start the previous release; check: pm2 logs"
  healthy || fail "previous release is not healthy either; check: pm2 logs"
  log "rolled back to $(basename "$previous")"
  exit 0
fi

if [ "${1:-}" = restore ]; then
  name="${2:-}"
  [[ "$name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]] || fail "usage: deploy.sh restore <release>"
  snapshot="$SHARED/db-snapshots/$name.dump"
  [ -f "$snapshot" ] || fail "no snapshot $snapshot"
  load_database_env
  log "restoring the database from $name (taken before that release migrated)"
  pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_TARGET" "$snapshot"
  log "restored; run a release whose code matches this schema (deploy.sh rollback or a ref)"
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
  # The worker's Chromium for quote PDFs (F04), in ~/.cache/ms-playwright; a no-op when this
  # Playwright version's browser is already there. Its libraries come from provision.sh.
  corepack pnpm --filter @vertex-hub/worker exec playwright install chromium
  # The web build loads the Madani Arabic faces only when their files are on the server.
  MADANI_FONTS_DIR="$SITE_DIR/fonts/madani" corepack pnpm build
)

# A snapshot right before migrating, restorable with pg_restore if a migration goes wrong.
mkdir -p "$SHARED/db-snapshots"
load_database_env
snapshot="$SHARED/db-snapshots/$(basename "$release").dump"
log "database snapshot"
(umask 077 && pg_dump --format=custom --file="$snapshot" --dbname="$DATABASE_TARGET")
ls -1t "$SHARED"/db-snapshots/*.dump 2>/dev/null | tail -n +$((KEEP_DB_SNAPSHOTS + 1)) | xargs -r rm -f

log "migrating"
node "$release/packages/db/dist/cli/migrate.js"
trap - ERR

previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
log "switching to $(basename "$release")"
# The worker must be online too: the API health check does not see it.
if ! { switch_to "$release" && healthy && worker_online; }; then
  log "new release failed to start or its health check"
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    if switch_to "$previous" && healthy; then
      log "restored $(basename "$previous")"
    else
      log "previous release is unhealthy too"
    fi
  fi
  fail "release ${sha:0:7} is not healthy; logs: pm2 logs vertexhub-api --err"
fi

log "pruning old releases"
active=$(readlink -f "$CURRENT")
# grep exits 1 when nothing is left to prune; that is success, not a failed deploy.
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort | head -n -"$KEEP_RELEASES" |
  { grep -v -x "$active" || true; } | xargs -r rm -rf

log "deployed ${sha:0:7}"
