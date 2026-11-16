// Build seam for the redesign mock preview. Replaces two upstream modules at their file paths,
// runs the mock install before the app's bootstrap, and forces the hosted-mode env empty.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeCrypto from "node:crypto";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodePath from "node:path";

import type { Plugin, UserConfig } from "vite-plus";

const webRoot = NodePath.resolve(import.meta.dirname, "..");
const repoRoot = NodePath.resolve(webRoot, "../..");
const mockRoot = NodePath.join(webRoot, "src/redesignMock");

const DRIVER = NodePath.join(repoRoot, "packages/client-runtime/src/connection/driver.ts");
const LATENCY = NodePath.join(webRoot, "src/rpc/requestLatencyState.ts");
const ORIGINAL = "?redesign-mock-original";

/** Env vars that would bake an origin, Clerk or the hosted-static mode into the bundle. */
const FORCED_EMPTY_ENV = [
  "VITE_HTTP_URL",
  "VITE_WS_URL",
  "VITE_HOSTED_APP_CHANNEL",
  "VITE_HOSTED_APP_URL",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_JWT_TEMPLATE",
  "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
  "VITE_T3CODE_RELAY_URL",
  "VITE_RELAY_OTLP_TRACES_URL",
  "VITE_RELAY_OTLP_TRACES_DATASET",
  "VITE_RELAY_OTLP_TRACES_TOKEN",
  "VITE_RELEASE_CHANNEL",
  "T3CODE_DESKTOP_UPDATE_REPOSITORY",
  "T3CODE_FEATURE_SECRETS",
] as const;

