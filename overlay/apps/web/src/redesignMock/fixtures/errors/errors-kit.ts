// Shared builders for the errors family: the failure item every run ending reads, a checkpoint
// with a chosen status, and an ISO reset time that matches across the failure, the recovery and
// the snooze (the banner compares them as equal instants).
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ProviderRetry,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItemStatus,
} from "@t3tools/contracts";

import { ago, item, MOCK_PROVIDER_SESSION, type ItemSpec } from "../../api";

export function failureItem(
  failure: OrchestrationV2ProviderFailure,
  options: { readonly status?: OrchestrationV2TurnItemStatus; readonly retry?: OrchestrationV2ProviderRetry } = {},
): ItemSpec {
  return item((base) => ({
    ...base,
    type: "error",
    status: options.status ?? "failed",
    failure,
    ...(options.retry === undefined ? {} : { retry: options.retry }),
  }));
}

export function noticeItem(level: "info" | "warning" | "error", message: string): ItemSpec {
  return item((base) => ({ ...base, type: "system_notice", level, message }));
}

export interface CheckpointOptions {
  readonly status: OrchestrationV2Checkpoint["status"];
  readonly files: OrchestrationV2Checkpoint["files"];
  readonly slug: string;
  readonly runIndex: number;
  readonly capturedAgo: string;
}

/** One checkpoint per run, as the server writes them; `status` is what the row under test needs. */
export function checkpointOf(
  projection: OrchestrationV2ThreadProjection,
  options: CheckpointOptions,
): OrchestrationV2Checkpoint {
  const run = projection.runs[options.runIndex]!;
  return {
    id: CheckpointId.make(`${options.slug}-checkpoint-${options.runIndex + 1}`),
    threadId: projection.thread.id,
    scopeId: CheckpointScopeId.make(`${options.slug}-scope`),
    runId: run.id,
    nodeId: projection.nodes[0]?.id ?? NodeId.make(`${options.slug}-node`),
    parentCheckpointId: null,
    ordinalWithinScope: options.runIndex + 1,
    appRunOrdinal: run.ordinal,
    ref: CheckpointRef.make(`mock/${options.slug}/${options.runIndex + 1}`),
    status: options.status,
    files: options.files,
    capturedAt: ago(options.capturedAgo),
  };
}

/** A live provider session behind the thread: the app offers "Edit from here" only with one. */
export function withProviderThread(projection: OrchestrationV2ThreadProjection): OrchestrationV2ThreadProjection {
  const id = ProviderThreadId.make(`${projection.thread.id}-provider-thread`);
  return {
    ...projection,
    thread: { ...projection.thread, activeProviderThreadId: id },
    providerThreads: [
      ...projection.providerThreads,
      {
        id,
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: projection.thread.modelSelection.instanceId,
        providerSessionId: MOCK_PROVIDER_SESSION,
        appThreadId: projection.thread.id,
        ownerNodeId: null,
        nativeThreadRef: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: projection.runs.length,
        handoffIds: [],
        forkedFrom: null,
        createdAt: projection.thread.createdAt,
        updatedAt: projection.thread.updatedAt,
      },
    ],
  };
}
