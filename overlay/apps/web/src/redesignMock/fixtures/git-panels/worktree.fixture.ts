import { NodeId, CheckpointId, CheckpointRef, CheckpointScopeId, RunId } from "@t3tools/contracts";
import { ago, assistant, fileChange, thread, turn } from "~/redesignMock/api";
import { largePatch, summaryPatch, testPatch, truncatedPatch, whitespacePatch } from "./data";
import { seedPanelsOnce, type PanelSeed } from "./panel-seed";

const scenarios = [
  {
    id: "G01",
    thread: "g01-worktree-changes",
    slug: "dashboard-summary",
    title: "Review changes in a worktree",
    patch: summaryPatch + testPatch,
    branch: "feature/dashboard-summary",
  },
  {
    id: "P03",
    thread: "p03-large-diff",
    slug: "activity-samples",
    title: "Review a large diff in stacked or split view",
    patch: largePatch,
    branch: "feature/activity-samples",
  },
  {
    id: "P03-truncated",
    thread: "p03-truncated-diff",
    slug: "import-history",
    title: "A diff cut off at the size limit",
    patch: truncatedPatch,
    branch: "feature/import-history",
  },
  {
    id: "P03-whitespace",
    thread: "p03-whitespace",
    slug: "summary-format",
    title: "Hide whitespace-only changes in a diff",
    patch: summaryPatch + whitespacePatch,
    branch: "feature/summary-format",
  },
];
const panelSeeds: PanelSeed[] = scenarios.map((s) => ({
  threadId: s.thread,
  workspaceName: s.title,
  panel: { id: "diff", kind: "diff" },
  chatWidth: 0.35,
  ...(s.id === "P03-truncated"
    ? { diffSelection: { kind: "turn", turnId: RunId.make(`${s.thread}-run-1`), filePath: null, revealRequestId: 0 } as const }
    : {}),
}));
seedPanelsOnce("diffs", panelSeeds);

const explain: Record<string, string> = {
  G01: "The diff panel is open beside this chat: two changed files, `src/summary.ts` and a new test.",
  P03: "The diff panel is open beside this chat with all 24 added files. Its layout menu switches between stacked and split view, and the file list on the left jumps between files.",
  "P03-truncated":
    "The diff panel is open on this run's changes. The run added 24 files, but the diff passed the size limit: the panel shows the first six and says so at the top.",
  "P03-whitespace":
    "The diff panel is open beside this chat. `src/theme.ts` only changes spacing: the whitespace control in the panel hides that file's edit and leaves the real change.",
};

export default scenarios.map((s) =>
  thread({
    id: s.thread,
    project: "git",
    title: s.title,
    branch: s.branch,
    worktreePath: `/workspace/orbit-dashboard/${s.slug}`,
    scenario: { id: s.id, label: s.title, waitForText: "diff panel" },
    turns: [
      turn({
        at: "15m",
        user: "Prepare the activity overview for review.",
        items: [
          fileChange({
            path:
              s.id.startsWith("P03") && s.id !== "P03-whitespace"
                ? "data/activity-1.ts"
                : "src/summary.ts",
            additions: s.id.startsWith("P03") && s.id !== "P03-whitespace" ? 1200 : 8,
            deletions: 2,
            diff: s.patch,
          }),
          assistant(explain[s.id]!),
        ],
      }),
    ],
    projection: (p) => {
      const run = p.runs[0]!;
      return {
        ...p,
        checkpoints: [
          {
            id: CheckpointId.make(`${s.slug}-checkpoint`),
            threadId: p.thread.id,
            scopeId: CheckpointScopeId.make(`${s.slug}-scope`),
            runId: run.id,
            nodeId: p.nodes[0]?.id ?? NodeId.make(`${s.slug}-node`),
            parentCheckpointId: null,
            ordinalWithinScope: 1,
            appRunOrdinal: 1,
            ref: CheckpointRef.make(`mock/${s.slug}`),
            status: "ready",
            capturedAt: ago("14m"),
            files:
              s.id === "P03" || s.id === "P03-truncated"
                ? Array.from({ length: 24 }, (_, index) => ({
                    path: `data/activity-${index + 1}.ts`,
                    kind: "added",
                    additions: 50,
                    deletions: 0,
                  }))
                : [
                      { path: "src/summary.ts", kind: "modified", additions: 3, deletions: 2 },
                      s.id === "G01"
                        ? { path: "src/summary.test.ts", kind: "added", additions: 5, deletions: 0 }
                        : { path: "src/theme.ts", kind: "modified", additions: 1, deletions: 1 },
                    ],
          },
        ],
      };
    },
    rpc: {
      "orchestration.getTurnDiff": (input) => ({
        threadId: input.threadId,
        fromTurnCount: input.fromTurnCount,
        toTurnCount: input.toTurnCount,
        diff: s.id === "P03-whitespace" && input.ignoreWhitespace ? summaryPatch : s.patch,
      }),
      "orchestration.getFullThreadDiff": (input) => ({
        threadId: input.threadId,
        fromTurnCount: 0,
        toTurnCount: input.toTurnCount,
        diff: s.id === "P03-whitespace" && input.ignoreWhitespace ? summaryPatch : s.patch,
      }),
    },
  }),
);
