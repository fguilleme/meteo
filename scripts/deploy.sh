#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${REMOTE:-root@2.24.11.61}"
REMOTE_DIR="${REMOTE_DIR:-/opt/meteo}"

echo "[deploy] Target: ${REMOTE}:${REMOTE_DIR}"

ssh "${REMOTE}" "mkdir -p '${REMOTE_DIR}'"

rsync -az --progress \
  --exclude ".git/" \
  --exclude "node_modules/" \
  --exclude "data/noaa/" \
  --exclude "logs/" \
  --exclude "*.tmp" \
  "${ROOT_DIR}/" \
  "${REMOTE}:${REMOTE_DIR}/"

echo "[deploy] Done."
echo "[deploy] Installing dependencies and restarting systemd service"
ssh "${REMOTE}" "cd '${REMOTE_DIR}' && npm install --omit=dev && npm run install:systemd"
echo "[deploy] Service restarted."
