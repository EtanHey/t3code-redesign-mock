// L08-L12: how a thread reads before it works, while it works, while it waits and while it stops:
// preparing, starting, queued; a running timer; waiting on another thread; a background command
// and monitor holding completion; Stop requested, the agent not answering, and stopped.
import { ProviderDriverKind, ProviderThreadId, type OrchestrationV2ProviderThread } from "@t3tools/contracts";

import {
  ago,
  assistant,
  CODEX,
  command,
  exec,
  item,
  plus,
  reasoning,
  script,
  think,
  thread,
  turn,
  type TurnSpec,
} from "../../api";
import { finishLiveCommand, streamParagraphs } from "./live-kit";

// L08 -------------------------------------------------------------------------------------------

const EARLIER: TurnSpec = turn({
  at: "40m",
  took: "30s",
  user: "What does `retryable` mean on the job record?",
  items: [assistant("It marks jobs the worker may run again after a failure. Jobs that failed validation are never retryable.")],
});

// The app's own words: a thread that is still creating its workspace reads "Setting up", one
// whose agent has not opened yet reads "Starting", one behind another message reads "Queued".
const preparing = thread({
  id: "l08-preparing",
  project: "live",
  title: "Setting up: creating the workspace",
  scenario: { id: "L08", label: "Thread preparing (Setting up)", waitForText: "nightly digest" },
  turns: [
    EARLIER,
    turn({ at: "20s", status: "preparing", user: "Add a nightly digest email for failed jobs.", items: [] }),
  ],
});

const starting = thread({
  id: "l08-starting",
  project: "live",
  title: "Starting: waiting for the agent to open",
  scenario: { id: "L08b", label: "Thread starting", waitForText: "audit log" },
  turns: [
    turn({
      at: "25m",
      took: "45s",
      user: "Which queue handles the retries?",
      items: [
        command({ input: "rg -n \"retryQueue\" src", output: "src/jobs/worker.ts:58:  const retryQueue = queues.get(\"retries\");\n" }),
        assistant("Retries go through the `retries` queue, which `worker.ts` creates at startup."),
      ],
    }),
    turn({ at: "15s", status: "starting", user: "Add an audit log entry when a job is retried.", items: [] }),
  ],
});

const queued = thread({
  id: "l08-queued",
  project: "live",
  title: "Queued: waiting behind another run",
  scenario: { id: "L08c", label: "Thread queued", waitForText: "Group the failed jobs" },
  turns: [
    turn({
      at: "12m",
      took: "70s",
      user: "Rename the `failedAt` column to `lastFailedAt` in the jobs table.",
      items: [
        command({ input: "rg -l \"failedAt\" src migrations", output: "src/jobs/store.ts\nsrc/jobs/report.ts\nmigrations/0042_jobs.sql\n" }),
        assistant("Renamed in the store, the report query and a new migration. The column rename is reversible."),
      ],
    }),
    turn({
      at: "30s",
      status: "queued",
      user: {
        text: "Group the failed jobs by queue name on the dashboard.",
        inputIntent: "queued_turn",
        extra: { status: "pending" },
      },
      items: [],
      run: { queuePosition: 1 },
    }),
  ],
});

// L09 -------------------------------------------------------------------------------------------

const WORKING_NOTES = [
  "The pagination helper returns a cursor but the list endpoint never sends it back, so clients cannot ask for page two. I'm adding the cursor to the response envelope.",
  "Checking the OpenAPI document next: the `nextCursor` field has to be declared there too, or the generated client will drop it.",
  "The generated client is rebuilt from the document, so I'm regenerating it and looking at the diff to make sure only the new field shows up.",
  "Now the contract test: it paginates through 120 seeded rows and expects every row exactly once.",
];

const L09_ID = "l09-working-timer";

const working = thread({
  id: L09_ID,
  project: "live",
  title: "Working: timer running (started 7 minutes ago)",
  scenario: { id: "L09", label: "Working with a running timer", waitForText: "pagination" },
  turns: [
    turn({
      at: "7m",
      status: "running",
      took: "6m 30s",
      user: "The list endpoint needs real pagination. Please add it end to end.",
      items: [
        reasoning("Looking at how the list endpoint builds its response."),
        command({ input: "rg -n \"nextCursor\" src docs", output: "docs/api.md:41:  nextCursor: string | null\nsrc/lib/page.ts:9:  nextCursor: string | null\n" }),
        item((base) => ({
          ...base,
          type: "file_change",
          fileName: "src/lib/page.ts",
          additions: 6,
          deletions: 1,
          diffStr: "@@ -6,5 +6,10 @@ export function paginate<T>(rows: T[], size: number) {\n-  return { rows: rows.slice(0, size) };\n+  const page = rows.slice(0, size);\n+  return {\n+    rows: page,\n+    nextCursor: rows.length > size ? encodeCursor(page.at(-1)) : null,\n+  };\n }\n",
          changes: [{ operation: "update", path: "src/lib/page.ts" }],
        })),
        command({ input: "vitest run src/lib/page.test.ts", status: "running", output: " RUN  v2.4.1\n" }),
      ],
    }),
  ],
  onOpen: script(
    [finishLiveCommand(" ✓ src/lib/page.test.ts (7 tests) 24ms\n", "6s")],
    {
      loop: [
        ...streamParagraphs("assistant_message", WORKING_NOTES, { after: "7s" }),
        ...think("Reading the next file before changing it.", "2.5s", "2s"),
        ...exec(
          { input: "rg -n \"cursor\" src --max-count 5", output: "src/lib/page.ts:9:  nextCursor: string | null\nsrc/lib/cursor.ts:3: export function encodeCursor(row: unknown): string {\n" },
          "1.4s",
          "1.5s",
        ),
      ],
    },
  ),
});