/** Clears the env upstream's config reads at import time, whatever the shell or Vercel set. */
export function clearHostedEnv(): void {
  for (const key of FORCED_EMPTY_ENV) delete process.env[key];
  for (const key of ["VERCEL_URL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "T3CODE_PORT"]) {
    delete process.env[key];
  }
}

export interface RedesignMockBuildInfo {
  readonly branch: string;
  readonly commit: string;
  readonly shortCommit: string;
  readonly committedAt: string;
  readonly builtAt: string;
  readonly fixtureVersion: string;
}

function listFiles(directory: string): string[] {
  if (!NodeFS.existsSync(directory)) return [];
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * Changes whenever any mock file changes (sources, and the bundled assets fixtures import), so a
 * saved visitor state never meets new fixtures. README and other notes do not count.
 */
function fixtureVersion(): string {
  const hash = NodeCrypto.createHash("sha256");
  for (const file of [...listFiles(mockRoot), ...listFiles(NodePath.join(webRoot, "public/redesign-mock"))]
    .filter((path) => !/\.md$/i.test(path) && !NodePath.basename(path).startsWith("."))
    .toSorted()) {
    hash.update(NodePath.relative(webRoot, file));
    hash.update(NodeFS.readFileSync(file));
  }
  return hash.digest("hex").slice(0, 12);
}

export function readBuildInfo(): RedesignMockBuildInfo {
  const commit = process.env.MOCK_UPSTREAM_COMMIT?.trim() || "unknown";
  return {
    branch: process.env.MOCK_UPSTREAM_BRANCH?.trim() || "maria/redesign/6-workspace-panes",
    commit,
    shortCommit: commit.slice(0, 8),
    committedAt: process.env.MOCK_UPSTREAM_DATE?.trim() || "",
    builtAt: process.env.MOCK_BUILT_AT?.trim() || new Date().toISOString(),
    fixtureVersion: fixtureVersion(),
  };
}

function seamPlugin(): Plugin {
  return {
    name: "redesign-mock:seam",
    enforce: "pre",
    load(id) {
      if (id === DRIVER) {
        // The original stays reachable under a query id, so the shim never imports itself.
        return [
          `export * from ${JSON.stringify(DRIVER + ORIGINAL)};`,
          `import { ConnectionDriver } from ${JSON.stringify(DRIVER + ORIGINAL)};`,
          `import * as Layer from "effect/Layer";`,
          `import { mockDriver } from ${JSON.stringify(NodePath.join(mockRoot, "kernel/driver.ts"))};`,
          `export const layer = Layer.succeed(ConnectionDriver, ConnectionDriver.of(mockDriver));`,
        ].join("\n");
      }
      if (id === LATENCY) {
        // Unanswered requests are the mock's normal state, not a slow host.
        return [
          `export * from ${JSON.stringify(LATENCY + ORIGINAL)};`,
          `export function trackRpcRequestSent() {}`,
        ].join("\n");
      }
      if (id === DRIVER + ORIGINAL) return NodeFS.readFileSync(DRIVER, "utf8");
      if (id === LATENCY + ORIGINAL) return NodeFS.readFileSync(LATENCY, "utf8");
      return null;
    },
  };
}

// Upstream's design-system catalog (/design-system) is a dev-build page. Reviewers of a redesign
// want exactly that page, so the mock turns on the two `import.meta.env.DEV` checks that gate it
// (the route's 404 and its sidebar nav) and nothing else: every other dev-only tool (the replay
// host, the gap recorder, the command palette's dev entries) still reads the real DEV flag.
const DESIGN_SYSTEM_GATES: ReadonlyArray<{ readonly file: string; readonly from: string; readonly to: string }> = [
  {
    file: NodePath.join(webRoot, "src/routes/design-system.tsx"),
    from: "if (!import.meta.env.DEV) throw notFound();",
    to: "/* redesign-mock: catalog on */",
  },
  {
    file: NodePath.join(webRoot, "src/components/AppSidebarLayout.tsx"),
    from: "const DesignSystemSidebarNav = import.meta.env.DEV",
    to: "const DesignSystemSidebarNav = true",
  },
];

function designSystemPlugin(command: "build" | "serve"): Plugin {
  const applied = new Set<string>();
  return {
    name: "redesign-mock:design-system",
    enforce: "pre",
    transform(code, id) {
      // The router also loads each route file as split chunks (`?tsr-split=...`); patch whichever
      // copy holds the check.
      const gate = DESIGN_SYSTEM_GATES.find((candidate) => candidate.file === id.split("?")[0]);
      if (!gate || !code.includes(gate.from)) return null;
      applied.add(gate.from);
      return { code: code.replace(gate.from, gate.to), map: null };
    },
    buildEnd(error) {
      if (error || command !== "build") return;
      const missing = DESIGN_SYSTEM_GATES.filter((gate) => !applied.has(gate.from));
      if (missing.length > 0) {
        // Her guard moved: fail rather than ship a catalog that 404s or flip a broader switch.
        throw new Error(
          `redesign-mock: the design-system gate changed in ${missing.map((gate) => NodePath.relative(webRoot, gate.file)).join(", ")}`,
        );
      }
    },
  };
}

// A second wall behind the fetch guard: the browser itself refuses any other origin, including
// <img>, font and frame loads the fetch stub never sees.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function htmlPlugin(): Plugin[] {
  return [
    {
      name: "redesign-mock:html-entry",
      // Pre, so Vite bundles the injected module with her bootstrap, in this order.
      transformIndexHtml: {
        order: "pre",
        handler: (html) => {
          const bootstrap = '<script type="module" src="/src/bootstrap.ts"></script>';
          if (!html.includes(bootstrap)) {
            throw new Error("redesign-mock: index.html no longer loads /src/bootstrap.ts");
          }
          return html.replace(
            bootstrap,
            `<script type="module" src="/src/redesignMock/install.ts"></script>\n    ${bootstrap}`,
          );
        },
      },
    },
    {
      name: "redesign-mock:html-meta",
      transformIndexHtml: {
        order: "post",
        handler: (html) =>
          html
            .replace(/<title>[^<]*<\/title>/, "<title>T3 Code redesign (mock preview)</title>")
            .replace(
              "</head>",
              `  <meta name="robots" content="noindex, nofollow" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />\n  </head>`,
            ),
      },
    },
  ];
}

/** The parts of the mock build that sit on top of upstream's own config. */
export function redesignMockConfig(command: "build" | "serve"): UserConfig {
  const info = readBuildInfo();
  const define: Record<string, string> = {
    __REDESIGN_MOCK_BUILD__: JSON.stringify(info),
  };
  for (const key of FORCED_EMPTY_ENV) define[`import.meta.env.${key}`] = JSON.stringify("");
  return {
    plugins: [seamPlugin(), designSystemPlugin(command), ...htmlPlugin()],
    define,
    build: {
      outDir: process.env.MOCK_OUT_DIR?.trim() || "dist-mock",
      sourcemap: false,
      // Mock assets stay real files: the app adds `?revision=` to asset URLs, which a data: URL
      // cannot carry. Everything else keeps upstream's inlining.
      assetsInlineLimit: (filePath: string) => (filePath.includes("/redesignMock/") ? false : undefined),
    },
    ...(command === "serve" ? { server: { port: Number(process.env.PORT ?? 5833) } } : {}),
  };
}
