// A tiny static server with SPA fallback, for the smoke run and local checks of dist/.
// Usage as a CLI: node scripts/lib/serve.mjs <dir> [port]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
};

export function serve(dir, port = 0) {
  const root = resolve(dir);
  const fallback = existsSync(join(root, "404.html")) ? join(root, "404.html") : join(root, "index.html");
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = normalize(join(root, decodeURIComponent(url.pathname)));
    let file = path.startsWith(root) && existsSync(path) && statSync(path).isFile() ? path : null;
    if (file === null && existsSync(join(path, "index.html"))) file = join(path, "index.html");
    // Path routes the app owns get the shell; missing assets stay 404 so they are noticed.
    const isAsset = extname(url.pathname) !== "" && !url.pathname.endsWith(".html");
    if (file === null && isAsset) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    file ??= fallback;
    response.writeHead(file === fallback && !path.endsWith("index.html") ? 200 : 200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "dist";
  const port = Number(process.argv[3] ?? 4173);
  const { origin } = await serve(dir, port);
  console.log(`serving ${resolve(dir)} at ${origin} (pid ${process.pid})`);
}
