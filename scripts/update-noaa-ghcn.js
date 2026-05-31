import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDeseasonalizedValues } from "./seasonality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const noaaDir = path.join(rootDir, "data", "noaa");
const outputPath = path.join(rootDir, "data", "noaa-ghcn-france.json");
const baseUrl = "https://www.ncei.noaa.gov/pub/data/ghcn/daily";
const currentYear = new Date().getFullYear();

function parseArgs() {
  const options = {
    startYear: Number(process.env.NOAA_START_YEAR) || 1920,
    endYear: Number(process.env.NOAA_END_YEAR) || currentYear - 1,
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--start-year") {
      options.startYear = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--end-year") {
      options.endYear = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--start-year=")) {
      options.startYear = Number(arg.slice("--start-year=".length));
      continue;
    }
    if (arg.startsWith("--end-year=")) {
      options.endYear = Number(arg.slice("--end-year=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.startYear) || options.startYear < 1800) {
    throw new Error(`Invalid NOAA_START_YEAR: ${options.startYear}`);
  }
  if (!Number.isInteger(options.endYear) || options.endYear < options.startYear) {
    throw new Error(`Invalid NOAA_END_YEAR: ${options.endYear}`);
  }

  return options;
}

async function download(url, targetPath) {
  const tmpPath = `${targetPath}.tmp`;
  console.log(`[noaa] Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }

  await rm(tmpPath, { force: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath));
  await rename(tmpPath, targetPath);
}

async function downloadMetadata() {
  await mkdir(noaaDir, { recursive: true });
  const files = ["ghcnd-stations.txt", "ghcnd-inventory.txt"];
  for (const file of files) {
    await download(`${baseUrl}/${file}`, path.join(noaaDir, file));
  }
}

function parseStations(text) {
  const stations = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith("FR")) continue;
    const id = line.slice(0, 11);
    stations.set(id, {
      id,
      lat: Number(line.slice(12, 20)),
      lon: Number(line.slice(21, 30)),
      elevation: Number(line.slice(31, 37)),
      name: line.slice(41, 71).trim(),
    });
  }
  return stations;
}

function parseInventory(text) {
  const inventory = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith("FR")) continue;
    const element = line.slice(31, 35);
    if (element !== "TMIN" && element !== "TMAX") continue;

    const id = line.slice(0, 11);
    const item = inventory.get(id) ?? {};
    item[element] = {
      first: Number(line.slice(36, 40)),
      last: Number(line.slice(41, 45)),
    };
    inventory.set(id, item);
  }
  return inventory;
}

function selectStations(stations, inventory, options) {
  const selected = [];
  for (const [id, item] of inventory) {
    if (!item.TMIN || !item.TMAX || !stations.has(id)) continue;
    const first = Math.max(item.TMIN.first, item.TMAX.first);
    const last = Math.min(item.TMIN.last, item.TMAX.last);
    if (first > options.startYear || last < options.endYear) continue;
    selected.push({
      ...stations.get(id),
      firstYear: first,
      lastYear: last,
    });
  }

  return selected.sort((a, b) => a.firstYear - b.firstYear || a.name.localeCompare(b.name));
}

function parseDailyFile(text) {
  const days = new Map();

  for (const line of text.split("\n")) {
    if (!line) continue;
    const year = Number(line.slice(11, 15));
    const month = Number(line.slice(15, 17));
    const element = line.slice(17, 21);
    if (element !== "TMIN" && element !== "TMAX") continue;

    for (let day = 1; day <= 31; day += 1) {
      const offset = 21 + (day - 1) * 8;
      const rawValue = Number(line.slice(offset, offset + 5));
      const qualityFlag = line.slice(offset + 6, offset + 7);
      if (rawValue === -9999 || qualityFlag.trim()) continue;

      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) continue;

      const label = date.toISOString().slice(0, 10);
      const record = days.get(label) ?? { label };
      record[element === "TMIN" ? "min" : "max"] = Number((rawValue / 10).toFixed(1));
      days.set(label, record);
    }
  }

  return [...days.values()]
    .filter((day) => Number.isFinite(day.min) && Number.isFinite(day.max))
    .map((day) => ({
      ...day,
      avg: Number(((day.min + day.max) / 2).toFixed(2)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function monthlySeries(dailySeries) {
  const buckets = new Map();
  for (const day of dailySeries) {
    const label = day.label.slice(0, 7);
    const bucket = buckets.get(label) ?? {
      label,
      min: Infinity,
      max: -Infinity,
      sum: 0,
      count: 0,
      minDate: day.label,
      maxDate: day.label,
    };

    if (day.min < bucket.min) {
      bucket.min = day.min;
      bucket.minDate = day.label;
    }
    if (day.max > bucket.max) {
      bucket.max = day.max;
      bucket.maxDate = day.label;
    }
    bucket.sum += day.avg;
    bucket.count += 1;
    buckets.set(label, bucket);
  }

  return [...buckets.values()].map((bucket) => ({
    label: bucket.label,
    min: bucket.min,
    avg: Number((bucket.sum / bucket.count).toFixed(2)),
    max: bucket.max,
    minDate: bucket.minDate,
    maxDate: bucket.maxDate,
    count: bucket.count,
  }));
}

async function main() {
  const options = parseArgs();
  await downloadMetadata();

  const stations = parseStations(await readFile(path.join(noaaDir, "ghcnd-stations.txt"), "utf8"));
  const inventory = parseInventory(await readFile(path.join(noaaDir, "ghcnd-inventory.txt"), "utf8"));
  const selected = selectStations(stations, inventory, options);

  console.log(`[noaa] Selected ${selected.length} French stations with TMIN/TMAX ${options.startYear}-${options.endYear}`);
  const cities = [];
  for (const station of selected) {
    const stationPath = path.join(noaaDir, `${station.id}.dly`);
    await download(`${baseUrl}/all/${station.id}.dly`, stationPath);
    const dailySeries = parseDailyFile(await readFile(stationPath, "utf8"));
    const series = monthlySeries(dailySeries);
    addDeseasonalizedValues(series, 25, {
      stl: { trendSpan: 25, seasonalSpan: 21, iterations: 3 }
    });
    addDeseasonalizedValues(dailySeries, 365);
    cities.push({
      code: station.id,
      city: station.name,
      station: station.name,
      lat: station.lat,
      lon: station.lon,
      elevation: station.elevation,
      firstYear: station.firstYear,
      lastYear: station.lastYear,
      series,
      dailySeries,
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "NOAA GHCN-Daily",
    sourceUrl: baseUrl,
    unit: "celsius",
    granularity: "month+day",
    metric: "GHCN-Daily TMIN/TMAX in tenths of degrees C, quality-flagged values excluded; deseasonalized fields remove annual harmonic seasonality; monthly STL fields use robust LOESS decomposition",
    seasonalityModel: "annual harmonic regression with two harmonics and a 25-month centered trend smoother; monthly STL uses robust local linear LOESS by month-of-year with the same 25-month centered trend smoother",
    selection: {
      country: "FR",
      startYear: options.startYear,
      endYear: options.endYear,
    },
    cities,
  };

  await writeFile(`${outputPath}.tmp`, JSON.stringify(payload), "utf8");
  await rename(`${outputPath}.tmp`, outputPath);
  console.log(`[noaa] Wrote ${path.relative(rootDir, outputPath)}`);
}

main().catch((error) => {
  console.error(`[noaa] ${error.stack || error.message}`);
  process.exitCode = 1;
});
