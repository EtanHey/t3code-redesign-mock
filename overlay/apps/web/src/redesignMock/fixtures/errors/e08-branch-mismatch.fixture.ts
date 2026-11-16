// E08: the checkout moved off the branch this thread last ran on. The banner only appears once
// the composer holds a draft (the app's own rule), so the thread says so in its title and reply.
import { assistant, command, fileChange, thread, turn } from "../../api";

export default thread({
  id: "e08-branch-mismatch",
  project: "errors",
  title: "Branch changed: type in the composer to see the notice",
  branch: "feature/ledger-rollup",
  scenario: { id: "E08", label: "Branch mismatch", waitForText: "ledger rollup" },
  turns: [
    turn({
      at: "50m",
      took: "3m",
      user: "Add the per-day ledger rollup on the feature branch.",
      items: [
        command({ input: "git status -sb", output: "## feature/ledger-rollup...origin/feature/ledger-rollup" }),
        fileChange({
          path: "src/ledger/rollup.ts",
          additions: 9,
          deletions: 1,
          diff: "--- a/src/ledger/rollup.ts\n+++ b/src/ledger/rollup.ts\n@@ -12,3 +12,11 @@\n+export function rollupByDay(entries: LedgerEntry[]): Map<string, number> {\n+  const days = new Map<string, number>();\n+  for (const entry of entries) days.set(entry.day, (days.get(entry.day) ?? 0) + entry.cents);\n+  return days;\n+}\n",
        }),
        assistant(
          "Done on `feature/ledger-rollup`. This thread last ran on that branch, but the project checkout is on `main` now. Start typing a message below and the \"Branch changed\" notice appears with a **Restore branch** button.",
        ),
      ],
    }),
  ],
});
