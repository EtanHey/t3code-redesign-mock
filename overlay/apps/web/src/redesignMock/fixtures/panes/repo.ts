// A small, believable repository the files tree, file previews, search and the terminal all read.
// `/workspace/orbit-dashboard` (the "git" project) gets the full tree; every other planted project
// root gets a stub with a README, so a files panel opened anywhere still has something in it.
import { PLANTED_PROJECTS, workspaceRootOf, type PlantedProjectKey } from "~/redesignMock/api";

export const REPO_ROOT = workspaceRootOf("git");

const README = `# orbit-dashboard

A small dashboard that summarises product activity for the last 30 days: visits, sign-ups and
the regions they come from.

> [!NOTE]
> This repository is planted for the T3 Code redesign preview. Nothing in it runs.

## Getting started

\`\`\`sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest, 24 tests
\`\`\`

## Layout

| Path | What lives there |
| --- | --- |
| \`src/summary.ts\` | Builds the summary cards from raw visit rows |
| \`src/components/\` | React components, one per card |
| \`src/lib/format.ts\` | Number and date formatting |
| \`data/visits.csv\` | Sample data the dev server loads |
| \`docs/\` | Architecture notes and screenshots |

## Status

- [x] Visits and sign-ups cards
- [x] Region breakdown
- [ ] Week-over-week comparison
- [ ] Export to CSV

![Dashboard](docs/dashboard.png)
`;

const ARCHITECTURE = `# Architecture

The dashboard is a static Vite app. All numbers are computed in the browser from a CSV the dev
server serves, so there is no backend to run.

\`\`\`mermaid
flowchart LR
  CSV[data/visits.csv] --> Parse[parseVisits]
  Parse --> Summary[buildSummary]
  Summary --> Cards[SummaryCard x 3]
  Summary --> Regions[RegionTable]
\`\`\`

## Decisions

1. **No chart library.** Three cards and a table do not need one; the bundle stays under 60 kB.
2. **Pure functions.** \`buildSummary\` takes rows and returns plain data, so it is easy to test.
3. **Dates are UTC.** The CSV is written in UTC and the cards say so.
`;

const VISITS_CSV = [
  "date,region,visits,signups,bounce_rate",
  "2026-10-17,Europe,1284,41,0.38",
  "2026-10-17,North America,1630,57,0.35",
  "2026-10-17,Asia Pacific,904,22,0.44",
  "2026-10-18,Europe,1312,39,0.37",
  "2026-10-18,North America,1588,61,0.34",
  "2026-10-18,Asia Pacific,951,25,0.42",
  "2026-10-19,Europe,1190,33,0.40",
  "2026-10-19,North America,1475,48,0.36",
  "2026-10-19,Asia Pacific,1002,28,0.41",
  "2026-10-20,Europe,1401,46,0.36",
  "2026-10-20,North America,1702,66,0.33",
  "2026-10-20,Asia Pacific,1044,31,0.40",
  "2026-10-21,Europe,1356,44,0.37",
  "2026-10-21,North America,1689,63,0.33",
  "2026-10-21,Asia Pacific,1090,30,0.39",
  "2026-10-22,Europe,1220,37,0.39",
  "2026-10-22,North America,1544,52,0.35",
  "2026-10-22,Asia Pacific,987,26,0.43",
  "2026-10-23,Europe,1098,29,0.41",
  "2026-10-23,North America,1391,45,0.37",
  "2026-10-23,Asia Pacific,912,21,0.45",
  "",
].join("\n");

const SUMMARY_TS = `import { formatCount, formatPercent } from "./lib/format";

export interface VisitRow {
  readonly date: string;
  readonly region: string;
  readonly visits: number;
  readonly signups: number;
  readonly bounceRate: number;
}

export interface SummaryCard {
  readonly title: string;
  readonly value: string;
  readonly hint: string;
}

/** The three cards at the top of the dashboard, computed from raw rows. */
export function buildSummary(rows: ReadonlyArray<VisitRow>): SummaryCard[] {
  const visits = rows.reduce((total, row) => total + row.visits, 0);
  const signups = rows.reduce((total, row) => total + row.signups, 0);
  const bounce =
    rows.length === 0 ? 0 : rows.reduce((total, row) => total + row.bounceRate, 0) / rows.length;

  return [
    { title: "Visits", value: formatCount(visits), hint: "Last 30 days, all regions" },
    { title: "Sign-ups", value: formatCount(signups), hint: \`\${formatPercent(signups / visits)} of visits\` },
    { title: "Bounce rate", value: formatPercent(bounce), hint: "Average across regions" },
  ];
}

/** Visits per region, largest first. */
export function visitsByRegion(rows: ReadonlyArray<VisitRow>): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.region, (totals.get(row.region) ?? 0) + row.visits);
  return [...totals.entries()].sort((left, right) => right[1] - left[1]);
}
`;

