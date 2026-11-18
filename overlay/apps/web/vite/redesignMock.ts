// Build seam for the redesign mock preview. Replaces three upstream modules at their file paths,
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
const FAVICON = NodePath.join(repoRoot, "packages/shared/src/favicon.ts");
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
      if (id === FAVICON) {
        // Her link and tab icons ask Google's favicon service (or the linked site) for an image.
        // The mock asks no other origin for anything: links show her globe icon instead, and a
        // tool's icon is kept only when it is a data:, blob: or same-origin URL.
        return [
          `export * from ${JSON.stringify(FAVICON + ORIGINAL)};`,
          `import { toolActivityFaviconUrl as upstreamToolActivityFaviconUrl } from ${JSON.stringify(FAVICON + ORIGINAL)};`,
          `export function faviconUrlForOrigin() { return null; }`,
          `export function toolActivityFaviconUrl(icon, appearance, size) {`,
          `  const url = upstreamToolActivityFaviconUrl(icon, appearance, size);`,
          `  if (url === null) return null;`,
          `  try {`,
          `    const parsed = new URL(url, window.location.href);`,
          `    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return url;`,
          `    return parsed.origin === window.location.origin ? url : null;`,
          `  } catch { return null; }`,
          `}`,
        ].join("\n");
      }
      if (id === FAVICON + ORIGINAL) return NodeFS.readFileSync(FAVICON, "utf8");
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

// Fewer files per visit. The bootstrap imports `src/main.tsx` dynamically, and every chunk main
// imports statically loads before the first paint. Rolldown cuts that set into several hundred
// small chunks (one per combination of lazy chunks sharing a module), so a cold visit made about
// 440 requests. The build runs twice (scripts/build.sh): a plan pass with Rolldown's own chunking
// records which modules land in the chunks a first visit loads, and the real pass groups exactly
// those modules into a few chunks by area. The first visit loads the same modules as before, in
// fewer files, and nothing lazy (document viewers, Shiki grammars and themes, fonts, models,
// pdf.js, the full icon map) moves into it. A graph walk cannot stand in for the plan pass: it
// follows every re-export of a barrel such as lucide-react, and tree shaking is what drops those.
const MAIN = NodePath.join(webRoot, "src/main.tsx");

/** What the plan pass found: the modules each part of a first visit loads. */
interface BootPlan {
  /** Loaded with the HTML entry, before the bootstrap runs (the mock's install and kernel). */
  readonly shell: ReadonlyArray<string>;
  /** Loaded with main.tsx, before the first paint. */
  readonly boot: ReadonlyArray<string>;
}

/** The package a node_modules path belongs to, or null for the repo's own files. */
function packageOf(path: string): string | null {
  const nodeModules = path.lastIndexOf("/node_modules/");
  if (nodeModules === -1) return null;
  const [scope = "", name = ""] = path.slice(nodeModules + "/node_modules/".length).split("/");
  return scope.startsWith("@") ? `${scope}/${name}` : scope;
}

/**
 * Boot chunks by area; a module goes to the first area that matches. Areas that change at
 * different times stay apart, so a rebuild after an upstream commit can leave the library chunks
 * alone. Areas whose modules import each other are merged at build time (see `mergeCycles`).
 */
const BOOT_AREAS: ReadonlyArray<{ readonly name: string; readonly test: (path: string) => boolean }> = [
  { name: "react", test: (path) => /^(react|react-dom|scheduler|use-sync-external-store)$/.test(packageOf(path) ?? "") },
  { name: "effect", test: (path) => /^(effect|@effect\/.*)$/.test(packageOf(path) ?? "") },
  { name: "icons", test: (path) => packageOf(path) === "lucide-react" },
  { name: "editor", test: (path) => /^(@tiptap\/|prosemirror-)/.test(packageOf(path) ?? "") },
  { name: "markdown", test: (path) => /^(micromark|mdast-|hast-|unist-|vfile|unified|parse5|property-information)/.test(packageOf(path) ?? "") },
  { name: "vendor", test: (path) => packageOf(path) !== null },
  { name: "packages", test: (path) => path.startsWith(`${repoRoot}/packages/`) },
  { name: "app", test: () => true },
];

type ChunkGroup = { name: string | ((id: string) => string | null); priority: number; test?: (id: string) => boolean };

const areaOf = (id: string): string =>
  BOOT_AREAS.find((area) => area.test(id.split("?")[0] ?? id))?.name ?? "app";

