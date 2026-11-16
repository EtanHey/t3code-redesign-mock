// X06: wake notifications. When background work ends (or reports) while the agent is idle, the
// thread gets a notification row. Subagent and delegated-task wakes link to their child thread and
// read like a subagent row with an outcome; commands, monitors and system notices are plain rows.
// Two threads: one for the wakes that carry a child thread, one for the rest.
import { NodeId, ThreadId, type OrchestrationV2Notification } from "@t3tools/contracts";

import { assistant, command, item, MODELS, thread, turn } from "~/redesignMock/api";

import {
  childThread,
  subagentIdOf,
  withSubagents,
  type SubagentSpec,
} from "./agent-kit";

const WITH_CHILDREN = "x06-wakes-subagents";
const PLAIN = "x06-wakes-commands";

type Outcome = OrchestrationV2Notification["outcome"];

const notification = (source: OrchestrationV2Notification["source"], outcome: Outcome, summary: string, detail?: string) =>
  item((base) => ({
    ...base,
    type: "notification",
    source,
    outcome,
    summary,
    ...(detail === undefined ? {} : { detail }),
  }));

// Wakes that link to a child thread --------------------------------------------------------

interface Wake {
  readonly key: string;
  readonly kind: "subagent" | "delegated_task";
  readonly outcome: Outcome;
  readonly title: string;
  readonly status: SubagentSpec["status"];
  readonly result: string;
  readonly summary: string;
}

const wakes: ReadonlyArray<Wake> = [
  { key: "lint", kind: "subagent", outcome: "completed", title: "Lint the docs folder", status: "completed", result: "No lint errors in 38 files.", summary: "Subagent finished: Lint the docs folder" },
  { key: "types", kind: "subagent", outcome: "failed", title: "Typecheck the SDK", status: "failed", result: "4 type errors in sdk/client.ts after the rename.", summary: "Subagent failed: Typecheck the SDK" },
  { key: "bench", kind: "subagent", outcome: "cancelled", title: "Profile cold start", status: "cancelled", result: "Stopped by the parent before a profile was written.", summary: "Subagent stopped: Profile cold start" },
  { key: "scan", kind: "subagent", outcome: "updated", title: "Scan for leaked tokens", status: "running", result: "", summary: "Subagent update: Scan for leaked tokens" },
  { key: "review", kind: "delegated_task", outcome: "completed", title: "Review the SDK rename", status: "completed", result: "Approved. One stale import left in examples/.", summary: "Delegated task finished: Review the SDK rename" },
  { key: "deploy", kind: "delegated_task", outcome: "failed", title: "Deploy the preview site", status: "failed", result: "The preview deploy failed: the build output directory was empty.", summary: "Delegated task failed: Deploy the preview site" },
];

const records: SubagentSpec[] = wakes.map((wake, index) => ({
  key: wake.key,
  parentId: WITH_CHILDREN,
  origin: wake.kind === "delegated_task" ? "app_owned" : "provider_native",
  title: wake.title,
  prompt: `${wake.title}.`,
  status: wake.status,
  ...(wake.status === "running" ? { progress: "Scanned 1,900 of 2,400 files." } : { result: wake.result }),
  childId: `${WITH_CHILDREN}-${wake.key}`,
  startedAgo: `${470 - index * 6}s`,
  ranFor: "70s",
  model: MODELS.haiku,
}));

const subagentWakes = thread({
  id: WITH_CHILDREN,
  project: "agents",
  title: "Wake notifications: subagents and delegated tasks",
  model: MODELS.opus,
  scenario: {
    id: "X06",
    label: "Wake notifications from subagents and delegated tasks, each outcome",
    waitForText: "Lint the docs folder",
  },
  turns: [
    turn({
      at: "8m",
      took: "2m",
      user: "Run the docs lint, the SDK typecheck, a cold-start profile, a token scan, the review and the preview deploy in the background.",
      items: [
        assistant("All six are started. I'll report as each one finishes."),
        ...wakes.map((wake) =>
          notification(
            wake.kind === "subagent"
              ? { kind: "subagent", childThreadId: ThreadId.make(`${WITH_CHILDREN}-${wake.key}`) }
              : {
                  kind: "delegated_task",
                  taskIds: [NodeId.make(subagentIdOf(WITH_CHILDREN, wake.key))],
                  childThreadId: ThreadId.make(`${WITH_CHILDREN}-${wake.key}`),
                },
            wake.outcome,
            wake.summary,
            wake.result,
          ),
        ),
      ],
    }),
  ],
  projection: withSubagents(records),
});

const smallChildren = wakes.map((wake, index) =>
  childThread({
    id: `${WITH_CHILDREN}-${wake.key}`,
    parentId: WITH_CHILDREN,
    title: wake.title,
    native: wake.kind === "subagent",
    model: MODELS.haiku,
    turns: [
      turn({
        at: `${470 - index * 6}s`,
        took: "70s",
        status:
          wake.status === "completed"
            ? "completed"
            : wake.status === "failed"
              ? "failed"
              : wake.status === "cancelled"
                ? "cancelled"
                : "running",
        user: `${wake.title}.`,
        items: [assistant(wake.result === "" ? "Scanning source files for token patterns." : wake.result)],
      }),
    ],
  }),
);

// Wakes without a child thread ---------------------------------------------------------------

const plainWakes = thread({
  id: PLAIN,
  project: "agents",
  title: "Wake notifications: commands, monitors and system",
  model: MODELS.opus,
  scenario: {
    id: "X06b",
    label: "Wake notifications from commands, monitors and the system",
    waitForText: "Command finished: vite build",
  },
  turns: [
    turn({
      at: "30m",
      took: "3m",
      user: "Build in the background, watch the CI log, and tell me when anything changes.",
      items: [
        command({
          input: "vite build --watch",
          output: "built in 12.4s\n",
          extra: { completionWake: "always" },
        }),
        notification({ kind: "command" }, "completed", "Command finished: vite build", "Exited with code 0 after 12.4s."),
        notification({ kind: "command" }, "failed", "Command failed: vitest run --run", "Exited with code 1. 3 tests failed."),
        notification({ kind: "command" }, "cancelled", "Command stopped: vite dev", "Stopped by you."),
        notification({ kind: "monitor" }, "updated", "Monitor update: CI log", "Step 4 of 6 finished: integration tests."),
        notification({ kind: "monitor" }, "completed", "Monitor finished: CI log", "The pipeline passed in 6m 12s."),
        notification({ kind: "background_task" }, "unknown", "Background task ended", "The task ended without reporting a result."),
        notification({ kind: "system" }, "updated", "Provider session resumed", "The session was restarted and the conversation was restored."),
        notification({ kind: "system" }, "failed", "Could not restore a background command", "`vite dev` was running before the restart and was not restarted."),
        assistant("That is every kind of wake: the build finished, the tests failed, the dev server was stopped, and the CI log changed twice."),
      ],
    }),
  ],
});

export default [subagentWakes, ...smallChildren, plainWakes];
