// L06 and L07: a todo list that advances while you watch, a proposed plan that streams in and
// ends as "Plan Ready", and a thread that already has a plan waiting for approval.
import {
  NodeId,
  ThreadId,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2PlanStep,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  ago,
  assistant,
  command,
  itemBase,
  now,
  planId,
  reasoning,
  script,
  step,
  thread,
  turn,
  type ItemSpec,
  type RunHandle,
  type ScriptStep,
} from "../../api";
import { finishRun, printingCommand } from "./live-kit";

// L06 -------------------------------------------------------------------------------------------

const TODO_TEXTS = [
  "Read the existing webhook handler",
  "Write failing tests for signature checks",
  "Verify the signature before parsing the body",
  "Return 401 with a clear error body",
  "Document the new header in the API guide",
] as const;

function todoStep(index: number, state: "pending" | "running" | "completed", startedAgo?: string): OrchestrationV2PlanStep {
  const text = TODO_TEXTS[index]!;
  const id = `step-${index + 1}`;
  if (state === "completed") return { id, text, status: "completed", durationMs: 9_000 + index * 7_000 };
  if (state === "running") {
    return { id, text, status: "running", durationAnchorAt: DateTime.formatIso(ago(startedAgo ?? "40s")) };
  }
  return { id, text, status: "pending" };
}

function todoList(threadId: string, steps: ReadonlyArray<OrchestrationV2PlanStep>): ItemSpec {
  const id = planId(threadId, "todo");
  const explanation = "Rejecting unsigned webhook calls";
  return (context) => {
    const artifact: OrchestrationV2PlanArtifact = {
      id,
      threadId: context.threadId,
      runId: context.runId,
      nodeId: NodeId.make(`${context.id}-node`),
      status: "active",
      kind: "todo_list",
      steps: [...steps],
      explanation,
    };
    return {
      item: { ...itemBase(context), type: "todo_list", planId: id, steps: [...steps], explanation },
      plans: [artifact],
    };
  };
}

/** Moves the run's todo list on: the running step completes, the next one starts. */
function advanceTodo(toIndex: number): ScriptStep {
  return step("7s", (run) => {
    const todo = run.server
      .projection(run.threadId)
      ?.turnItems.findLast((candidate) => candidate.runId === run.runId && candidate.type === "todo_list");
    if (!todo || todo.type !== "todo_list") return;
    const at = DateTime.formatIso(now());
    const steps = todo.steps.map((entry, index): OrchestrationV2PlanStep => {
      if (index < toIndex) {
        return entry.status === "completed"
          ? entry
          : { id: entry.id, text: entry.text, status: "completed", durationMs: 6_500 + index * 3_000 };
      }
      if (index === toIndex) {
        return { id: entry.id, text: entry.text, status: "running", durationAnchorAt: at };
      }
      return entry;
    });
    run.update(todo.id, (current) => (current.type === "todo_list" ? { ...current, steps } : current));
  });
}

const THREAD_L06 = "l06-todo-in-progress";

const todo = thread({
  id: THREAD_L06,
  project: "live",
  title: "Todo list: three of five steps done",
  scenario: { id: "L06", label: "Todo list in progress", waitForText: "Three of the five" },
  turns: [
    turn({
      at: "4m",
      took: "3m",
      status: "running",
      user: "Reject webhook calls that are not signed. Keep a list so I can follow along.",
      items: [
        reasoning("The handler parses the body before it looks at any header, so the check has to move up."),
        todoList(THREAD_L06, [
          todoStep(0, "completed"),
          todoStep(1, "completed"),
          todoStep(2, "completed"),
          todoStep(3, "running", "40s"),
          todoStep(4, "pending"),
        ]),
        assistant(
          "Three of the five steps are done: I read the handler, wrote the failing tests and moved the signature check ahead of the body parsing. Next is the 401 response, then the docs. The list is in the Tasks bar above the message box.",
          { phase: "commentary" },
        ),
        command({
          input: "vitest watch src/webhooks",
          status: "running",
          output: " ✓ src/webhooks/verify.test.ts (4 tests) 18ms\n ❯ src/webhooks/handler.test.ts (3 tests | 2 failed)\n",
        }),
      ],
    }),
  ],
  onOpen: script(
    [advanceTodo(4), advanceTodo(5)],
    {
      loop: printingCommand({
        input: "vitest run src/webhooks",
        lines: [" ✓ src/webhooks/verify.test.ts (4 tests) 18ms", " ✓ src/webhooks/handler.test.ts (5 tests) 31ms"],
        every: "1s",
        after: "9s",
      }),
    },
  ),
});

// L07 -------------------------------------------------------------------------------------------

