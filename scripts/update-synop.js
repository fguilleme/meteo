import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const datasetApiUrl =
  process.env.SYNOP_DATASET_API_URL ||
  "https://www.data.gouv.fr/api/1/datasets/archive-synop-omm/";
const downloadTimeoutMs = Number(process.env.SYNOP_DOWNLOAD_TIMEOUT_MS) || 10 * 60 * 1000;
const maxDataAgeHours = Number(process.env.SYNOP_MAX_DATA_AGE_HOURS) || 72;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    year: Number(process.env.SYNOP_YEAR) || new Date().getFullYear()
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--year") {
      options.year = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--year=")) {
      options.year = Number(arg.slice("--year=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.year) || options.year < 1996 || options.year > 2100) {
    throw new Error(`Invalid SYNOP year: ${options.year}`);
  }

  return options;
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function resolveDownloadUrl(year) {
  if (process.env.SYNOP_BASE_URL) {
    return `${process.env.SYNOP_BASE_URL.replace(/\/$/, "")}/synop_${year}.csv.gz`;
  }

  console.log(`[synop] Resolving synop_${year} from ${datasetApiUrl}`);
  const response = await fetch(datasetApiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(downloadTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(
      `Dataset lookup failed for ${datasetApiUrl}: ${response.status} ${response.statusText}`
    );
  }

  const dataset = await response.json();
  const expectedTitle = `synop_${year}`;
  const resource = dataset.resources?.find(
    (candidate) => candidate.title === expectedTitle || candidate.name === expectedTitle
  );
  if (!resource?.url) {
    throw new Error(`Resource ${expectedTitle} not found in ${datasetApiUrl}`);
  }

  return resource.url;
}

async function validateDownloadedYear(filePath, year) {
  const lines = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity
  });
  let validityTimeIndex = -1;
  let latestValidityTime = null;

  for await (const line of lines) {
    if (validityTimeIndex === -1) {
      validityTimeIndex = line.replace(/^\uFEFF/, "").split(";").indexOf("validity_time");
      if (validityTimeIndex === -1) {
        throw new Error("Downloaded SYNOP file has no validity_time column");
      }
      continue;
    }

    const validityTime = line.split(";")[validityTimeIndex];
    if (validityTime?.startsWith(`${year}-`) && validityTime > (latestValidityTime || "")) {
      latestValidityTime = validityTime;
    }
  }

  if (!latestValidityTime) {
    throw new Error(`Downloaded SYNOP file contains no observations for ${year}`);
  }

  const currentYear = new Date().getUTCFullYear();
  if (year === currentYear) {
    const ageHours = (Date.now() - Date.parse(latestValidityTime)) / (60 * 60 * 1000);
    if (!Number.isFinite(ageHours) || ageHours > maxDataAgeHours) {
      throw new Error(
        `Downloaded SYNOP data is stale: latest observation is ${latestValidityTime} ` +
          `(${ageHours.toFixed(1)} hours old, maximum ${maxDataAgeHours})`
      );
    }
  }

  console.log(`[synop] Latest observation: ${latestValidityTime}`);
}

async function downloadYear(year) {
  const url = await resolveDownloadUrl(year);
  const targetPath = path.join(rootDir, `synop_${year}.csv`);
  const tmpPath = path.join(rootDir, `synop_${year}.csv.tmp`);

  await rm(tmpPath, { force: true });
  try {
    console.log(`[synop] Downloading ${url}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
    if (!response.ok) {
      throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error(`Download failed for ${url}: empty response body`);
    }

    await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(tmpPath));

    const downloaded = await stat(tmpPath);
    if (downloaded.size === 0) {
      throw new Error(`Downloaded ${url} but decompressed file is empty`);
    }

    await validateDownloadedYear(tmpPath, year);
    await rename(tmpPath, targetPath);
    console.log(`[synop] Updated ${path.relative(rootDir, targetPath)} (${downloaded.size} bytes)`);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

async function main() {
  const { year } = parseArgs();
  await mkdir(path.join(rootDir, "data"), { recursive: true });
  await downloadYear(year);
  await runNodeScript(path.join(rootDir, "scripts", "build-cache.js"));
}

main().catch(async (error) => {
  console.error(`[synop] ${error.stack || error.message}`);
  process.exitCode = 1;
});
