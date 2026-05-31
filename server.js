import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");
const liveReloadEnabled = process.env.NODE_ENV !== "production";
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

const liveReloadClients = new Set();
const liveReloadFiles = ["index.html", "app.js", "styles.css"].map((fileName) =>
  path.join(publicDir, fileName)
);
const liveReloadScript = `
<script>
(() => {
  const events = new EventSource("/__live-reload");
  events.addEventListener("reload", () => window.location.reload());
})();
</script>`;

let liveReloadTimer = null;
function broadcastLiveReload() {
  clearTimeout(liveReloadTimer);
  liveReloadTimer = setTimeout(() => {
    for (const response of liveReloadClients) {
      response.write("event: reload\ndata: now\n\n");
    }
  }, 80);
}

let liveReloadSnapshot = new Map();
async function snapshotLiveReloadFiles() {
  const snapshot = new Map();
  for (const filePath of liveReloadFiles) {
    try {
      const fileStat = await stat(filePath);
      snapshot.set(filePath, `${fileStat.mtimeMs}:${fileStat.size}`);
    } catch {
      snapshot.set(filePath, "missing");
    }
  }
  return snapshot;
}

async function pollLiveReloadFiles() {
  const nextSnapshot = await snapshotLiveReloadFiles();
  for (const [filePath, signature] of nextSnapshot) {
    if (liveReloadSnapshot.get(filePath) !== signature) {
      liveReloadSnapshot = nextSnapshot;
      broadcastLiveReload();
      return;
    }
  }
}

if (liveReloadEnabled) {
  liveReloadSnapshot = await snapshotLiveReloadFiles();
  setInterval(() => {
    pollLiveReloadFiles().catch((error) => {
      console.warn(`[live-reload] ${error.message}`);
    });
  }, 400).unref();
}

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
    if (liveReloadEnabled && requestPath === "/index.html") {
      const html = await readFile(filePath, "utf8");
      response.writeHead(200, {
        "Content-Type": mimeTypes[extension],
        "Cache-Control": "no-store, max-age=0"
      });
      response.end(html.replace("</body>", `${liveReloadScript}\n</body>`));
      return;
    }

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

    if (liveReloadEnabled && url.pathname === "/__live-reload") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        Connection: "keep-alive"
      });
      response.write(": connected\n\n");
      liveReloadClients.add(response);
      request.on("close", () => liveReloadClients.delete(response));
      return;
    }

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