const PLAN_MARKDOWN = `# Move sessions from cookies to signed tokens

## Why

Every request reads the session row from the database. Signed tokens let most requests skip that lookup.

## Steps

1. Add a \`SessionToken\` module that signs and verifies a short payload.
2. Issue a token at sign-in, next to the existing cookie, and read it first.
3. Keep the database row for revocation: check it only for sensitive routes.
4. Remove the cookie path after one release.

## Risks

- A leaked signing key lets anyone mint sessions, so the key rotates on a schedule.
- Logging out must still end the session everywhere, which is why the row stays.
`;

function planArtifact(
  threadId: string,
  runId: OrchestrationV2PlanArtifact["runId"],
  status: "draft" | "active",
  markdown: string,
): OrchestrationV2PlanArtifact {
  return {
    id: planId(threadId, "proposed"),
    threadId: ThreadId.make(threadId),
    runId,
    nodeId: NodeId.make(`${threadId}-plan-node`),
    status,
    kind: "proposed_plan",
    markdown,
  };
}

function proposedPlan(threadId: string, markdown: string, streaming: boolean): ItemSpec {
  const id = planId(threadId, "proposed");
  return (context) => ({
    item: {
      ...itemBase(context, streaming ? "running" : undefined),
      ...(streaming ? { completedAt: null } : {}),
      type: "proposed_plan",
      planId: id,
      markdown,
      streaming,
    },
    plans: [planArtifact(threadId, context.runId, streaming ? "draft" : "active", markdown)],
  });
}

const THREAD_L07 = "l07-plan-streaming";
const PLAN_PREFIX_LINES = 6;
const PLAN_LINES = PLAN_MARKDOWN.split("\n");

function streamPlanSteps(): ScriptStep[] {
  const steps: ScriptStep[] = [];
  for (let upTo = PLAN_PREFIX_LINES + 1; upTo <= PLAN_LINES.length; upTo += 1) {
    steps.push(
      step("900ms", (run: RunHandle) => {
        const open = run.server
          .projection(run.threadId)
          ?.turnItems.findLast((candidate) => candidate.runId === run.runId && candidate.type === "proposed_plan");
        if (!open) return;
        const markdown = PLAN_LINES.slice(0, upTo).join("\n");
        run.update(open.id, (current) => (current.type === "proposed_plan" ? { ...current, markdown } : current));
      }),
    );
  }
  // The plan is final: the card offers it for approval and the run ends.
  steps.push(
    step("1.2s", (run) => {
      const open = run.server
        .projection(run.threadId)
        ?.turnItems.findLast((candidate) => candidate.runId === run.runId && candidate.type === "proposed_plan");
      if (!open) return;
      run.complete(open.id, (current) =>
        current.type === "proposed_plan" ? { ...current, markdown: PLAN_MARKDOWN, streaming: false } : current,
      );
      run.server.emit(run.threadId, [
        { type: "plan.updated", payload: planArtifact(THREAD_L07, run.run()?.id ?? null, "active", PLAN_MARKDOWN) },
      ]);
      finishRun(run);
    }),
  );
  return steps;
}

const planStreaming = thread({
  id: THREAD_L07,
  project: "live",
  title: "Plan: streaming in, then ready for review",
  scenario: { id: "L07", label: "Proposed plan streaming", waitForText: "signed tokens" },
  interactionMode: "plan",
  turns: [
    turn({
      at: "50s",
      status: "running",
      user: "Plan how we move sessions from cookies to signed tokens. Don't change anything yet.",
      items: [
        reasoning("Reading how sessions are stored today before proposing anything."),
        proposedPlan(THREAD_L07, PLAN_LINES.slice(0, PLAN_PREFIX_LINES).join("\n"), true),
      ],
    }),
  ],
  onOpen: script(streamPlanSteps()),
});

const THREAD_L07B = "l07-plan-ready";

const planReady = thread({
  id: THREAD_L07B,
  project: "live",
  title: "Plan: ready, reply to approve it",
  scenario: { id: "L07b", label: "Plan ready, waiting for your reply", waitForText: "signed tokens" },
  interactionMode: "plan",
  turns: [
    turn({
      at: "9m",
      took: "1m 10s",
      user: "Plan how we move sessions from cookies to signed tokens. Don't change anything yet.",
      items: [
        reasoning("Reading how sessions are stored today before proposing anything."),
        proposedPlan(THREAD_L07B, PLAN_MARKDOWN, false),
        assistant("The plan is ready. Reply \"go ahead\" and I will start with step 1, or tell me what to change first."),
      ],
    }),
  ],
});

export default [todo, planStreaming, planReady];
