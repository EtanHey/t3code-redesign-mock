// X02: app-owned delegated tasks. The parent handed work to child threads of its own; each child
// is an ordinary thread (it takes messages, unlike a provider-native one) and its result is
// delivered back to the parent as a wake notification.
import { NodeId, ThreadId } from "@t3tools/contracts";

import { assistant, command, fileChange, item, MODELS, reasoning, thread, turn } from "~/redesignMock/api";

import {
  childThread,
  pendingSubagentTask,
  subagentIdOf,
  subagentRow,
  withSubagents,
  type SubagentSpec,
} from "./agent-kit";

const PARENT = "x02-delegated-task";

const reviewer: SubagentSpec = {
  key: "reviewer",
  parentId: PARENT,
  origin: "app_owned",
  title: "Review the invoice export change",
  prompt: "Review the diff on branch billing/export-csv. Check rounding, empty exports and the header row. Reply with a verdict.",
  status: "completed",
  result: "Approved with one note: rounding uses the currency's minor unit, but the header row still says `amount` rather than `amount_minor`.",
  childId: `${PARENT}-reviewer`,
  startedAgo: "22m",
  ranFor: "4m",
  model: MODELS.opus,
  extra: { completionWake: "always", completionDelivery: { state: "delivered", observedByRunId: null } },
};

const migrator: SubagentSpec = {
  key: "migrator",
  parentId: PARENT,
  origin: "app_owned",
  title: "Backfill amount_minor for old invoices",
  prompt: "Write and dry-run a backfill that fills invoices.amount_minor from invoices.amount for rows created before March.",
  status: "running",
  progress: "Dry run over 48,000 rows: 31,000 done, no mismatches so far.",
  childId: `${PARENT}-migrator`,
  startedAgo: "6m",
  model: MODELS.sonnet,
  extra: { completionWake: "always", completionDelivery: { state: "pending", observedByRunId: null } },
};

const parent = thread({
  id: PARENT,
  project: "agents",
  title: "Delegated tasks: open the child thread",
  model: MODELS.opus,
  scenario: {
    id: "X02",
    label: "App-owned delegated task with an openable child thread",
    waitForText: "Review the invoice export change",
  },
  turns: [
    turn({
      at: "25m",
      took: "1m",
      user: "Ship the invoice CSV export. Have someone review it while you prepare the backfill.",
      items: [
        reasoning("The review and the backfill do not touch the same files, so they can run as separate tasks."),
        subagentRow(reviewer),
        subagentRow(migrator),
        assistant("Both tasks are running in their own threads. I'll pick up the review result when it lands."),
      ],
    }),
    turn({
      at: "18m",
      took: "20s",
      user: {
        text: "Delegated task finished.",
        extra: { createdBy: "system", creationSource: "server" },
      },
      items: [
        item((base) => ({
          ...base,
          type: "notification",
          source: {
            kind: "delegated_task",
            taskIds: [subagentIdOf(PARENT, reviewer.key)],
            childThreadId: ThreadId.make(`${PARENT}-reviewer`),
          },
          outcome: "completed",
          summary: "Review the invoice export change finished",
          detail: reviewer.result ?? "",
        })),
        assistant("The review is approved. I'll rename the header to `amount_minor` before merging."),
      ],
    }),
  ],
  projection: withSubagents([reviewer, migrator]),
  shell: { pendingBackgroundTasks: [pendingSubagentTask(migrator)] },
});

const reviewerThread = childThread({
  id: `${PARENT}-reviewer`,
  parentId: PARENT,
  title: reviewer.title,
  native: false,
  model: MODELS.opus,
  turns: [
    turn({
      at: "22m",
      took: "4m",
      user: reviewer.prompt,
      run: { delegatedTaskId: NodeId.make(subagentIdOf(PARENT, reviewer.key)) },
      items: [
        command({
          input: "git diff main...billing/export-csv --stat",
          output: " src/billing/export.ts      | 48 +++++++++\n src/billing/export.test.ts | 31 ++++++\n 2 files changed, 79 insertions(+)\n",
        }),
        reasoning("Rounding goes through `toMinorUnits`, which is right. The CSV header is the only thing off."),
        assistant(reviewer.result ?? ""),
      ],
    }),
  ],
});

const migratorThread = childThread({
  id: `${PARENT}-migrator`,
  parentId: PARENT,
  title: migrator.title,
  native: false,
  model: MODELS.sonnet,
  turns: [
    turn({
      at: "6m",
      status: "running",
      user: migrator.prompt,
      run: { delegatedTaskId: NodeId.make(subagentIdOf(PARENT, migrator.key)) },
      items: [
        fileChange({
          path: "db/backfill/amount-minor.sql",
          additions: 14,
          deletions: 0,
          diff: "@@ -0,0 +1,14 @@\n+update invoices\n+set amount_minor = round(amount * 100)\n+where amount_minor is null\n+  and created_at < '2026-03-01';\n",
        }),
        command({
          input: "psql -f db/backfill/amount-minor.sql --single-transaction --dry-run",
          output: "Dry run: 31000 / 48000 rows, 0 mismatches\n",
        }),
      ],
    }),
  ],
});

export default [parent, reviewerThread, migratorThread];
