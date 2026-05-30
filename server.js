import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const chartPath = path.join(__dirname, "node_modules", "chart.js", "dist", "chart.umd.js");
const hammerPath = path.join(__dirname, "node_modules", "hammerjs", "hammer.min.js");
const chartZoomPath = path.join(
  __dirname,
  "node_modules",
  "chartjs-plugin-zoom",
  "dist",
  "chartjs-plugin-zoom.min.js"
);
const cachePaths = {
  synop: path.join(__dirname, "data", "monthly-temperatures.json"),
  noaa: path.join(__dirname, "data", "noaa-ghcn-france.json")
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("scripts", scriptName)], {
      cwd: __dirname,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} failed with exit code ${code}`));
    });
  });
}

const cacheBuilders = {
  synop: "build-cache.js",
  noaa: "update-noaa-ghcn.js"
};
const cacheReady = new Map();

async function rebuildSource(source) {
  cacheReady.set(source, runScript(cacheBuilders[source]));
  await cacheReady.get(source);
}

async function ensureCache(source) {
  const cachePath = cachePaths[source];
  if (!cachePath) throw new Error(`Unknown data source: ${source}`);
  if (existsSync(cachePath)) return cachePath;

  if (!cacheReady.has(source)) {
    cacheReady.set(source, runScript(cacheBuilders[source]));
  }
  await cacheReady.get(source);
  return cachePath;
}

async function serveStatic(request, response, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, requestPath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store, max-age=0"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/temperatures") {
      const source = url.searchParams.get("source") === "noaa" ? "noaa" : "synop";
      const cachePath = await ensureCache(source);
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      });
      createReadStream(cachePath).pipe(response);
      return;
    }

    if (url.pathname === "/api/rebuild") {
      const sourceParam = url.searchParams.get("source");
      if (sourceParam === "all") {
        await rebuildSource("synop");
        await rebuildSource("noaa");
        sendJson(response, 200, { ok: true, source: "all" });
        return;
      }

      const source = sourceParam === "noaa" ? "noaa" : "synop";
      await rebuildSource(source);
      sendJson(response, 200, { ok: true, source });
      return;
    }

    if (url.pathname === "/vendor/chart.umd.js") {
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      });
      createReadStream(chartPath).pipe(response);
      return;
    }

    if (url.pathname === "/vendor/hammer.min.js") {
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      });
      createReadStream(hammerPath).pipe(response);
      return;
    }

    if (url.pathname === "/vendor/chartjs-plugin-zoom.min.js") {
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, max-age=0"
      });
      createReadStream(chartZoomPath).pipe(response);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Meteo SYNOP dashboard: http://localhost:${port}`);
});
