#!/usr/bin/env bash
# Prepares a Claude Code cloud session: Node 24 on PATH, PostgreSQL 17 running, packages installed,
# `.env` with the dev and test databases, migrations applied. Run by the SessionStart hook in
# .claude/settings.json on every start and resume; it does nothing outside cloud sessions.
# The VM itself is provisioned once by the environment's setup script: the shared `vertex` one, a
# superset of scripts/cloud-setup.sh. It reuses a PostgreSQL other repositories in the VM started.
#
# Standard output reaches Claude's context, so it prints a short status only; details go to the log.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0
LOG=/tmp/vertex-hub-cloud-session.log
NODE_DIR=/opt/node24
CONTAINER=vertex-hub-postgres
status=()
problems=()

SUDO=
[ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO=sudo

# Node 24 from the setup script; the image's default is 22.
if [ -x "$NODE_DIR/bin/node" ]; then
  export PATH="$NODE_DIR/bin:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
else
  problems+=("Node 24 missing at $NODE_DIR: the environment's setup script did not run (see docs/workflow.md)")
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0" >>"$CLAUDE_ENV_FILE"
status+=("node $(node --version 2>/dev/null)")

# Chromium for the worker's PDF tests and E2E: keep a path the environment already set (the shared
# `vertex` environment installs browsers in /opt/ms-playwright) and hand it to Claude's commands.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
[ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PLAYWRIGHT_BROWSERS_PATH=\"$PLAYWRIGHT_BROWSERS_PATH\"" >>"$CLAUDE_ENV_FILE"

# PostgreSQL 17 in Docker, as in CI; the image's PostgreSQL 16 service is the fallback.
start_docker_postgres() {
  if ! $SUDO docker info >/dev/null 2>&1; then
    # A resumed VM keeps dockerd's pid file for its managed containerd; when that pid now belongs to
    # another process, dockerd waits for it and gives up, so drop the file unless containerd owns it.
    local pidfile=/var/run/docker/containerd/containerd.pid
    if [ -f "$pidfile" ] && ! ps -p "$(cat "$pidfile")" -o comm= 2>/dev/null | grep -q containerd; then
      $SUDO rm -f "$pidfile"
    fi
    ($SUDO dockerd >/tmp/dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do $SUDO docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  $SUDO docker start "$CONTAINER" >/dev/null 2>&1 ||
    $SUDO docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:17 >/dev/null ||
    return 1
  for _ in $(seq 1 30); do
    $SUDO docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

start_service_postgres() {
  $SUDO service postgresql start >/dev/null 2>&1 || return 1
  for _ in $(seq 1 30); do pg_isready -h localhost >/dev/null 2>&1 && break; sleep 1; done
  $SUDO su postgres -c "psql -qc \"ALTER USER postgres PASSWORD 'postgres'\"" >/dev/null
}

pg_answers() {
  command -v pg_isready >/dev/null && pg_isready -q -h 127.0.0.1 -p 5432
}

# The shared `vertex` environment may already run one server for every repository in the VM
# (`vertex-session` starts `vertex-postgres`, postgres/postgres): reuse it instead of a second one.
if pg_answers; then
  version=$(PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -tAc 'SHOW server_version' 2>>"$LOG")
  status+=("postgres ${version%% *} (already running on 127.0.0.1:5432)")
  case "$version" in
    17*) ;;
    *) problems+=("the PostgreSQL already on 127.0.0.1:5432 is ${version:-unreachable as postgres/postgres}, while CI and production use 17") ;;
  esac
elif start_docker_postgres >>"$LOG" 2>&1; then
  status+=("postgres 17 (docker)")
elif start_service_postgres >>"$LOG" 2>&1; then
  status+=("postgres 16 (fallback service)")
  problems+=("PostgreSQL 17 did not start in Docker; using the image's PostgreSQL 16, while CI and production use 17")
else
  problems+=("PostgreSQL did not start; see $LOG")
fi

run() {
  local label=$1
  shift
  if "$@" >>"$LOG" 2>&1; then status+=("$label"); else problems+=("$label failed; see $LOG"); fi
}

run "packages installed" pnpm install --frozen-lockfile
# Creates .env from .env.example with a random password, then the role and both databases.
run "dev and test databases" env PGPASSWORD=postgres node scripts/setup-local-db.mjs
run "dev database migrated" pnpm db:migrate
# A no-op when the setup script already installed this Playwright version's Chromium.
run "playwright chromium" pnpm --filter @vertex-hub/web exec playwright install chromium

summary=$(printf '%s, ' "${status[@]}")
echo "Cloud session ready: ${summary%, }."
if [ ${#problems[@]} -gt 0 ]; then
  echo "Cloud session problems (tell the owner before running checks):"
  printf -- '- %s\n' "${problems[@]}"
fi
exit 0
