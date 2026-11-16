// E06: checkpoints that did not come out ready, and a rollback that failed. Each thread has an
// earlier run with a ready checkpoint, a middle one whose checkpoint is in the state under test, and
// a last one after it. "Edit from here" on a message rewinds to the checkpoint of the run before
// it, so the last message offers it only when the middle checkpoint is ready or missing.
import { CommandId } from "@t3tools/contracts";

import { assistant, command, fileChange, thread, turn, type ThreadSpec } from "../../api";
import { checkpointOf, withProviderThread } from "./errors-kit";

const ROLLUP_DIFF =
  "--- a/src/ledger/rollup.ts\n+++ b/src/ledger/rollup.ts\n@@ -12,6 +12,9 @@\n export function rollup(entries: LedgerEntry[]): Rollup {\n+  const byDay = new Map<string, number>();\n+  for (const entry of entries) byDay.set(entry.day, (byDay.get(entry.day) ?? 0) + entry.cents);\n   return { total: sum(entries), days: byDay.size };\n }\n";

function threeRuns(slug: string, second: "missing" | "error" | "stale" | "ready", extra: Partial<ThreadSpec> = {}) {
  const base: ThreadSpec = {
    id: slug,
    project: "errors",
    title: "",
    branch: "fix/ledger-rollup",
    worktreePath: "/workspace/relay-billing-rollup",
    turns: [
      turn({
        at: "40m",
        took: "3m",
        user: "Add a per-day rollup to the ledger summary.",
        items: [
          fileChange({ path: "src/ledger/rollup.ts", additions: 3, deletions: 0, diff: ROLLUP_DIFF }),
          assistant("Added `byDay` to `rollup()`. The summary now reports `days` as the number of distinct days with entries."),
        ],
      }),
      turn({
        at: "15m",
        took: "4m",
        user: "Cover it with a test, including an empty ledger and entries that span midnight UTC.",
        items: [
          fileChange({
            path: "src/ledger/rollup.test.ts",
            additions: 31,
            deletions: 0,
            diff: "--- a/src/ledger/rollup.test.ts\n+++ b/src/ledger/rollup.test.ts\n@@ -1,3 +1,8 @@\n+it(\"reports zero days for an empty ledger\", () => {\n+  expect(rollup([]).days).toBe(0);\n+});\n",
          }),
          command({ input: "pnpm vitest run src/ledger/rollup.test.ts", output: " ✓ src/ledger/rollup.test.ts (4 tests) 12ms\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)" }),
          assistant(second === "ready" ? "Added four tests; they pass." : "Added four tests; they pass. The checkpoint for this run could not be captured cleanly."),
        ],
      }),
      turn({
        at: "6m",
        took: "1m",
        user: "Mention the rollup in the ledger README.",
        items: [
          fileChange({
            path: "docs/ledger.md",
            additions: 6,
            deletions: 0,
            diff: "--- a/docs/ledger.md\n+++ b/docs/ledger.md\n@@ -20,3 +20,9 @@\n+## Per-day rollup\n+\n+`rollup()` also reports `days`, the number of distinct UTC days with entries.\n",
          }),
          assistant("Added a short \"Per-day rollup\" section to `docs/ledger.md`."),
        ],
      }),
    ],
    projection: (p) => withProviderThread({
      ...p,
      checkpoints: [
        checkpointOf(p, {
          slug,
          runIndex: 0,
          status: "ready",
          capturedAgo: "37m",
          files: [{ path: "src/ledger/rollup.ts", kind: "modified", additions: 3, deletions: 0 }],
        }),
        checkpointOf(p, {
          slug,
          runIndex: 1,
          status: second,
          capturedAgo: "11m",
          files: [{ path: "src/ledger/rollup.test.ts", kind: "added", additions: 31, deletions: 0 }],
        }),
        checkpointOf(p, {
          slug,
          runIndex: 2,
          status: "ready",
          capturedAgo: "5m",
          files: [{ path: "docs/ledger.md", kind: "modified", additions: 6, deletions: 0 }],
        }),
      ],
    }),
  };
  return thread({ ...base, ...extra });
}

export const ROLLBACK_FAILED_THREAD_ID = "e06-rollback-failed";

export default [
  threeRuns("e06-checkpoint-error", "error", {
    title: "Checkpoint error: a run's changes were not captured",
    scenario: { id: "E06", label: "Checkpoint in error", waitForText: "per-day rollup" },
  }),
  threeRuns("e06-checkpoint-stale", "stale", {
    title: "Checkpoint stale: the files moved on since",
    scenario: { id: "E06b", label: "Checkpoint stale", waitForText: "per-day rollup" },
  }),
  threeRuns("e06-checkpoint-missing", "missing", {
    title: "Checkpoint missing: its snapshot was cleaned up",
    scenario: { id: "E06c", label: "Checkpoint missing", waitForText: "per-day rollup" },
  }),
  threeRuns(ROLLBACK_FAILED_THREAD_ID, "ready", {
    title: "Rollback failed: use Edit from here on the second message",
    scenario: { id: "E06d", label: "Rollback failure", waitForText: "per-day rollup" },
    thread: {
      rollbackRequestId: CommandId.make("e06-earlier-rollback"),
      rollbackFailure: {
        requestId: CommandId.make("e06-earlier-rollback"),
        message: "Could not restore files: src/ledger/rollup.ts has local changes that would be overwritten.",
      },
    },
  }),
];
