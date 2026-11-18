// Measures what a cold visit costs over a built dist/: requests and transferred bytes for the
// first load of /, then opening a planted thread from the sidebar, then opening Settings; and the
// time until the composer is visible on first load. Each run is a fresh browser (cold cache).
//
// The server speaks HTTP/2 over TLS with brotli, like the CDN the mock deploys to, so a request
// costs what it costs there rather than queueing behind HTTP/1.1's six connections. The network
// is throttled to a fixed profile (default 40 ms RTT, 50 Mbit/s down) so timings mean something
// on a laptop; set MEASURE_THROTTLE=0 to turn that off.
//
// The first run is a warm-up for the server's compression cache and is not counted.
//
// Usage: node scripts/measure-load.mjs [distDir] [--runs 3] [--json out.json] [--shots dir]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createSecureServer } from "node:http2";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { brotliCompressSync, constants as zlib } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
};
const runs = Math.max(1, Number(option("--runs") ?? 3));
const jsonOut = option("--json");
const shotsDir = option("--shots");
const dist = resolve(root, args[0] ?? "dist");
const throttle = process.env.MEASURE_THROTTLE !== "0";

const require = createRequire(resolve(root, "upstream/apps/web/package.json"));
const { chromium } = require("playwright");

// A throwaway self-signed certificate, kept in the gitignored docs.local/.
const certDir = resolve(root, "docs.local/measure-cert");
if (!existsSync(join(certDir, "cert.pem"))) {
  mkdirSync(certDir, { recursive: true });
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-subj", "/CN=localhost",
    "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"),
  ], { stdio: "ignore" });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};
// What a CDN compresses: text, plus the binary formats that are not compressed already.
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".webmanifest", ".wasm", ".ttf", ".otf", ".txt", ".glb", ".ico"]);
const encoded = new Map();
function body(file) {
  let entry = encoded.get(file);
  if (!entry) {
    const raw = readFileSync(file);
    entry = COMPRESSIBLE.has(extname(file))
      ? { data: brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }), br: true }
      : { data: raw, br: false };
    encoded.set(file, entry);
  }
  return entry;
}

const fallback = existsSync(join(dist, "404.html")) ? join(dist, "404.html") : join(dist, "index.html");
const server = createSecureServer({
  key: readFileSync(join(certDir, "key.pem")),
  cert: readFileSync(join(certDir, "cert.pem")),
  allowHTTP1: true,
});
server.on("request", (request, response) => {
  const url = new URL(request.url ?? "/", "https://localhost");
  const path = normalize(join(dist, decodeURIComponent(url.pathname)));
  let file = path.startsWith(dist) && existsSync(path) && statSync(path).isFile() ? path : null;
  if (file === null && extname(url.pathname) !== "" && !url.pathname.endsWith(".html")) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }
  file ??= fallback;
  const { data, br } = body(file);
  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
    ...(br ? { "content-encoding": "br" } : {}),
    "content-length": String(data.length),
  });
  response.end(data);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `https://localhost:${server.address().port}`;

const median = (values) => {
  const sorted = [...values].toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Waits until no request has started or finished for `quiet` ms (or `limit` ms pass). */
async function settle(state, quiet = 1500, limit = 30_000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    if (state.inflight === 0 && Date.now() - state.lastActivity >= quiet) return;
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function run(index) {
  const browser = await chromium.launch({ args: ["--ignore-certificate-errors"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", ignoreHTTPSErrors: true });
  // The time the composer first shows, read by the page itself on each animation frame.
  await context.addInitScript(() => {
    const check = () => {
      const editor = document.querySelector('[contenteditable="true"]');
      if (editor && editor.getBoundingClientRect().height > 0) {
        window.__composerVisibleAt = performance.now();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  if (throttle) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (50 * 1024 * 1024) / 8,
      uploadThroughput: (10 * 1024 * 1024) / 8,
    });
  }
  const state = { inflight: 0, lastActivity: Date.now(), phase: "first", phases: {} };
  const requests = new Map();
  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.request.url.startsWith("data:") || event.request.url.startsWith("blob:")) return;
    requests.set(event.requestId, state.phase);
    if (process.env.MEASURE_LIST) console.log(`  ${state.phase} ${event.request.url.replace(origin, "")}`);
    state.inflight += 1;
    state.lastActivity = Date.now();
  });
  const finish = (event, bytes) => {
    const phase = requests.get(event.requestId);
    if (phase === undefined) return;
    requests.delete(event.requestId);
    state.inflight -= 1;
    state.lastActivity = Date.now();
    const entry = (state.phases[phase] ??= { requests: 0, bytes: 0 });
    entry.requests += 1;
    entry.bytes += bytes;
  };
  cdp.on("Network.loadingFinished", (event) => finish(event, event.encodedDataLength));
  cdp.on("Network.loadingFailed", (event) => finish(event, 0));

  await page.goto(origin + "/");
  await page.waitForFunction(() => window.__composerVisibleAt !== undefined, null, { timeout: 60_000 });
  const composerMs = await page.evaluate(() => window.__composerVisibleAt);
  await settle(state);
  if (shotsDir && index === 0) await page.screenshot({ path: resolve(shotsDir, "first-load.png") });

  state.phase = "thread";
  // A finished conversation with a diff and a code block, so highlighting has work to do.
  await page.getByText("Debounce the search box on the notes list", { exact: false }).first().click();
  await page.getByText("180 ms", { exact: false }).first().waitFor({ timeout: 30_000 });
  await settle(state);
  if (shotsDir && index === 0) await page.screenshot({ path: resolve(shotsDir, "thread.png") });

  state.phase = "settings";
  // The gear at the bottom of the sidebar opens the floating settings panel.
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("dialog").first().waitFor({ timeout: 30_000 });
  await settle(state);
  if (shotsDir && index === 0) await page.screenshot({ path: resolve(shotsDir, "settings.png") });

  await browser.close();
  return { composerMs, ...state.phases };
}

if (shotsDir) mkdirSync(resolve(root, shotsDir), { recursive: true });
// One uncounted run first, so the server's brotli cache is warm and no run pays for compression.
await run(-1);
const results = [];
for (let index = 0; index < runs; index += 1) {
  const result = await run(index);
  results.push(result);
  console.log(`run ${index + 1}: ${JSON.stringify(result)}`);
}
server.close();

const summary = { dist, runs, throttle, composerMs: Math.round(median(results.map((r) => r.composerMs))) };
for (const phase of ["first", "thread", "settings"]) {
  summary[phase] = {
    requests: median(results.map((r) => r[phase]?.requests ?? 0)),
    kB: Math.round(median(results.map((r) => r[phase]?.bytes ?? 0)) / 1024),
  };
}
console.log(JSON.stringify(summary, null, 2));
if (jsonOut) writeFileSync(resolve(root, jsonOut), JSON.stringify({ summary, results }, null, 2));
