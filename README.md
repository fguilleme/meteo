# Meteo SYNOP/NOAA France

Self-hosted dashboard that visualizes monthly and daily temperature history for French weather stations, sourced from two independent datasets:

- **SYNOP** — Meteo France hourly observations (`synop_YYYY.csv` from data.gouv), 24 hard-coded stations from 1996 to today.
- **NOAA GHCN-Daily** — TMIN/TMAX records for French stations going back as far as 1900 (Le Bourget) or 1901 (Perpignan, Bordeaux).

Both sources feed the same UI: a Chart.js line chart with min / avg / max curves, climatology overlays, deseasonalized series (harmonic + STL), an anomaly mode, and an exogenous climate-model overlay (trend, solar 11/22 a, multidecadal, Milanković).

## Stack

- Node.js HTTP server (`server.js`) — no framework, no bundler.
- Vanilla ES module frontend (`public/`), Chart.js + chartjs-plugin-zoom + hammerjs served from `node_modules` under `/vendor/*`.
- Aggregation in `scripts/` (CSV/text parsers, harmonic + STL seasonal decomposition).
- Atomic JSON cache fanout: full payload, summary (no daily), per-city daily files.

## Run

```sh
npm install
npm start                # PORT defaults to 3000
npm run dev:watch        # auto-reload server + browser on file change
```

The server lazily builds the cache on first request if missing.

## Update data

```sh
npm run update:data      # download current-year SYNOP CSV + rebuild SYNOP cache
npm run update:noaa      # refresh NOAA GHCN station metadata + .dly files + rebuild NOAA cache
npm run update:all       # both
```

Overrides:

- `--year 2024` or `SYNOP_YEAR=2024` for `update:data`.
- `--start-year` / `--end-year` (or `NOAA_START_YEAR` / `NOAA_END_YEAR`) for the modern selection tier of `update:noaa` (default 1920 → currentYear).
- `--legacy-start-year` / `--legacy-end-year` (or `NOAA_LEGACY_START_YEAR` / `NOAA_LEGACY_END_YEAR`) for the legacy tier — stations starting very early are kept even if their reporting stopped a few years ago (default 1910 / `currentYear - 5`).

Cache files live under `data/`; `data/noaa/` (station metadata + .dly raw files) is gitignored.

## API

- `GET /api/temperatures?source=synop|noaa[&summary=1]` — full cache or summary (daily series stripped).
- `GET /api/daily?source=synop|noaa&code=<station>` — single-station daily series.
- `POST /api/rebuild?source=synop|noaa|all` — re-runs the build script (deduped if already running).

## Deploy

```sh
npm run deploy           # rsync to ${REMOTE:-root@2.24.11.61}:${REMOTE_DIR:-/opt/meteo}
```

Server side: systemd units in `deploy/systemd/`. `npm run install:systemd` (as root, on the target) installs `meteo.service` plus `meteo-update.timer` that runs `npm run update:all` daily at 07:30 with up to 20 minutes of jitter.

## Layout

```
server.js                  HTTP server, live reload, cache fanout endpoints
scripts/build-cache.js     SYNOP CSV -> data/monthly-temperatures.json
scripts/update-synop.js    download synop_YYYY.csv.gz then build-cache
scripts/update-noaa-ghcn.js download GHCN station files then build NOAA cache
scripts/cache-output.js    atomic write of full / summary / per-city daily caches
scripts/seasonality.js     harmonic fit + STL decomposition (LOESS, robust weights)
public/index.html          single page, no framework
public/app.js              chart, range controls, zoom, pan, anomaly mode
public/styles.css          theme + responsive layout
deploy/systemd/            production unit files
```
