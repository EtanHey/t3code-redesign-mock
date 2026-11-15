// Fixture builders. `thread()` turns a short spec into a full, contract-typed
// OrchestrationV2ThreadProjection; times are relative to page boot so planted data looks fresh.
// For anything the builders do not cover, `item()` takes a raw turn item of any of the 25 types,
// and `thread({ thread, shell, projection })` reach every app-thread, shell and projection field.
import {
  MessageId,
  NodeId,
  PlanId,
  ProviderSessionId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2RunAttempt,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  type OrchestrationV2TurnItemStatus,
  type OrchestrationV2UserInputQuestion,
  type ProjectId,
  type ProviderApprovalOption,
  type ProviderRequestKind,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { assistantItem as upstreamAssistantItem, userItem as upstreamUserItem } from "../../../test/fakeEnvironment";
import { ago, plus, spanMs, type Span } from "./clock";
import { DEFAULT_MODEL, projectIdOf, PLANTED_PROJECTS, type PlantedProjectKey } from "./constants";
import type { ScenarioMeta, ThreadDefinition, ThreadRpcAnswers } from "./definitions";
import { attemptStatusOf, runPlumbing } from "./plumbing";
import type { RunScript } from "./script";

/** The provider session planted requests answer through. */
export const MOCK_PROVIDER_SESSION = ProviderSessionId.make("mock-provider-session");

// Items -----------------------------------------------------------------------------------

export interface ItemContext {
  readonly threadId: ThreadId;
  readonly runId: RunId | null;
  readonly ordinal: number;
  readonly id: TurnItemId;
  /** When the item started. */
  readonly at: DateTime.Utc;
  /** When the item ended, or null while the run it belongs to is live and this is its last item. */
  readonly endedAt: DateTime.Utc | null;
}

export function itemBase(context: ItemContext, status?: OrchestrationV2TurnItemStatus) {
  const live = context.endedAt === null;
  return {
    id: context.id,
    threadId: context.threadId,
    runId: context.runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: context.ordinal,
    status: status ?? (live ? ("running" as const) : ("completed" as const)),
    title: null,
    startedAt: context.at,
    completedAt: live ? null : context.endedAt,
    updatedAt: context.endedAt ?? context.at,
  };
}
export type ItemBase = ReturnType<typeof itemBase>;

/** What one planted item adds to the projection. */
export interface Planted {
  readonly item: OrchestrationV2TurnItem;
  readonly runtimeRequests?: ReadonlyArray<OrchestrationV2RuntimeRequest>;
  readonly plans?: ReadonlyArray<OrchestrationV2PlanArtifact>;
  readonly message?: OrchestrationV2ConversationMessage;
}

export type ItemSpec = (context: ItemContext) => Planted;

/** The escape hatch: any turn item, built from the ids, ordinal and times in `base`. */
export function item(
  build: (base: ItemBase, context: ItemContext) => OrchestrationV2TurnItem,
): ItemSpec {
  return (context) => ({ item: build(itemBase(context), context) });
}

function messageOf(
  turnItem: Extract<OrchestrationV2TurnItem, { type: "user_message" | "assistant_message" }>,
): OrchestrationV2ConversationMessage {
  return {
    id: turnItem.messageId,
    threadId: turnItem.threadId,
    runId: turnItem.runId,
    nodeId: null,
    role: turnItem.type === "user_message" ? "user" : "assistant",
    text: turnItem.text,
    attachments: turnItem.attachments ?? [],
    streaming: turnItem.type === "assistant_message" ? turnItem.streaming : false,
    createdAt: turnItem.startedAt ?? turnItem.updatedAt,
    updatedAt: turnItem.updatedAt,
    createdBy: turnItem.type === "user_message" ? turnItem.createdBy : "system",
    creationSource: turnItem.type === "user_message" ? turnItem.creationSource : "server",
  };
}

export interface UserOptions {
  readonly text: string;
  readonly inputIntent?: Extract<OrchestrationV2TurnItem, { type: "user_message" }>["inputIntent"];
  /** Any other user_message field (attachments, context, modelSwitch, ...). */
  readonly extra?: Partial<Extract<OrchestrationV2TurnItem, { type: "user_message" }>>;
}

export function userMessage(spec: string | UserOptions): ItemSpec {
  const options = typeof spec === "string" ? { text: spec } : spec;
  return (context) => {
    const runId = context.runId ?? RunId.make(`${context.threadId}-unbound`);
    const turnItem = {
      ...upstreamUserItem(context.threadId, runId, context.id, context.ordinal, options.text),
      ...itemBase({ ...context, endedAt: context.at }, "completed"),
      runId: context.runId,
      inputIntent: options.inputIntent ?? "turn_start",
      ...options.extra,
    } satisfies OrchestrationV2TurnItem;
    return { item: turnItem, message: messageOf(turnItem) };
  };
}

export interface AssistantOptions {
  readonly phase?: "commentary" | "partial_answer" | "final_answer";
  /** Still streaming: the item stays running with the text so far. */
  readonly streaming?: boolean;
}

export function assistant(text: string, options: AssistantOptions = {}): ItemSpec {
  return (context) => {
    const streaming = options.streaming === true;
    const runId = context.runId ?? RunId.make(`${context.threadId}-unbound`);
    const turnItem = {
      ...upstreamAssistantItem(context.threadId, runId, context.id, context.ordinal, text, streaming),
      ...itemBase(streaming ? { ...context, endedAt: null } : context, streaming ? "running" : undefined),
      runId: context.runId,
      phase: options.phase ?? "final_answer",
      streaming,
    } satisfies OrchestrationV2TurnItem;
    return { item: turnItem, message: messageOf(turnItem) };
  };
}

export function reasoning(text: string, options: { readonly streaming?: boolean } = {}): ItemSpec {
  return (context) => ({
    item: {
      ...itemBase(context, options.streaming ? "running" : undefined),
      ...(options.streaming ? { completedAt: null } : {}),
      type: "reasoning",
      text,
      streaming: options.streaming === true,
    },
  });
}

export interface CommandOptions {
  readonly input: string;
  readonly output?: string;
  readonly exitCode?: number;
  /** Defaults to completed (or running when it is the live run's last item). */
  readonly status?: OrchestrationV2TurnItemStatus;
  readonly extra?: Partial<Extract<OrchestrationV2TurnItem, { type: "command_execution" }>>;
}

export function command(options: CommandOptions): ItemSpec {
  return (context) => {
    const base = itemBase(context, options.status);
    const finished = base.status === "completed" || base.status === "failed";
    return {
      item: {
        ...base,
        ...(finished ? {} : { completedAt: null }),
        type: "command_execution",
        input: options.input,
        ...(options.output === undefined ? {} : { output: options.output }),
        ...(finished ? { exitCode: options.exitCode ?? (base.status === "failed" ? 1 : 0) } : {}),
        ...options.extra,
      },
    };
  };
}

export interface FileChangeOptions {
  readonly path: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly diff?: string;
}

export function fileChange(options: FileChangeOptions): ItemSpec {
  return (context) => ({
    item: {
      ...itemBase(context),
      type: "file_change",
      fileName: options.path,
      ...(options.additions === undefined ? {} : { additions: options.additions }),
      ...(options.deletions === undefined ? {} : { deletions: options.deletions }),
      ...(options.diff === undefined ? {} : { diffStr: options.diff }),
      changes: [{ operation: "update", path: options.path }],
    },
  });
}

function requestRecord(
  context: ItemContext,
  requestId: RuntimeRequestId,
  kind: OrchestrationV2RuntimeRequest["kind"],
): OrchestrationV2RuntimeRequest {
  return {
    id: requestId,
    nodeId: NodeId.make(`${context.id}-node`),
    providerTurnId: null,
    nativeRequestRef: null,
    kind,
    status: "pending",
    responseCapability: { type: "live", providerSessionId: MOCK_PROVIDER_SESSION },
    createdAt: context.at,
    resolvedAt: null,
  };
}

/** A question the agent waits on: a `user_input_request` item plus its pending runtime request. */
export function question(questions: ReadonlyArray<OrchestrationV2UserInputQuestion>): ItemSpec {
  return (context) => {
    const requestId = RuntimeRequestId.make(`${context.id}-request`);
    return {
      item: {
        ...itemBase(context, "waiting"),
        completedAt: null,
        type: "user_input_request",
        requestId,
        questions: [...questions],
      },
      runtimeRequests: [requestRecord(context, requestId, "user_input")],
    };
  };
}

export interface ApprovalOptions {
  readonly requestKind: ProviderRequestKind;
  readonly prompt?: string;
  readonly reason?: string;
  readonly options?: ReadonlyArray<ProviderApprovalOption>;
  readonly extra?: Partial<Extract<OrchestrationV2TurnItem, { type: "approval_request" }>>;
}

/** An approval the agent waits on: an `approval_request` item plus its pending runtime request. */
export function approval(options: ApprovalOptions): ItemSpec {
  return (context) => {
    const requestId = RuntimeRequestId.make(`${context.id}-request`);
    return {
      item: {
        ...itemBase(context, "waiting"),
        completedAt: null,
        type: "approval_request",
        requestId,
        requestKind: options.requestKind,
        ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
        ...(options.options === undefined ? {} : { options: [...options.options] }),
        ...options.extra,
      },
      runtimeRequests: [requestRecord(context, requestId, options.requestKind)],
    };
  };
}

// Turns and threads -------------------------------------------------------------------------

export interface TurnSpec {
  /** How long before page boot the user sent it, such as `"42m"`. */
  readonly at: Span;
  readonly user: string | UserOptions;
  /** The run's work, in order. */
  readonly items?: ReadonlyArray<ItemSpec>;
  /** How long the run took; items are spaced across it. Default 40s. */
  readonly took?: Span;
  /** Default `completed`. A live status (`running`, `waiting`, ...) leaves the run open. */
  readonly status?: OrchestrationV2RunStatus;
  readonly model?: ModelSelection;
  /** Any other run field (queuePosition, freshContext, retryOfRunId, ...). */
  readonly run?: Partial<OrchestrationV2Run>;
}

export function turn(spec: TurnSpec): TurnSpec {
  return spec;
}

const LIVE_RUN_STATUSES: ReadonlySet<OrchestrationV2RunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export interface ThreadSpec {
  /** Becomes the thread id; also the URL: `/<environment>/<id>`. */
  readonly id: string;
  readonly project: PlantedProjectKey | ProjectId;
  readonly title: string;
  readonly scenario?: ScenarioMeta;
  readonly environmentId?: EnvironmentId;
  readonly model?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  /** Default: one minute before the first turn. */
  readonly createdAt?: Span;
  readonly turns: ReadonlyArray<TurnSpec>;
  /** Any app-thread field: pinnedAt, tags, settledAt, snoozedUntil, lineage, pullRequests, ... */
  readonly thread?: Partial<OrchestrationV2AppThread>;
  /** Shell-only fields: pendingBackgroundTasks, goal, blockedOnThreadWait, lastError, ... */
  readonly shell?: Partial<OrchestrationV2ThreadShell>;
  /** Last word on the projection: add plans, subagents, checkpoints, provider threads, ... */
  readonly projection?: (projection: OrchestrationV2ThreadProjection) => OrchestrationV2ThreadProjection;
  readonly olderSettled?: boolean;
  readonly script?: RunScript;
  readonly onOpen?: RunScript;
  readonly rpc?: ThreadRpcAnswers;
}

function isPlantedProjectKey(value: string): value is PlantedProjectKey {
  return Object.hasOwn(PLANTED_PROJECTS, value);
}

/** Rebuilds the projected wrapper list the client reads, every item local and visible. */
export function visibleItemsOf(
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): OrchestrationV2ProjectedTurnItem[] {
  return turnItems
    .filter((turnItem) => !(turnItem.type === "user_message" && turnItem.inputIntent === "queued_turn"))
    .map((turnItem, position) => ({
      position,
      visibility: "local",
      sourceThreadId: turnItem.threadId,
      sourceItemId: turnItem.id,
      item: turnItem,
    }));
}

export function emptyProjection(thread: OrchestrationV2AppThread): OrchestrationV2ThreadProjection {
  return {
    thread,
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: thread.updatedAt,
  };
}

export function thread(spec: ThreadSpec): ThreadDefinition {
  const threadId = ThreadId.make(spec.id);
  const projectId = isPlantedProjectKey(spec.project) ? projectIdOf(spec.project) : spec.project;
  const model = spec.model ?? DEFAULT_MODEL;
  const firstAt = spec.turns[0] ? ago(spec.turns[0].at) : ago("1h");
  const createdAt = spec.createdAt === undefined ? plus(firstAt, -60_000) : ago(spec.createdAt);

  const runs: OrchestrationV2Run[] = [];
  const turnItems: OrchestrationV2TurnItem[] = [];
  const runtimeRequests: OrchestrationV2RuntimeRequest[] = [];
  const plans: OrchestrationV2PlanArtifact[] = [];
  const messages: OrchestrationV2ConversationMessage[] = [];
  const attempts: OrchestrationV2RunAttempt[] = [];
  const providerTurns: OrchestrationV2ProviderTurn[] = [];
  let ordinal = 0;
  let updatedAt = createdAt;

  const plant = (planted: Planted) => {
    turnItems.push(planted.item);
    runtimeRequests.push(...(planted.runtimeRequests ?? []));
    plans.push(...(planted.plans ?? []));
    if (planted.message) messages.push(planted.message);
    if (DateTime.toEpochMillis(planted.item.updatedAt) > DateTime.toEpochMillis(updatedAt)) {
      updatedAt = planted.item.updatedAt;
    }
  };

  spec.turns.forEach((turnSpec, index) => {
    const runId = RunId.make(`${spec.id}-run-${index + 1}`);
    const status = turnSpec.status ?? "completed";
    const live = LIVE_RUN_STATUSES.has(status);
    const requestedAt = ago(turnSpec.at);
    const took = spanMs(turnSpec.took ?? "40s");
    const startedAt = plus(requestedAt, Math.min(1_500, took / 10));
    const completedAt = live ? null : plus(requestedAt, took);
    const userId = `${spec.id}-item-${ordinal}`;
    plant(
      userMessage(turnSpec.user)({
        threadId,
        runId,
        ordinal,
        id: TurnItemId.make(userId),
        at: requestedAt,
        endedAt: requestedAt,
      }),
    );
    ordinal += 1;
    const work = turnSpec.items ?? [];
    work.forEach((spec_, workIndex) => {
      const id = TurnItemId.make(`${spec.id}-item-${ordinal}`);
      const step = took / (work.length + 1);
      const at = plus(startedAt, step * workIndex);
      const isLast = workIndex === work.length - 1;
      plant(
        spec_({
          threadId,
          runId,
          ordinal,
          id,
          at,
          endedAt: live && isLast ? null : plus(at, step * 0.8),
        }),
      );
      ordinal += 1;
    });
    const plannedRun: OrchestrationV2Run = {
      id: runId,
      threadId,
      ordinal: index + 1,
      providerInstanceId: (turnSpec.model ?? model).instanceId,
      modelSelection: turnSpec.model ?? model,
      providerThreadId: null,
      userMessageId: MessageId.make(userId),
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt,
      startedAt: status === "queued" || status === "preparing" ? null : startedAt,
      completedAt,
      checkpointId: null,
      contextHandoffId: null,
      ...turnSpec.run,
    };
    // A run that got going has an attempt and a provider turn, or the UI reads it as "Starting".
    const attemptStatus = attemptStatusOf(plannedRun.status);
    if (attemptStatus !== null && plannedRun.activeAttemptId === null) {
      const { attempt, turn: providerTurn } = runPlumbing(plannedRun, attemptStatus);
      attempts.push(attempt);
      providerTurns.push(providerTurn);
      runs.push({ ...plannedRun, activeAttemptId: attempt.id });
    } else {
      runs.push(plannedRun);
    }
  });

  const appThread: OrchestrationV2AppThread = {
    id: threadId,
    projectId,
    title: spec.title,
    providerInstanceId: model.instanceId,
    modelSelection: model,
    runtimeMode: spec.runtimeMode ?? "full-access",
    interactionMode: spec.interactionMode ?? "default",
    branch: spec.branch === undefined ? "main" : spec.branch,
    worktreePath: spec.worktreePath ?? null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    createdAt,
    updatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    // Visited after its last activity, so planted threads do not all read as unread.
    lastVisitedAt: plus(updatedAt, 1_000),
    deletedAt: null,
    ...spec.thread,
  };

  const base: OrchestrationV2ThreadProjection = {
    ...emptyProjection(appThread),
    runs,
    attempts,
    providerTurns,
    runtimeRequests,
    messages,
    plans,
    turnItems,
    visibleTurnItems: visibleItemsOf(turnItems),
    updatedAt,
  };
  const projection = spec.projection ? spec.projection(base) : base;

  return {
    kind: "thread",
    projection,
    ...(spec.environmentId ? { environmentId: spec.environmentId } : {}),
    ...(spec.shell ? { shell: spec.shell } : {}),
    ...(spec.olderSettled ? { olderSettled: true } : {}),
    ...(spec.scenario ? { scenario: spec.scenario } : {}),
    ...(spec.script ? { script: spec.script } : {}),
    ...(spec.onOpen ? { onOpen: spec.onOpen } : {}),
    ...(spec.rpc ? { rpc: spec.rpc } : {}),
  };
}

/** A plan artifact for `proposed_plan` / `todo_list` items, when a fixture needs one. */
export function planId(threadId: string, name: string): PlanId {
  return PlanId.make(`${threadId}-plan-${name}`);
}