/**
 * Groups capture only the modules the plan lists, not their dependencies: following dependencies
 * would follow a barrel such as lucide-react to every icon it re-exports. Without that, two areas
 * that import each other would become two chunks that import each other, which can run a chunk
 * before the values it needs exist (upstream's chunk-cycle guard fails the build on it). So areas
 * that reach each other through imports between boot modules share one chunk.
 */
function mergeCycles(boot: ReadonlySet<string>, importsOf: (id: string) => ReadonlyArray<string>): Map<string, string> {
  const names = BOOT_AREAS.map((area) => area.name);
  const reach = new Map(names.map((name) => [name, new Set([name])]));
  for (const id of boot) {
    const from = areaOf(id);
    for (const imported of importsOf(id)) if (boot.has(imported)) reach.get(from)?.add(areaOf(imported));
  }
  // Transitive closure over a handful of areas.
  for (const via of names) {
    for (const from of names) {
      if (reach.get(from)?.has(via)) for (const to of reach.get(via) ?? []) reach.get(from)?.add(to);
    }
  }
  return new Map(
    names.map((name) => [
      name,
      names.filter((other) => reach.get(name)?.has(other) && reach.get(other)?.has(name)).join("-"),
    ]),
  );
}

/** Static imports of the given chunks, followed to the end. */
function staticClosure(bundle: Record<string, { type: string; imports?: ReadonlyArray<string> }>, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const fileName = queue.pop();
    if (fileName === undefined || seen.has(fileName)) continue;
    seen.add(fileName);
    queue.push(...(bundle[fileName]?.imports ?? []));
  }
  return seen;
}

/**
 * The two passes. `MOCK_BOOT_PLAN_WRITE=<file>` is the plan pass: Rolldown's own chunking, nothing
 * written to disk but the plan. `MOCK_BOOT_PLAN=<file>` is the real pass: group what the plan lists.
 * With neither (dev, or a bare `vp build`), chunking is upstream's.
 */
