import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const baseUrl = "https://object.files.data.gouv.fr/meteofrance/data/synchro_ftp/OBS/SYNOP";
const downloadTimeoutMs = Number(process.env.SYNOP_DOWNLOAD_TIMEOUT_MS) || 10 * 60 * 1000;

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

async function downloadYear(year) {
  const url = `${baseUrl}/synop_${year}.csv.gz`;
  const targetPath = path.join(rootDir, `synop_${year}.csv`);
  const tmpPath = path.join(rootDir, `synop_${year}.csv.tmp`);

  console.log(`[synop] Downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`Download failed for ${url}: empty response body`);
  }

  await rm(tmpPath, { force: true });
  await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(tmpPath));

  const downloaded = await stat(tmpPath);
  if (downloaded.size === 0) {
    await rm(tmpPath, { force: true });
    throw new Error(`Downloaded ${url} but decompressed file is empty`);
  }

  await rename(tmpPath, targetPath);
  console.log(`[synop] Updated ${path.relative(rootDir, targetPath)} (${downloaded.size} bytes)`);
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
