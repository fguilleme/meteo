#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

install -m 0644 "${ROOT_DIR}/deploy/systemd/meteo.service" "${SYSTEMD_DIR}/meteo.service"
install -m 0644 "${ROOT_DIR}/deploy/systemd/meteo-update.service" "${SYSTEMD_DIR}/meteo-update.service"
install -m 0644 "${ROOT_DIR}/deploy/systemd/meteo-update.timer" "${SYSTEMD_DIR}/meteo-update.timer"

systemctl daemon-reload
systemctl enable --now meteo.service
systemctl enable --now meteo-update.timer

systemctl --no-pager status meteo.service
systemctl --no-pager list-timers meteo-update.timer
