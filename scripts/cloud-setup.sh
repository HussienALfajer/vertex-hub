#!/usr/bin/env bash
# Provisions the VM of a Claude Code cloud environment for Vertex Hub. Paste this file into the
# environment's "Setup script" field (docs/workflow.md, "Cloud sessions"). It runs as root on
# Ubuntu 24.04 before Claude Code starts, and its result is cached as a filesystem snapshot when it
# finishes within about five minutes, so later sessions skip it.
#
# It installs what the image lacks: Node 24 (the image ships 20-22), the PostgreSQL 17 image (the
# image ships 16; CI and production use 17) and Chromium for Playwright. Per-session work (start
# the database, install packages, migrate) is scripts/cloud-session.sh, run by a SessionStart hook.
#
# Network: the environment needs "Trusted" domains plus cdn.playwright.dev and
# playwright.download.prss.microsoft.com (Playwright browser downloads).
set -uo pipefail

NODE_DIR=/opt/node24
PLAYWRIGHT_VERSION=1.63.0 # keep in step with @playwright/test in apps/web/package.json

install_node() {
  [ -x "$NODE_DIR/bin/node" ] && return 0
  local base=https://nodejs.org/dist/latest-v24.x
  local archive
  archive=$(curl -fsSL "$base/SHASUMS256.txt" | grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -1)
  mkdir -p "$NODE_DIR"
  curl -fsSL "$base/$archive" | tar -xJ -C "$NODE_DIR" --strip-components=1
  # pnpm comes from Corepack at the version in package.json ("packageManager").
  PATH="$NODE_DIR/bin:$PATH" corepack enable
}

pull_postgres() {
  if ! docker info >/dev/null 2>&1; then
    (dockerd >/var/log/dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  docker pull -q postgres:17
}

install_chromium() {
  PATH="$NODE_DIR/bin:$PATH" npx -y "playwright@$PLAYWRIGHT_VERSION" install --with-deps chromium
}

install_node || echo "cloud-setup: Node 24 install failed" >&2
pull_postgres &
install_chromium &
wait
exit 0
