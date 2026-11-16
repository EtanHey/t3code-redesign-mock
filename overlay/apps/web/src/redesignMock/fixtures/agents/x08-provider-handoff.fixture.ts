// X08: a provider handoff. The conversation moves between a Codex model and a Claude model; each
// switch to a different provider carries a "Context handoff" divider (the strategy is in its
// record, shown in the thread's context handoff details). Two threads cover all five strategies,
// and the last handoff failed so the divider reads in the error tone.
import {
  ContextHandoffId,
  ProviderThreadId,
  RunId,
  ThreadId,
  type OrchestrationV2ContextHandoff,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";

import {
  ago,
  assistant,
  CLAUDE,
  CODEX,
  item,
  MODELS,
  plus,
  thread,
  turn,
  type ItemSpec,
  type TurnSpec,
} from "~/redesignMock/api";

type Strategy = OrchestrationV2ContextHandoff["strategy"];
type Model = (typeof MODELS)[keyof typeof MODELS];

interface HandoffSpec {
  readonly threadId: string;
  /** The run (1-based) that follows the switch. */
  readonly toRun: number;
  readonly from: Model;
  readonly to: Model;
  readonly strategy: Strategy;
  readonly summary: string;
  readonly failed?: boolean;
  readonly at: string;
}

const handoffIdOf = (spec: HandoffSpec) => ContextHandoffId.make(`${spec.threadId}-handoff-${spec.toRun}`);

function handoffItem(spec: HandoffSpec): ItemSpec {
  return item((base) => ({
    ...base,
    type: "handoff",
    status: spec.failed ? "failed" : "completed",
    contextHandoffId: handoffIdOf(spec),
    fromProviderThreadIds: [ProviderThreadId.make(`${spec.threadId}-${spec.from.instanceId}-thread`)],
    toProviderThreadId: ProviderThreadId.make(`${spec.threadId}-${spec.to.instanceId}-thread`),
    fromProviderInstanceIds: [spec.from.instanceId],
    toProviderInstanceId: spec.to.instanceId,
    fromModelSelections: [spec.from],
    toModel: spec.to.model,
    strategy: spec.strategy,
    summary: spec.summary,
  }));
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  full_thread_summary: "full thread summary",
  delta_since_target_last_seen: "changes since the target last saw the thread",
  fork_delta_summary: "fork delta summary",
  checkpoint_summary: "checkpoint summary",
  manual_context: "manual context",
};

/**
 * The switch itself is only a small "A → B" note under the user's message, so the answer that
 * follows says which strategy carried the context over and what it contained.
 */
function answerAfterHandoff(spec: HandoffSpec, text: string): ItemSpec {
  return assistant(
    `**Context handoff:** ${STRATEGY_LABELS[spec.strategy]}. ${spec.summary}\n\n${text}`,
  );
}

/** The red row of a handoff that did not go through, with the reason. */
function handoffFailure(spec: HandoffSpec): ItemSpec {
  return item((base) => ({
    ...base,
    type: "error",
    status: "failed",
    title: "Context handoff failed",
    failure: {
      class: "provider_error",
      message: `Strategy "${STRATEGY_LABELS[spec.strategy]}": ${spec.summary} The run did not start. Try a shorter summary or another strategy.`,
      code: null,
      retryable: true,
    },
  }));
}

function handoffRecord(spec: HandoffSpec): OrchestrationV2ContextHandoff {
  return {
    id: handoffIdOf(spec),
    transferId: null,
    threadId: ThreadId.make(spec.threadId),
    targetRunId: RunId.make(`${spec.threadId}-run-${spec.toRun}`),
    fromProviderThreadIds: [ProviderThreadId.make(`${spec.threadId}-${spec.from.instanceId}-thread`)],
    toProviderThreadId: ProviderThreadId.make(`${spec.threadId}-${spec.to.instanceId}-thread`),
    coveredRunOrdinals: { from: 1, to: Math.max(1, spec.toRun - 1) },
    strategy: spec.strategy,
    status: spec.failed ? "failed" : "ready",
    summaryMessageId: null,
    summaryText: spec.summary,
    createdByProviderInstanceId: spec.from.instanceId,
    createdAt: ago(spec.at),
    updatedAt: plus(ago(spec.at), 500),
  };
}

const withHandoffs = (specs: ReadonlyArray<HandoffSpec>) =>
  (projection: OrchestrationV2ThreadProjection): OrchestrationV2ThreadProjection => ({
    ...projection,
    runs: projection.runs.map((run) => {
      const spec = specs.find((candidate) => `${candidate.threadId}-run-${candidate.toRun}` === run.id);
      return spec ? { ...run, contextHandoffId: handoffIdOf(spec) } : run;
    }),
    contextHandoffs: [...projection.contextHandoffs, ...specs.map(handoffRecord)],
  });

// Thread 1: Codex -> Claude -> Codex ---------------------------------------------------------

const ONE = "x08-provider-handoff";
const oneHandoffs: ReadonlyArray<HandoffSpec> = [
  {
    threadId: ONE, toRun: 2, from: MODELS.astra, to: MODELS.opus, strategy: "full_thread_summary", at: "40m",
    summary: "First provider switch: the whole conversation so far was summarized for Claude (2 messages, 1 command).",
  },
  {
    threadId: ONE, toRun: 3, from: MODELS.opus, to: MODELS.sol, strategy: "delta_since_target_last_seen", at: "25m",
    summary: "Only what happened since Codex last saw the thread was sent: 1 run, 1 file change.",
  },
];

const one = thread({
  id: ONE,
  project: "agents",
  title: "Provider handoff: Codex to Claude and back",
  model: MODELS.astra,
  scenario: { id: "X08", label: "Provider handoff across drivers", waitForText: "Back to Codex to write it." },
  turns: [
    turn({
      at: "45m",
      took: "1m",
      model: MODELS.astra,
      user: "Outline how to split the report generator into a fetch step and a render step.",
      items: [assistant("Two modules: `fetchReportData` returns plain rows, and `renderReport` turns rows into HTML. The generator only wires them together.")],
    }),
    turn({
      at: "40m",
      took: "1m",
      model: MODELS.opus,
      user: "Switching to Claude for the tricky part: handle partial fetch failures.",
      items: [
        handoffItem(oneHandoffs[0]!),
        answerAfterHandoff(oneHandoffs[0]!, "Return a result per source with its error, so `renderReport` can show the sections that loaded and mark the rest unavailable."),
      ],
    }),
    turn({
      at: "25m",
      took: "1m",
      model: MODELS.sol,
      user: "Back to Codex to write it.",
      items: [
        handoffItem(oneHandoffs[1]!),
        answerAfterHandoff(oneHandoffs[1]!, "Written: `report/fetch.ts` returns `{ source, rows, error }[]` and `report/render.ts` renders unavailable sections with a notice."),
      ],
    }),
  ],
  projection: withHandoffs(oneHandoffs),
  shell: { providerInstanceHistory: [CODEX, CLAUDE] },
});

// Thread 2: the other three strategies, the last one failed ----------------------------------

const TWO = "x08-provider-handoff-strategies";
const twoHandoffs: ReadonlyArray<HandoffSpec> = [
  {
    threadId: TWO, toRun: 2, from: MODELS.opus, to: MODELS.terra, strategy: "fork_delta_summary", at: "30m",
    summary: "The thread was forked, so only the difference from the fork point was summarized.",
  },
  {
    threadId: TWO, toRun: 3, from: MODELS.terra, to: MODELS.sonnet, strategy: "checkpoint_summary", at: "20m",
    summary: "The summary was built from the last checkpoint: 6 files changed since the start.",
  },
  {
    threadId: TWO, toRun: 4, from: MODELS.sonnet, to: MODELS.astra, strategy: "manual_context", failed: true, at: "10m",
    summary: "Manual context could not be delivered: the target session rejected the pasted summary as too long.",
  },
];

const twoTurns: TurnSpec[] = [
  turn({
    at: "35m",
    took: "40s",
    model: MODELS.opus,
    user: "List the files that read the feature flags.",
    items: [assistant("Four files read flags: `flags.ts`, `Header.tsx`, `routes.ts` and `billing/gate.ts`.")],
  }),
  turn({
    at: "30m",
    took: "40s",
    model: MODELS.terra,
    user: "Continue in a Codex model: rename the flag helper.",
    items: [handoffItem(twoHandoffs[0]!), answerAfterHandoff(twoHandoffs[0]!, "Renamed `isEnabled` to `hasFlag` in all four files.")],
  }),
  turn({
    at: "20m",
    took: "40s",
    model: MODELS.sonnet,
    user: "Hand it to Sonnet to double check the rename.",
    items: [handoffItem(twoHandoffs[1]!), answerAfterHandoff(twoHandoffs[1]!, "The rename is complete and no call site still uses `isEnabled`.")],
  }),
  turn({
    at: "10m",
    took: "10s",
    status: "failed",
    model: MODELS.astra,
    user: "Now back to Astra with a manual summary.",
    items: [handoffItem(twoHandoffs[2]!), handoffFailure(twoHandoffs[2]!)],
  }),
];

const two = thread({
  id: TWO,
  project: "agents",
  title: "Provider handoff: every strategy, one failed",
  model: MODELS.astra,
  scenario: { id: "X08b", label: "Provider handoff strategies and a failed handoff", waitForText: "Now back to Astra with a manual summary." },
  turns: twoTurns,
  projection: withHandoffs(twoHandoffs),
  shell: { providerInstanceHistory: [CLAUDE, CODEX] },
});

export default [one, two];