const FORMAT_TS = `const counts = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const percents = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return counts.format(value);
}

export function formatPercent(value: number): string {
  return Number.isFinite(value) ? percents.format(value) : "–";
}
`;

const FORMAT_TEST_TS = `import { describe, expect, it } from "vitest";
import { formatCount, formatPercent } from "./format";

describe("formatCount", () => {
  it("compacts thousands", () => expect(formatCount(12_840)).toBe("12.8K"));
  it("keeps small numbers", () => expect(formatCount(42)).toBe("42"));
});

describe("formatPercent", () => {
  it("rounds to one decimal", () => expect(formatPercent(0.3846)).toBe("38.5%"));
  it("shows a dash for NaN", () => expect(formatPercent(Number.NaN)).toBe("–"));
});
`;

const CARD_TSX = `import type { SummaryCard as Card } from "../summary";

export function SummaryCard({ card }: { card: Card }) {
  return (
    <article className="card">
      <h2 className="card-title">{card.title}</h2>
      <p className="card-value">{card.value}</p>
      <p className="card-hint">{card.hint}</p>
    </article>
  );
}
`;

const REGION_TABLE_TSX = `import { formatCount } from "../lib/format";

export function RegionTable({ regions }: { regions: Array<[string, number]> }) {
  return (
    <table className="regions">
      <thead>
        <tr><th>Region</th><th>Visits</th></tr>
      </thead>
      <tbody>
        {regions.map(([region, visits]) => (
          <tr key={region}><td>{region}</td><td>{formatCount(visits)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
`;

const MAIN_TSX = `import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
`;

const APP_TSX = `import { useEffect, useState } from "react";
import { RegionTable } from "./components/RegionTable";
import { SummaryCard } from "./components/SummaryCard";
import { parseVisits } from "./lib/parse";
import { buildSummary, visitsByRegion, type VisitRow } from "./summary";

export function App() {
  const [rows, setRows] = useState<VisitRow[]>([]);
  useEffect(() => {
    void fetch("/data/visits.csv")
      .then((response) => response.text())
      .then((text) => setRows(parseVisits(text)));
  }, []);

  return (
    <main className="dashboard">
      <header><h1>Orbit</h1><span className="muted">Times in UTC</span></header>
      <section className="cards">
        {buildSummary(rows).map((card) => <SummaryCard key={card.title} card={card} />)}
      </section>
      <RegionTable regions={visitsByRegion(rows)} />
    </main>
  );
}
`;

const PARSE_TS = `import type { VisitRow } from "../summary";

export function parseVisits(csv: string): VisitRow[] {
  const [, ...lines] = csv.trim().split("\\n");
  return lines.map((line) => {
    const [date, region, visits, signups, bounceRate] = line.split(",");
    return {
      date: date!,
      region: region!,
      visits: Number(visits),
      signups: Number(signups),
      bounceRate: Number(bounceRate),
    };
  });
}
`;

const STYLES_CSS = `:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}

.dashboard { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.card { border: 1px solid #8884; border-radius: 12px; padding: 16px; }
.card-value { font-size: 2rem; font-weight: 600; margin: 4px 0; }
.muted, .card-hint { color: #888; }
`;

const PACKAGE_JSON = `{
  "name": "orbit-dashboard",
  "private": true,
  "version": "0.4.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^5.1.0",
    "eslint": "^9.38.0",
    "typescript": "^5.9.3",
    "vite": "^7.2.0",
    "vitest": "^4.0.6"
  }
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
`;

const GITIGNORE = `node_modules
dist
coverage
.env.local
`;

const ENV_EXAMPLE = `# Copy to .env.local. The dashboard reads nothing secret.
VITE_DATA_URL=/data/visits.csv
`;

