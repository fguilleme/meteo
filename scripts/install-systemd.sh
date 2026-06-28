#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${SYSTEMD_DIR:-/home/francois/.config/systemd/user}"

install -m 0644 "${ROOT_DIR}/deploy/systemd/meteo.service" "${SYSTEMD_DIR}/meteo.service"
install -m 0644 "${ROOT_DIR}/deploy/systemd/meteo-update.service" "${SYSTEMD_DIR}/meteo-update.service"
install -m 0644 "${ROOT_DIR}/deploy/systemd/meteo-update.timer" "${SYSTEMD_DIR}/meteo-update.timer"

systemctl --user daemon-reload
systemctl --user enable meteo.service
systemctl --user restart meteo.service
systemctl --user enable --now meteo-update.timer

systemctl --user --no-pager status meteo.service
systemctl --user --no-pager list-timers meteo-update.timer
