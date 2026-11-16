// L13 and L14: context compaction (running, then finished with token counts) and one thread for
// every provider goal state shown in the banner at the end of the timeline.
import { ProviderDriverKind, type OrchestrationV2ProviderGoal } from "@t3tools/contracts";

import {
  assistant,
  command,
  exec,
  item,
  reasoning,
  script,
  thread,
  turn,
} from "../../api";
import { streamParagraphs } from "./live-kit";

// L13 -------------------------------------------------------------------------------------------

const DRIVER = ProviderDriverKind.make("codex");

const COMPACTION_SUMMARY =
  "Kept: the goal (move the importer to streaming), the three decisions about batch size, and the open question about retries. Dropped: the long test logs and two abandoned approaches.";

const compactionRunning = thread({
  id: "l13-compaction-running",
  project: "live",
  title: "Compaction: running now",
  scenario: { id: "L13", label: "Context compaction running", waitForText: "Compacting" },
  turns: [
    turn({
      at: "5m",
      status: "running",
      user: "Keep going with the importer, there's a lot of history here.",
      items: [
        command({ input: "vp test src/importer", output: " ✓ src/importer/stream.test.ts (9 tests) 77ms\n" }),
        item((base) => ({
          ...base,
          status: "running" as const,
          completedAt: null,
          type: "compaction",
          driver: DRIVER,
          beforeTokenCount: 182_400,
        })),
      ],
    }),
  ],
  onOpen: script(
    [
      // The compaction finishes, then the agent carries on with the smaller context.
      {
        after: 14_000,
        run: (run) => {
          const open = run.server
            .projection(run.threadId)
            ?.turnItems.findLast((candidate) => candidate.runId === run.runId && candidate.type === "compaction");
          if (!open) return;
          run.complete(open.id, (current) =>
            current.type === "compaction"
              ? { ...current, summary: COMPACTION_SUMMARY, afterTokenCount: 21_300 }
              : current,
          );
        },
      },
      ...exec({ input: "rg -n \"batchSize\" src/importer", output: "src/importer/stream.ts:14:  const batchSize = options.batchSize ?? 500;\n" }, "1.4s", "2s"),
    ],
    {
      loop: streamParagraphs(
        "assistant_message",
        [
          "Context is small again, so I'm re-reading the batch loop before I change how retries work.",
          "The retry wrapper sits outside the batch loop, so one bad row retries the whole batch. Moving it inside.",
        ],
        { after: "8s" },
      ),
    },
  ),
});

const compactionDone = thread({
  id: "l13-compaction-finished",
  project: "live",
  title: "Compaction: finished (182k to 21k tokens)",
  scenario: { id: "L13b", label: "Context compaction finished", waitForText: "182" },
  turns: [
    turn({
      at: "25m",
      took: "3m",
      user: "Continue with the importer.",
      items: [
        item((base) => ({
          ...base,
          type: "compaction",
          driver: DRIVER,
          summary: COMPACTION_SUMMARY,
          beforeTokenCount: 182_400,
          afterTokenCount: 21_300,
        })),
        reasoning("With the context compacted I'm back to the retry question."),
        assistant("Picked up where we left off: batches stay at 500 rows and retries now happen per row."),
      ],
    }),
  ],
});

// L14 -------------------------------------------------------------------------------------------

function goalThread(options: {
  readonly key: string;
  readonly row: string;
  readonly title: string;
  readonly goal: OrchestrationV2ProviderGoal;
  readonly working?: boolean;
  readonly reply: string;
}) {
  const id = `l14-goal-${options.key}`;
  return thread({
    id,
    project: "live",
    title: options.title,
    scenario: { id: options.row, label: `Provider goal: ${options.key}`, waitForText: "Reach 90% coverage" },
    turns: [
      turn({
        at: options.working ? "12m" : "50m",
        took: "4m",
        ...(options.working ? { status: "running" as const } : {}),
        user: "/goal Reach 90% coverage on the pricing package",
        items: options.working
          ? [
              reasoning("Measuring coverage before choosing which files to test first."),
              command({ input: "vp test --coverage src/pricing", output: "pricing/tiers.ts   71.4%\npricing/discounts.ts   64.0%\n" }),
              assistant(options.reply, { phase: "commentary", streaming: false }),
            ]
          : [assistant(options.reply)],
      }),
    ],
    shell: { goal: options.goal },
    ...(options.working
      ? {
          onOpen: script([], {
            loop: streamParagraphs(
              "assistant_message",
              [
                "Added tests for the tiered discount boundaries; coverage on `discounts.ts` is now 78%.",
                "The rounding helper has three untested branches. Writing a table-driven test for them.",
                "Coverage for the package is at 84%. The remaining gap is the legacy currency path.",
              ],
              { after: "9s" },
            ),
          }),
        }
      : {}),
  });
}

const GOAL_TEXT = "Reach 90% coverage on the pricing package without changing its public API";

const goals = [
  goalThread({
    key: "active",
    row: "L14",
    title: "Goal: active, being pursued",
    working: true,
    goal: {
      objective: GOAL_TEXT,
      status: "active",
      tokensUsed: 48_200,
      tokenBudget: 200_000,
      timeUsedSeconds: 760,
      checks: 2,
      lastCheck: "Coverage is 71%, below the target.",
    },
    reply: "Coverage is at 71%. I'm adding tests for the discount tiers first, since they have the least coverage.",
  }),
  goalThread({
    key: "paused",
    row: "L14b",
    title: "Goal: paused",
    goal: { objective: GOAL_TEXT, status: "paused", tokensUsed: 91_500, tokenBudget: 200_000, timeUsedSeconds: 1_980, checks: 4 },
    reply: "Paused at 86% coverage. Resume the goal and I'll cover the last two files.",
  }),
  goalThread({
    key: "blocked",
    row: "L14c",
    title: "Goal: blocked",
    goal: {
      objective: GOAL_TEXT,
      status: "blocked",
      tokensUsed: 63_000,
      tokenBudget: 200_000,
      timeUsedSeconds: 1_240,
      checks: 3,
      lastCheck: "Cannot reach the currency rates fixture.",
    },
    reply: "I'm blocked: the remaining tests need the currency rates fixture, and the fixture server is not reachable from here.",
  }),
  goalThread({
    key: "usage-limited",
    row: "L14d",
    title: "Goal: stopped by a usage limit",
    goal: { objective: GOAL_TEXT, status: "usage_limited", tokensUsed: 120_400, timeUsedSeconds: 2_700, checks: 5 },
    reply: "The provider's usage limit was reached at 88% coverage. The goal continues when the limit resets.",
  }),
  goalThread({
    key: "budget-limited",
    row: "L14e",
    title: "Goal: stopped, token budget used up",
    goal: { objective: GOAL_TEXT, status: "budget_limited", tokensUsed: 200_000, tokenBudget: 200_000, timeUsedSeconds: 3_900, checks: 7 },
    reply: "The 200k token budget is spent and coverage is 89%. Raise the budget to let me finish.",
  }),
  goalThread({
    key: "complete",
    row: "L14f",
    title: "Goal: complete",
    goal: { objective: GOAL_TEXT, status: "complete", tokensUsed: 143_800, tokenBudget: 200_000, timeUsedSeconds: 3_120, checks: 6, lastCheck: "Coverage is 91%." },
    reply: "Coverage on the pricing package is 91%. The goal is met and the public API is unchanged.",
  }),
];

export default [compactionRunning, compactionDone, ...goals];