// L10 -------------------------------------------------------------------------------------------

const waitingOnThread = thread({
  id: "l10-waiting-on-thread",
  project: "live",
  title: "Waiting: on another thread to finish",
  scenario: { id: "L10", label: "Waiting on another thread", waitForText: "Waiting" },
  turns: [
    turn({
      at: "9m",
      took: "8m",
      status: "running",
      user: "Start the pagination work in its own thread and tell me when it's done.",
      items: [
        reasoning("The pagination thread owns the code; I only need to wait for its result."),
        assistant(
          "I started “Working: timer running (started 7 minutes ago)” in its own thread. I'm waiting for it to finish before I report back.",
          { phase: "commentary" },
        ),
        item((base) => ({
          ...base,
          type: "dynamic_tool",
          toolName: "mcp__t3-code__t3_thread_wait",
          input: { threadId: L09_ID, timeoutSeconds: 600 },
        })),
      ],
    }),
  ],
  shell: { blockedOnThreadWait: true },
});

// L11 -------------------------------------------------------------------------------------------

const L11_ID = "l11-background-monitor";

const devServerTask = {
  taskId: `${L11_ID}-item-2`,
  kind: "command" as const,
  description: "pnpm --filter harbor-api dev",
};
const monitorTask = {
  taskId: `${L11_ID}-item-3`,
  kind: "monitor" as const,
  description: "tail -f logs/api.log | grep --line-buffered ERROR",
  awaited: true as const,
};

function backgroundProviderThread(): OrchestrationV2ProviderThread {
  return {
    id: ProviderThreadId.make(`${L11_ID}-provider-thread`),
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: CODEX,
    providerSessionId: null,
    appThreadId: null,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "active",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [devServerTask, monitorTask],
    contextUsage: null,
    nativeMetadata: null,
    goal: null,
    createdAt: ago("12m"),
    updatedAt: ago("1m"),
  };
}

const monitoring = thread({
  id: L11_ID,
  project: "live",
  title: "Monitoring: a dev server and a log monitor are running",
  scenario: { id: "L11", label: "Background command and monitor", waitForText: "Monitoring" },
  turns: [
    turn({
      at: "11m",
      took: "2m",
      user: "Start the API in the background and watch the log for errors. Wake me when one shows up.",
      items: [
        reasoning("The server has to stay up, so it runs in the background; a monitor reports error lines."),
        command({
          input: "pnpm --filter harbor-api dev",
          status: "running",
          output: "harbor-api listening on :4100\nGET /health 200 3ms\n",
          extra: { completionWake: "always" },
        }),
        command({
          input: "tail -f logs/api.log | grep --line-buffered ERROR",
          status: "running",
          output: "",
          extra: { monitor: true },
        }),
        assistant("The server is up on port 4100 and the monitor is watching for `ERROR` lines. I'll continue when one appears."),
      ],
    }),
  ],
  shell: { pendingBackgroundTasks: [devServerTask, monitorTask] },
  projection: (projection) => ({
    ...projection,
    providerThreads: [backgroundProviderThread()],
    thread: { ...projection.thread, activeProviderThreadId: ProviderThreadId.make(`${L11_ID}-provider-thread`) },
  }),
});

// L12 -------------------------------------------------------------------------------------------

const STOP_USER = "Rebuild every index in the database, one table at a time.";

function interruptItems(unresponsiveAfter: string | null) {
  return [
    reasoning("Starting with the largest table."),
    command({ input: "psql -f scripts/reindex-all.sql", status: "running", output: "REINDEX TABLE events ...\n" }),
    item((base) => ({
      ...base,
      status: "running" as const,
      completedAt: null,
      type: "run_interrupt_request",
      message: "Stop requested",
      ...(unresponsiveAfter === null ? {} : { unresponsiveAt: plus(base.startedAt, unresponsiveAfter) }),
    })),
  ];
}

const stopping = thread({
  id: "l12-stop-requested",
  project: "live",
  title: "Stop: requested, agent is winding down",
  scenario: { id: "L12", label: "Interrupt requested", waitForText: "Stopping" },
  turns: [turn({ at: "150s", took: "204s", status: "running", user: STOP_USER, items: interruptItems(null) })],
});

const unresponsive = thread({
  id: "l12-stop-unresponsive",
  project: "live",
  title: "Stop: agent not responding, Force stop offered",
  scenario: { id: "L12b", label: "Interrupt unresponsive, Force stop", waitForText: "Force stop" },
  turns: [turn({ at: "210s", took: "325s", status: "running", user: STOP_USER, items: interruptItems("15s") })],
});

const stopped = thread({
  id: "l12-stopped",
  project: "live",
  title: "Stop: the run was stopped",
  scenario: { id: "L12c", label: "Interrupt finished, run stopped", waitForText: "Stopped" },
  turns: [
    turn({
      at: "6m",
      status: "interrupted",
      took: "1m 30s",
      user: STOP_USER,
      items: [
        reasoning("Starting with the largest table."),
        command({ input: "psql -f scripts/reindex-all.sql", status: "failed", exitCode: 130, output: "REINDEX TABLE events ...\n^C\n" }),
        item((base) => ({
          ...base,
          type: "run_interrupt_request",
          message: "Stop requested",
        })),
        item((base) => ({
          ...base,
          type: "run_interrupt_result",
          message: "Stopped by you",
        })),
      ],
    }),
  ],
});

export default [preparing, starting, queued, working, waitingOnThread, monitoring, stopping, unresponsive, stopped];
