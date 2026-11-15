// Shared builders for the agents lane (not a fixture itself: only `*.fixture.ts` files register).
// A subagent shows up in three places that must agree: the `subagent` turn item in the parent's
// timeline, the `subagents` record in the parent's projection, and the child thread it opens.
import {
  NodeId,
  ProviderDriverKind,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2PendingBackgroundTask,
  type OrchestrationV2RemoteTaskChild,
  type OrchestrationV2Subagent,
  type OrchestrationV2SubagentWorkflow,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";

import {
  ago,
  CLAUDE,
  CODEX,
  item,
  MODELS,
  plus,
  thread,
  type ItemSpec,
  type Span,
  type ThreadDefinition,
  type ThreadSpec,
  type TurnSpec,
} from "~/redesignMock/api";

export type SubagentStatus = OrchestrationV2Subagent["status"];

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(["completed", "failed", "cancelled", "interrupted"]);

export const driverOf = (instance: ModelSelection["instanceId"]) =>
  ProviderDriverKind.make(instance === CLAUDE ? "claudeAgent" : "codex");

export interface SubagentSpec {
  /** Short key; the subagent's node id is `<parent>-agent-<key>`. */
  readonly key: string;
  readonly parentId: string;
  /** Which of the parent's runs spawned it. Default 1. */
  readonly runIndex?: number;
  readonly title: string;
  readonly prompt: string;
  readonly status: SubagentStatus;
  readonly origin?: OrchestrationV2Subagent["origin"];
  readonly model?: ModelSelection;
  readonly progress?: string;
  readonly result?: string | null;
  /** The child thread it opens; null (default) when the row has none. */
  readonly childId?: string | null;
  /** How long before page boot it started, such as `"4m"`. */
  readonly startedAgo: Span;
  /** How long it ran, for terminal statuses. Default 90s. */
  readonly ranFor?: Span;
  readonly remoteChild?: OrchestrationV2RemoteTaskChild;
  readonly workflow?: OrchestrationV2SubagentWorkflow;
  readonly extra?: Partial<OrchestrationV2Subagent>;
}

export const subagentIdOf = (parentId: string, key: string) => NodeId.make(`${parentId}-agent-${key}`);

/** The `subagents` record the parent's projection carries. */
export function subagentRecord(spec: SubagentSpec): OrchestrationV2Subagent {
  const model = spec.model ?? MODELS.sonnet;
  const runId = RunId.make(`${spec.parentId}-run-${spec.runIndex ?? 1}`);
  const startedAt = ago(spec.startedAgo);
  const terminal = TERMINAL.has(spec.status);
  const completedAt = terminal ? plus(startedAt, spec.ranFor ?? "90s") : null;
  return {
    id: subagentIdOf(spec.parentId, spec.key),
    threadId: ThreadId.make(spec.parentId),
    runId,
    parentNodeId: NodeId.make(`${runId}-root`),
    origin: spec.origin ?? "provider_native",
    createdBy: "agent",
    driver: driverOf(model.instanceId),
    providerInstanceId: model.instanceId,
    providerThreadId: null,
    childThreadId: spec.childId ? ThreadId.make(spec.childId) : null,
    ...(spec.remoteChild ? { remoteChild: spec.remoteChild } : {}),
    nativeTaskRef: null,
    prompt: spec.prompt,
    title: spec.title,
    model: model.model,
    modelSelection: model,
    status: spec.status,
    ...(spec.progress === undefined ? {} : { progress: spec.progress }),
    ...(spec.workflow ? { workflow: spec.workflow } : {}),
    result: spec.result ?? null,
    startedAt,
    completedAt,
    updatedAt: completedAt ?? startedAt,
    ...spec.extra,
  };
}

/** The `subagent` item in the parent's timeline. */
export function subagentRow(spec: SubagentSpec): ItemSpec {
  const record = subagentRecord(spec);
  return item((base) => ({
    ...base,
    type: "subagent",
    title: spec.title,
    status: spec.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
    subagentId: record.id,
    origin: record.origin,
    driver: record.driver,
    providerInstanceId: record.providerInstanceId,
    childThreadId: record.childThreadId,
    ...(spec.remoteChild ? { remoteChild: spec.remoteChild } : {}),
    prompt: spec.prompt,
    ...(spec.progress === undefined ? {} : { progress: spec.progress }),
    result: spec.result ?? null,
  }));
}

/** The shell's pending background task for a subagent that is still going. */
export function pendingSubagentTask(spec: SubagentSpec): OrchestrationV2PendingBackgroundTask {
  return {
    kind: "subagent",
    taskId: subagentIdOf(spec.parentId, spec.key),
    description: spec.title,
    providerInstanceId: (spec.model ?? MODELS.sonnet).instanceId,
    ...(spec.childId ? { childThreadId: ThreadId.make(spec.childId) } : {}),
  };
}

/** Adds subagent records to a parent's projection. */
export function withSubagents(specs: ReadonlyArray<SubagentSpec>) {
  const records = specs.map(subagentRecord);
  return (projection: OrchestrationV2ThreadProjection): OrchestrationV2ThreadProjection => ({
    ...projection,
    subagents: [...projection.subagents, ...records],
  });
}

export interface ChildSpec {
  readonly id: string;
  readonly parentId: string;
  /** The thread whose view this one nests under. Default: the parent. */
  readonly rootId?: string;
  readonly title: string;
  readonly turns: ReadonlyArray<TurnSpec>;
  /** Provider-native children cannot take messages; app-owned ones (delegate_task) can. */
  readonly native: boolean;
  readonly model?: ModelSelection;
  readonly thread?: ThreadSpec["thread"];
  readonly shell?: ThreadSpec["shell"];
  readonly runtimeMode?: ThreadSpec["runtimeMode"];
  readonly projection?: ThreadSpec["projection"];
  readonly createdAgo?: Span;
  readonly scenario?: ThreadSpec["scenario"];
}

/** A planted child thread: it opens, and it is hidden from lists the way the app hides subagents. */
export function childThread(spec: ChildSpec): ThreadDefinition {
  return thread({
    id: spec.id,
    project: "agents",
    title: spec.title,
    model: spec.model ?? MODELS.sonnet,
    ...(spec.runtimeMode ? { runtimeMode: spec.runtimeMode } : {}),
    ...(spec.createdAgo ? { createdAt: spec.createdAgo } : {}),
    ...(spec.scenario ? { scenario: spec.scenario } : {}),
    turns: spec.turns,
    thread: {
      lineage: {
        parentThreadId: ThreadId.make(spec.parentId),
        relationshipToParent: "subagent",
        rootThreadId: ThreadId.make(spec.rootId ?? spec.parentId),
      },
      createdBy: "agent",
      creationSource: spec.native ? "provider" : "mcp",
      ...spec.thread,
    },
    ...(spec.shell ? { shell: spec.shell } : {}),
    ...(spec.projection ? { projection: spec.projection } : {}),
  });
}

export { CLAUDE, CODEX };
