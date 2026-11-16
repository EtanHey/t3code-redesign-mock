// Workspace panes (PR #28845): a thread whose workspace already shows its chat beside file
// previews and a terminal, with tab strips holding several tabs (P00, covering P01 terminals,
// P02 files and previews, P05 browser and device), and a second workspace for the thread
// details panel (P06, left out of the planted layout so its chat has the width the panel needs)
// and a files thread in a second workspace (P02). The layout is planted by layout-seed.ts. The
// right-most column starts left of x~1100 at 1440 wide so its short tab strip leaves the corner
// free for the preview's "Mock preview" pill (which otherwise hops to the left edge).
import { assistant, command, fileChange, item, reasoning, thread, turn } from "~/redesignMock/api";

import { seedLayoutOnce, THREAD_TERMINAL } from "./layout-seed";
import { REPO_ROOT } from "./repo";
import { PANES_THREAD_ID } from "./terminals";

const DETAILS_THREAD_ID = "p06-thread-details";
const FILES_THREAD_ID = "p02-files-and-previews";

const REGION_DIFF = `@@ -1,12 +1,18 @@
 import { formatCount } from "../lib/format";

-export function RegionTable({ regions }: { regions: Array<[string, number]> }) {
+export function RegionTable({ regions, total }: { regions: Array<[string, number]>; total: number }) {
   return (
     <table className="regions">
       <thead>
-        <tr><th>Region</th><th>Visits</th></tr>
+        <tr><th>Region</th><th>Visits</th><th>Share</th></tr>
       </thead>
       <tbody>
         {regions.map(([region, visits]) => (
-          <tr key={region}><td>{region}</td><td>{formatCount(visits)}</td></tr>
+          <tr key={region}>
+            <td>{region}</td>
+            <td>{formatCount(visits)}</td>
+            <td>{formatPercent(visits / total)}</td>
+          </tr>
         ))}
`;

const panes = thread({
  id: PANES_THREAD_ID,
  project: "git",
  title: "Workspace panes: chat, files and terminals",
  branch: "feature/region-table",
  worktreePath: `${REPO_ROOT}/.worktrees/region-table`,
  scenario: { id: "P00", label: "Workspace with chat, file tabs and a terminal", waitForText: "region table" },
  turns: [
    turn({
      at: "9m",
      took: "1m 50s",
      user: "Add a share column to the region table and keep the dev server running so I can watch it.",
      items: [
        reasoning("The table only shows raw visits. A share needs the total, which `buildSummary` already computes."),
        item((base) => ({
          ...base,
          type: "file_search",
          pattern: "RegionTable",
          results: [
            { fileName: "src/components/RegionTable.tsx", line: 3, preview: "export function RegionTable({ regions }" },
            { fileName: "src/App.tsx", line: 21, preview: "<RegionTable regions={visitsByRegion(rows)} />" },
          ],
        })),
        fileChange({ path: "src/components/RegionTable.tsx", additions: 7, deletions: 3, diff: REGION_DIFF }),
        command({ input: "pnpm test", output: " ✓ src/components/RegionTable.test.tsx (6 tests) 48ms\n\n Test Files  4 passed (4)\n      Tests  24 passed (24)\n" }),
        command({
          input: "pnpm lint",
          status: "failed",
          output: "src/components/RegionTable.tsx\n  4:10  error  'useMemo' is defined but never used  no-unused-vars\n\n✖ 3 problems (2 errors, 1 warning)\n",
        }),
        assistant(
          [
            "The region table now has a **Share** column. Tests pass; lint still reports two errors I left for you to decide on.",
            "",
            "Everything is open in this workspace:",
            "",
            "- **Left:** this chat.",
            "- **Middle, top:** tabs for `README.md` (markdown, with Preview and Source), `src/summary.ts`, `data/visits.csv` and `docs/dashboard.png`.",
            "- **Middle, bottom:** the terminal, with `pnpm dev` still running, `pnpm test` passed and `pnpm lint` failed.",
            "- **Right:** the file tree, and below it a browser tab and the device panel.",
            "",
            "Drag a tab to another pane or to an edge to split, close one, then reopen it from the tab menu. Nothing you do here leaves your browser.",
          ].join("\n"),
        ),
      ],
    }),
  ],
});

const details = thread({
  id: DETAILS_THREAD_ID,
  project: "git",
  title: "Thread details: worktree, branch and context",
  branch: "feature/region-table",
  worktreePath: `${REPO_ROOT}/.worktrees/region-table`,
  scenario: { id: "P06", label: "Thread details panel", waitForText: "details panel" },
  turns: [
    turn({
      at: "25m",
      took: "40s",
      user: "Where is this thread working, and how much context is left?",
      items: [
        assistant(
          "This thread works in a worktree on `feature/region-table`. The **details panel** at the top right of this chat shows the environment, the worktree, the branch, uncommitted changes, project actions, usage limits and the context window. It needs room: in a narrow pane it folds away. Settings › Appearance chooses which rows it shows.",
        ),
      ],
    }),
  ],
});

