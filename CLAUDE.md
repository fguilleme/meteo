# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — serve dashboard on `PORT` (default 3000).
- `npm run dev:watch` — same, with Node `--watch` on `server.js` + `scripts/`. Browser auto-reloads via SSE (`/__live-reload`) when `public/index.html`, `public/app.js`, or `public/styles.css` change. Live-reload disabled when `NODE_ENV=production`.
- `npm run build:data` — rebuild SYNOP cache (`scripts/build-cache.js`) from `synop_YYYY.csv` files at repo root. Re-runs all years; no incremental.
- `npm run update:data` — download `synop_YYYY.csv.gz` from data.gouv into repo root, then rebuild SYNOP cache. Defaults to current year. Override: `node scripts/update-synop.js --year 2024` or `SYNOP_YEAR=2024`.
- `npm run update:noaa` — download GHCN-Daily station metadata + per-station `.dly` files into `data/noaa/`, then build NOAA cache. Override years with `--start-year` / `--end-year` or `NOAA_START_YEAR` / `NOAA_END_YEAR` (default 1920 → current-1).
- `npm run update:all` — both updates sequentially. Runs daily on prod via `meteo-update.timer`.
- `npm run deploy` — rsync repo to `${REMOTE:-root@2.24.11.61}:${REMOTE_DIR:-/opt/meteo}`, `npm install --omit=dev`, re-install systemd units. Excludes `data/noaa/` (large, rebuilt on server).
- `npm run install:systemd` — install `meteo.service` + `meteo-update.timer` into `/etc/systemd/system`. Run as root on target.

No tests, no linter.

## Architecture

Single Node `http` server (`server.js`) + static frontend in `public/`. No framework, no bundler. Vanilla ES modules server-side, plain `<script>` tags client-side with Chart.js + chartjs-plugin-zoom + hammerjs served from `node_modules` under `/vendor/*`.

### Data pipeline (two independent sources)

Both sources produce the same cache shape, consumed by the same frontend.

1. **SYNOP** (`scripts/build-cache.js`) — reads `synop_YYYY.csv` (semicolon-separated Meteo France hourly observations) at repo root. Hard-coded list of 24 French station codes. Aggregates the Kelvin `t` column (index 13) into per-station monthly + daily min/avg/max with min/max timestamps. Output: `data/monthly-temperatures.json`.
2. **NOAA GHCN-Daily** (`scripts/update-noaa-ghcn.js`) — downloads `ghcnd-stations.txt` + `ghcnd-inventory.txt`, filters `FR*` stations with both TMIN+TMAX spanning the requested year range, fetches per-station `.dly` files, parses fixed-width records, aggregates daily → monthly. Output: `data/noaa-ghcn-france.json`.

After aggregation, each city's `series` (monthly) and `dailySeries` get deseasonalization fields via `scripts/seasonality.js`:
- **Harmonic** — least-squares fit of 2-harmonic annual model + 25-month centered rolling trend. Fields: `{metric}Seasonal`, `{metric}Deseasonalized`, `{metric}DeseasonalizedTrend`.
- **STL** (monthly only) — robust LOESS decomposition (local-linear seasonal LOESS by month-of-year + LOESS trend, with biweight residual reweighting). Fields: `{metric}Stl{Seasonal,Deseasonalized,DeseasonalizedTrend}`. Frontend toggles which is shown.

### Cache fanout (`scripts/cache-output.js`)

`writePayloadFiles(outputPath, payload)` writes three artifacts atomically (write to `.tmp`, rename):
- `<name>.json` — full payload (monthly + daily for all cities).
- `<name>.summary.json` — same payload with `dailySeries` stripped, replaced by `dailyCount`. Frontend loads this first.
- `<name>.daily/<urlencoded-code>.json` — one file per city's daily series, fetched on demand.

The server (`server.js`) serves these via:
- `GET /api/temperatures?source=synop|noaa&summary=1` → summary cache
- `GET /api/temperatures?source=synop|noaa` → full cache
- `GET /api/daily?source=synop|noaa&code=<code>` → single-city daily cache
- `POST /api/rebuild?source=synop|noaa|all` → runs the rebuild script

`ensureCache`/`ensureSummaryCache`/`ensureDailyCache` auto-build the full JSON if missing, then regenerate summary/daily files if their mtime is older than the full cache. So editing `monthly-temperatures.json` directly is enough to trigger refresh of derived files on next request.

### Frontend (`public/app.js`)

Single 2200-line module holding all state in a `state` object. Renders one Chart.js line chart with custom pan/zoom (hammerjs + chartjs-plugin-zoom + manual mouse handlers). Loads summary cache for the source, then lazy-loads per-station daily series via `/api/daily` on selection. Daily series are dropped into `state.dailySeriesLoads` to avoid double-fetch.

Source toggle (SYNOP vs NOAA), seasonality method (STL vs harmonic), anomaly mode, and climate model overlay (trend / solar 11a / 22a / multidecadal / Milanković components) are independent UI toggles that recompute visible datasets without re-fetching.

### Deploy

Production target is `/opt/meteo` on the remote box defined in `scripts/deploy.sh`. `meteo.service` runs `npm start` under `NODE_ENV=production` (no live-reload). `meteo-update.timer` triggers `npm run update:all` daily at 07:30 with up to 20 min jitter.
