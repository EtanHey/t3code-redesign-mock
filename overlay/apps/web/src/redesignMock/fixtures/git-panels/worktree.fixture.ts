import { NodeId, CheckpointId, CheckpointRef, CheckpointScopeId } from "@t3tools/contracts";
import { ago, assistant, fileChange, thread, turn } from "~/redesignMock/api";
import { largePatch, summaryPatch, testPatch, whitespacePatch } from "./data";

const scenarios = [
  {
    id: "G01",
    slug: "g01-worktree-changes",
    title: "Review changes in a worktree",
    patch: summaryPatch + testPatch,
    branch: "feature/dashboard-summary",
  },
  {
    id: "P03",
    slug: "p03-large-diff",
    title: "Review a large diff in stacked or split view",
    patch: largePatch,
    branch: "feature/activity-samples",
  },
  {
    id: "P03-truncated",
    slug: "p03-truncated-diff",
    title: "A diff cut off at the output limit",
    patch: largePatch.slice(0, largePatch.indexOf("diff --git", 100)) + "\n\n[truncated]",
    branch: "feature/import-history",
  },
  {
    id: "P03-whitespace",
    slug: "p03-whitespace",
    title: "Hide whitespace-only changes in a diff",
    patch: summaryPatch + whitespacePatch,
    branch: "feature/summary-format",
  },
];
export default scenarios.map((s) =>
  thread({
    id: s.slug,
    project: "git",
    title: s.title,
    branch: s.branch,
    worktreePath: `/workspace/orbit-dashboard/${s.slug}`,
    scenario: { id: s.id, label: s.title, waitForText: "Open Changes" },
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
            additions: s.id === "P03" ? 1200 : 8,
            deletions: 2,
            diff: s.patch,
          }),
          assistant(
            "Open Changes to inspect the diff. Use the layout menu for stacked or split view, the file tree for navigation, and the whitespace control to focus on meaningful edits.",
          ),
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
              s.id === "P03"
                ? Array.from({ length: 24 }, (_, index) => ({
                    path: `data/activity-${index + 1}.ts`,
                    kind: "added",
                    additions: 50,
                    deletions: 0,
                  }))
                : s.id === "P03-truncated"
                  ? [{ path: "data/activity-1.ts", kind: "added", additions: 50, deletions: 0 }]
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