const files = thread({
  id: FILES_THREAD_ID,
  project: "git",
  title: "Files: tree, search and previews",
  branch: "feature/region-table",
  worktreePath: `${REPO_ROOT}/.worktrees/region-table`,
  scenario: { id: "P02", label: "Files tree and file previews", waitForText: "architecture notes" },
  turns: [
    turn({
      at: "40m",
      took: "30s",
      user: "Show me how the dashboard is put together.",
      items: [
        assistant(
          [
            "The architecture notes are open beside this chat, with the file tree on the right.",
            "",
            "- `docs/architecture.md` has a **mermaid** flowchart: switch between Preview and Source.",
            "- The other two tabs hold `data/visits.csv`, which opens as a table, and `docs/dashboard.png`, an image. Any `.ts` file opens as code.",
            "- Search the tree by name, or open the tree's search for file contents.",
            "",
            "Edits save for this page load only; a reload brings the planted files back.",
          ].join("\n"),
        ),
      ],
    }),
  ],
});

const file = (relativePath: string) =>
  ({ id: `file:${relativePath}`, kind: "file", relativePath, revealLine: null, revealRequestId: 0 }) as const;

seedLayoutOnce({
  threads: [
    {
      threadId: PANES_THREAD_ID,
      surfaces: [
        file("README.md"),
        file("src/summary.ts"),
        file("data/visits.csv"),
        file("docs/dashboard.png"),
        { id: "files", kind: "files" },
        { id: "browser:new", kind: "preview", resourceId: null },
        { id: "device", kind: "device" },
      ],
      activeSurfaceId: "file:README.md",
      terminals: { ids: ["term-1", "term-2", "term-3", "term-4"], active: "term-1" },
    },
    {
      threadId: FILES_THREAD_ID,
      surfaces: [
        file("docs/architecture.md"),
        file("data/visits.csv"),
        file("docs/dashboard.png"),
        { id: "files", kind: "files" },
      ],
      activeSurfaceId: "file:docs/architecture.md",
    },
  ],
  workspaces: [
    {
      id: "workspace:mock-panes",
      name: "Panes tour",
      focusedPaneId: "pane:mock-panes-chat",
      columns: [
        {
          id: "column:mock-panes-chat",
          width: 0.28,
          panes: [{ id: "pane:mock-panes-chat", tabs: [{ chat: PANES_THREAD_ID }], active: 0, size: 1 }],
        },
        {
          id: "column:mock-panes-surfaces",
          width: 0.45,
          panes: [
            {
              id: "pane:mock-panes-files",
              tabs: [
                { thread: PANES_THREAD_ID, surfaceId: "file:README.md" },
                { thread: PANES_THREAD_ID, surfaceId: "file:src/summary.ts" },
                { thread: PANES_THREAD_ID, surfaceId: "file:data/visits.csv" },
                { thread: PANES_THREAD_ID, surfaceId: "file:docs/dashboard.png" },
              ],
              active: 0,
              size: 0.6,
            },
            {
              id: "pane:mock-panes-terminal",
              tabs: [{ thread: PANES_THREAD_ID, surfaceId: THREAD_TERMINAL }],
              active: 0,
              size: 0.4,
            },
          ],
        },
        {
          id: "column:mock-panes-tree",
          width: 0.27,
          panes: [
            {
              id: "pane:mock-panes-tree",
              tabs: [{ thread: PANES_THREAD_ID, surfaceId: "files" }],
              active: 0,
              size: 0.55,
            },
            {
              id: "pane:mock-panes-browser",
              tabs: [
                { thread: PANES_THREAD_ID, surfaceId: "browser:new" },
                { thread: PANES_THREAD_ID, surfaceId: "device" },
              ],
              active: 0,
              size: 0.45,
            },
          ],
        },
      ],
    },
    {
      id: "workspace:mock-files",
      name: "Files",
      focusedPaneId: "pane:mock-files-chat",
      columns: [
        {
          id: "column:mock-files-chat",
          width: 0.3,
          panes: [{ id: "pane:mock-files-chat", tabs: [{ chat: FILES_THREAD_ID }], active: 0, size: 1 }],
        },
        {
          id: "column:mock-files-surfaces",
          width: 0.42,
          panes: [
            {
              id: "pane:mock-files-surfaces",
              tabs: [
                { thread: FILES_THREAD_ID, surfaceId: "file:docs/architecture.md" },
                { thread: FILES_THREAD_ID, surfaceId: "file:data/visits.csv" },
                { thread: FILES_THREAD_ID, surfaceId: "file:docs/dashboard.png" },
              ],
              active: 0,
              size: 1,
            },
          ],
        },
        {
          id: "column:mock-files-tree",
          width: 0.28,
          panes: [{ id: "pane:mock-files-tree", tabs: [{ thread: FILES_THREAD_ID, surfaceId: "files" }], active: 0, size: 1 }],
        },
      ],
    },
  ],
});

export default [panes, files, details];