function bootChunks(command: "build" | "serve"): { plugins: Plugin[]; groups: ChunkGroup[] | null } {
  const writePlan = command === "build" ? process.env.MOCK_BOOT_PLAN_WRITE?.trim() : undefined;
  const readPlan = command === "build" && !writePlan ? process.env.MOCK_BOOT_PLAN?.trim() : undefined;

  if (writePlan) {
    return {
      groups: null,
      plugins: [
        {
          name: "redesign-mock:boot-plan",
          apply: "build",
          config: () => ({ build: { write: false } }),
          generateBundle(_options, bundle) {
            const chunks = Object.values(bundle).flatMap((output) => (output.type === "chunk" ? [output] : []));
            const entries = chunks.filter((chunk) => chunk.isEntry);
            const main = chunks.find((chunk) => chunk.moduleIds.includes(MAIN));
            if (!main) this.error(`redesign-mock: no chunk holds ${NodePath.relative(webRoot, MAIN)}`);
            const shellFiles = staticClosure(bundle, entries.map((chunk) => chunk.fileName));
            const bootFiles = staticClosure(bundle, [main.fileName]);
            const entryModules = new Set(entries.flatMap((chunk) => (chunk.facadeModuleId ? [chunk.facadeModuleId] : [])));
            // Rolldown's runtime is not a graph module and Rolldown places it itself; its other
            // helpers (the dynamic import helper) are modules and get grouped like any other.
            const graph = new Set(this.getModuleIds());
            const modulesOf = (files: Set<string>, skip: Set<string>) =>
              chunks
                .filter((chunk) => files.has(chunk.fileName) && !skip.has(chunk.fileName))
                .flatMap((chunk) => chunk.moduleIds.filter((id) => !entryModules.has(id) && graph.has(id)));
            const plan: BootPlan = { shell: modulesOf(shellFiles, new Set()), boot: modulesOf(bootFiles, shellFiles) };
            NodeFS.mkdirSync(NodePath.dirname(writePlan), { recursive: true });
            NodeFS.writeFileSync(writePlan, JSON.stringify(plan));
          },
        },
      ],
    };
  }
  if (!readPlan) return { groups: null, plugins: [] };

  const plan = JSON.parse(NodeFS.readFileSync(readPlan, "utf8")) as BootPlan;
  const shell = new Set(plan.shell);
  const boot = new Set(plan.boot);
  if (!boot.has(MAIN)) throw new Error(`redesign-mock: the boot plan ${readPlan} does not list main.tsx`);
  let chunkOfArea: Map<string, string> | null = null;
  const groups: ChunkGroup[] = [
    // The mock's install and kernel load with the HTML entry, before the bootstrap; they stay
    // apart from the boot chunks so the entry never imports app code.
    { name: "shell", priority: 2, test: (id) => shell.has(id) },
    {
      name: (id) => {
        // main.tsx is what the bootstrap imports; it keeps its own chunk, which imports the rest.
        // Grouped, Rolldown leaves a facade for it that and the group import each other.
        if (!boot.has(id) || id === MAIN) return null;
        // Chunking runs after `buildEnd`; a grouping without the merge map would be wrong.
        if (!chunkOfArea) throw new Error("redesign-mock: chunk grouping ran before the module graph was ready");
        return `boot-${chunkOfArea.get(areaOf(id)) ?? "app"}`;
      },
      priority: 1,
    },
  ];
  return {
    groups,
    plugins: [
      {
        name: "redesign-mock:boot-chunks",
        apply: "build",
        buildEnd(error) {
          if (error) return;
          // A plan from another graph (a stale file, a different upstream commit) would group
          // the wrong modules; the plan pass runs right before this one, so any drift is a bug.
          const graph = new Set(this.getModuleIds());
          const missing = [...shell, ...boot].filter((id) => !graph.has(id));
          if (missing.length > 0) {
            this.error(`redesign-mock: the boot plan lists ${missing.length} modules this build does not have, e.g. ${missing[0]}`);
          }
          chunkOfArea = mergeCycles(boot, (id) => this.getModuleInfo(id)?.importedIds ?? []);
        },
        generateBundle(_options, bundle) {
          const chunks = Object.values(bundle).flatMap((output) => (output.type === "chunk" ? [output] : []));
          // The failure this grouping could cause: the entry loading app code before the bootstrap.
          const entryFiles = staticClosure(bundle, chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
          const leaked = chunks.find((chunk) => entryFiles.has(chunk.fileName) && chunk.name.startsWith("boot-"));
          if (leaked) this.error(`redesign-mock: the HTML entry statically imports the boot chunk ${leaked.fileName}`);
          // And the one it exists to prevent: a first visit growing. Every module main loads
          // statically must be one the plan pass found it loading.
          const main = chunks.find((chunk) => chunk.moduleIds.includes(MAIN));
          if (!main) this.error(`redesign-mock: no chunk holds ${NodePath.relative(webRoot, MAIN)}`);
          const firstVisit = staticClosure(bundle, [main.fileName]);
          const graph = new Set(this.getModuleIds());
          const extra = chunks
            .filter((chunk) => firstVisit.has(chunk.fileName))
            .flatMap((chunk) => chunk.moduleIds)
            .filter((id) => !boot.has(id) && !shell.has(id) && graph.has(id));
          if (extra.length > 0) {
            this.error(`redesign-mock: grouping added ${extra.length} modules to the first visit, e.g. ${extra[0]}`);
          }
          // Rolldown only warns on an unknown output option (it renamed this one before), so
          // a grouping that silently stopped applying must fail here, not ship ~400 requests.
          if (!chunks.some((chunk) => chunk.name === "shell") || !chunks.some((chunk) => chunk.name.startsWith("boot-"))) {
            this.error("redesign-mock: chunk grouping did not apply (no shell or boot- chunk); check rolldownOptions.output.codeSplitting");
          }
          if (firstVisit.size > 40) this.error(`redesign-mock: the first visit loads ${firstVisit.size} JS files (limit 40)`);
        },
      },
    ],
  };
}

/** The parts of the mock build that sit on top of upstream's own config. */
export function redesignMockConfig(command: "build" | "serve"): UserConfig {
  const info = readBuildInfo();
  const define: Record<string, string> = {
    __REDESIGN_MOCK_BUILD__: JSON.stringify(info),
  };
  for (const key of FORCED_EMPTY_ENV) define[`import.meta.env.${key}`] = JSON.stringify("");
  const chunks = bootChunks(command);
  return {
    plugins: [seamPlugin(), designSystemPlugin(command), ...htmlPlugin(), ...chunks.plugins],
    define,
    build: {
      outDir: process.env.MOCK_OUT_DIR?.trim() || "dist-mock",
      sourcemap: false,
      // Mock assets stay real files: the app adds `?revision=` to asset URLs, which a data: URL
      // cannot carry. Everything else keeps upstream's inlining.
      assetsInlineLimit: (filePath: string) => (filePath.includes("/redesignMock/") ? false : undefined),
      ...(chunks.groups ? { rolldownOptions: { output: { codeSplitting: { includeDependenciesRecursively: false, groups: chunks.groups } } } } : {}),
    },
    ...(command === "serve" ? { server: { port: Number(process.env.PORT ?? 5833) } } : {}),
  };
}