/** Text files by workspace-relative path. */
export const REPO_TEXT_FILES: Readonly<Record<string, string>> = {
  ".env.example": ENV_EXAMPLE,
  ".gitignore": GITIGNORE,
  "README.md": README,
  "package.json": PACKAGE_JSON,
  "tsconfig.json": TSCONFIG_JSON,
  "data/visits.csv": VISITS_CSV,
  "docs/architecture.md": ARCHITECTURE,
  "src/App.tsx": APP_TSX,
  "src/main.tsx": MAIN_TSX,
  "src/styles.css": STYLES_CSS,
  "src/summary.ts": SUMMARY_TS,
  "src/components/RegionTable.tsx": REGION_TABLE_TSX,
  "src/components/SummaryCard.tsx": CARD_TSX,
  "src/lib/format.test.ts": FORMAT_TEST_TS,
  "src/lib/format.ts": FORMAT_TS,
  "src/lib/parse.ts": PARSE_TS,
};

/** Binary files: listed and sized, previewed through an asset URL (the kernel serves a placeholder). */
export const REPO_BINARY_FILES: Readonly<Record<string, { byteLength: number; mimeType: string }>> = {
  "docs/dashboard.png": { byteLength: 48_213, mimeType: "image/png" },
  "public/favicon.png": { byteLength: 1_406, mimeType: "image/png" },
};

/** Ignored by git, shown dimmed in the tree. */
export const REPO_IGNORED_DIRECTORIES: ReadonlyArray<string> = ["node_modules", "dist"];

function stubFor(key: PlantedProjectKey): Record<string, string> {
  const { title, label } = PLANTED_PROJECTS[key];
  return {
    "README.md": `# ${title}\n\nPlanted project for the redesign preview (${label}). The full file tree lives in **orbit-dashboard**.\n`,
    "package.json": `{\n  "name": "${title}",\n  "private": true,\n  "version": "0.1.0"\n}\n`,
    "src/index.ts": `export const name = "${title}";\n`,
  };
}

export interface VirtualRepo {
  readonly root: string;
  readonly text: Map<string, string>;
  readonly binary: ReadonlyMap<string, { byteLength: number; mimeType: string }>;
  readonly ignoredDirectories: ReadonlyArray<string>;
}

const repos = new Map<string, VirtualRepo>();
for (const key of Object.keys(PLANTED_PROJECTS) as PlantedProjectKey[]) {
  const root = workspaceRootOf(key);
  repos.set(root, {
    root,
    text: new Map(Object.entries(key === "git" ? REPO_TEXT_FILES : stubFor(key))),
    binary: new Map(key === "git" ? Object.entries(REPO_BINARY_FILES) : []),
    ignoredDirectories: key === "git" ? REPO_IGNORED_DIRECTORIES : [],
  });
}

/** The repo a cwd belongs to (a worktree under a project root counts as that project). */
export function repoFor(cwd: string): VirtualRepo | null {
  const trimmed = cwd.replace(/\/+$/, "");
  for (const repo of repos.values()) {
    if (trimmed === repo.root || trimmed.startsWith(`${repo.root}/`)) return repo;
  }
  return null;
}

/** Workspace-relative path for a path that may be absolute under the repo root. */
export function relativeTo(repo: VirtualRepo, path: string): string {
  if (path === repo.root) return "";
  // The panes threads share the region-table worktree, separately from the main checkout.
  const worktreeRoot = `${repo.root}/.worktrees/region-table`;
  if (path === worktreeRoot) return "";
  if (path.startsWith(`${worktreeRoot}/`)) return path.slice(worktreeRoot.length + 1);
  if (path.startsWith(`${repo.root}/`)) return path.slice(repo.root.length + 1);
  return path.replace(/^\.\//, "").replace(/\/+$/, "");
}

export function allFiles(repo: VirtualRepo): string[] {
  return [...repo.text.keys(), ...repo.binary.keys()].toSorted();
}

export function allDirectories(repo: VirtualRepo): string[] {
  const directories = new Set<string>(repo.ignoredDirectories);
  for (const file of allFiles(repo)) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join("/"));
  }
  return [...directories].toSorted();
}

export interface DirectoryEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly ignored?: boolean;
}

/** Direct children of a directory, folders first. */
export function listDirectory(repo: VirtualRepo, directory: string): DirectoryEntry[] {
  const prefix = directory === "" ? "" : `${directory}/`;
  const isChild = (path: string) =>
    path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes("/");
  const folders = allDirectories(repo)
    .filter(isChild)
    .map((path) => ({
      path,
      kind: "directory" as const,
      ...(repo.ignoredDirectories.includes(path) ? { ignored: true } : {}),
    }));
  const files = allFiles(repo)
    .filter(isChild)
    .map((path) => ({ path, kind: "file" as const }));
  return [...folders, ...files];
}

export function byteLengthOf(contents: string): number {
  return new TextEncoder().encode(contents).length;
}
