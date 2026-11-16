// X01: native subagent rows in every status. The parent spawned five Claude subagents; each row
// opens a real planted child thread (read-only, as provider-native children are).
import { assistant, command, item, MODELS, reasoning, thread, turn } from "~/redesignMock/api";

import {
  childThread,
  pendingSubagentTask,
  subagentRow,
  withSubagents,
  type SubagentSpec,
} from "./agent-kit";

const PARENT = "x01-subagent-statuses";

const specs: ReadonlyArray<SubagentSpec> = [
  {
    key: "audit",
    parentId: PARENT,
    title: "Audit retry handling in the sync client",
    prompt: "Read src/sync/client.ts and list every place a failed request is retried without a backoff.",
    status: "completed",
    result: "Found 3 call sites with no backoff: pushBatch, pullChanges and the heartbeat. All three retry immediately.",
    childId: `${PARENT}-audit`,
    startedAgo: "11m",
    ranFor: "1m 20s",
    model: MODELS.haiku,
  },
  {
    key: "tests",
    parentId: PARENT,
    title: "Run the sync test suite",
    prompt: "Run `vp test src/sync` and report the failures.",
    status: "failed",
    result: "2 of 18 tests failed: the clock-skew case and the offline queue replay. Timed out waiting for a mock server.",
    childId: `${PARENT}-tests`,
    startedAgo: "9m",
    ranFor: "2m 5s",
    model: MODELS.haiku,
  },
  {
    key: "docs",
    parentId: PARENT,
    title: "Draft a changelog entry",
    prompt: "Write a changelog entry for the retry changes.",
    status: "cancelled",
    progress: "Stopped before the draft was written.",
    childId: `${PARENT}-docs`,
    startedAgo: "7m",
    ranFor: "40s",
    model: MODELS.haiku,
  },
  {
    key: "bench",
    parentId: PARENT,
    title: "Benchmark the batching change",
    prompt: "Benchmark pushBatch before and after the change with 1k, 10k and 100k records.",
    status: "interrupted",
    progress: "Interrupted at the 10k run when the parent stopped.",
    childId: `${PARENT}-bench`,
    startedAgo: "6m",
    ranFor: "2m 30s",
    model: MODELS.sonnet,
  },
  {
    key: "backoff",
    parentId: PARENT,
    title: "Add exponential backoff to pushBatch",
    prompt: "Implement exponential backoff with jitter in pushBatch, capped at 30 seconds.",
    status: "running",
    progress: "Editing src/sync/retry.ts, then updating the three call sites.",
    childId: `${PARENT}-backoff`,
    startedAgo: "3m",
    model: MODELS.sonnet,
  },
];

const byKey = (key: string) => {
  const found = specs.find((spec) => spec.key === key);
  if (!found) throw new Error(`x01: no subagent ${key}`);
  return found;
};

const parent = thread({
  id: PARENT,
  project: "agents",
  title: "Subagents: running, done, failed, stopped",
  model: MODELS.opus,
  scenario: {
    id: "X01",
    label: "Subagent rows in every status",
    waitForText: "Add exponential backoff to pushBatch",
  },
  turns: [
    turn({
      at: "12m",
      status: "running",
      took: "12m",
      user: "The sync client retries failed requests too eagerly. Fix it, and use subagents so the audit, tests and the fix run side by side.",
      items: [
        reasoning("Three independent jobs: audit the retry sites, run the tests, and write the fix. I'll hand each to a subagent."),
        ...specs.map((spec) => subagentRow(spec)),
      ],
    }),
  ],
  projection: withSubagents(specs),
  shell: { pendingBackgroundTasks: [pendingSubagentTask(byKey("backoff"))] },
});

const child = (key: string, turns: Parameters<typeof childThread>[0]["turns"], title: string) =>
  childThread({
    id: `${PARENT}-${key}`,
    parentId: PARENT,
    title,
    native: true,
    model: byKey(key).model ?? MODELS.sonnet,
    turns,
  });

const children = [
  child(
    "audit",
    [
      turn({
        at: "11m",
        took: "1m 20s",
        user: byKey("audit").prompt,
        items: [
          command({
            input: "rg -n \"retry\" src/sync",
            output: "src/sync/client.ts:42:  return retry(() => post(batch));\nsrc/sync/client.ts:77:  return retry(() => get(cursor));\nsrc/sync/heartbeat.ts:19:  retry(ping);\n",
          }),
          assistant(byKey("audit").result ?? ""),
        ],
      }),
    ],
    byKey("audit").title,
  ),
  child(
    "tests",
    [
      turn({
        at: "9m",
        took: "2m 5s",
        status: "failed",
        user: byKey("tests").prompt,
        items: [
          command({
            input: "vp test src/sync",
            status: "failed",
            output: " ✓ src/sync/batch.test.ts (9 tests)\n ✗ src/sync/clock.test.ts > handles skew\n ✗ src/sync/queue.test.ts > replays offline queue\n\n Tests  2 failed | 16 passed (18)\n",
          }),
          item((base) => ({
            ...base,
            type: "error",
            status: "failed",
            failure: {
              class: "provider_error",
              message: "The test run ended with failures and the agent could not recover.",
              code: null,
              retryable: false,
            },
          })),
        ],
      }),
    ],
    byKey("tests").title,
  ),
  child(
    "docs",
    [
      turn({
        at: "7m",
        took: "40s",
        status: "cancelled",
        user: byKey("docs").prompt,
        items: [reasoning("Looking at the last three changelog entries for tone.")],
      }),
    ],
    byKey("docs").title,
  ),
  child(
    "bench",
    [
      turn({
        at: "6m",
        took: "2m 30s",
        status: "interrupted",
        user: byKey("bench").prompt,
        items: [
          command({
            input: "vp run bench --records 1000",
            output: "pushBatch  1k   42 ms\n",
          }),
          command({ input: "vp run bench --records 10000", status: "interrupted", output: "pushBatch  10k  " }),
        ],
      }),
    ],
    byKey("bench").title,
  ),
  child(
    "backoff",
    [
      turn({
        at: "3m",
        status: "running",
        user: byKey("backoff").prompt,
        items: [
          reasoning("A small helper keeps the three call sites identical."),
          assistant("Adding `src/sync/retry.ts` with a capped exponential delay and full jitter.", {
            phase: "commentary",
          }),
        ],
      }),
    ],
    byKey("backoff").title,
  ),
];

export default [parent, ...children];
