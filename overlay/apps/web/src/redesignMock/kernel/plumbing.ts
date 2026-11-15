// The attempt and provider turn a run needs for the UI to treat it as working: without a running
// provider turn on its active attempt, a live run reads "Starting".
import {
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2RunAttempt,
  type ThreadId,
} from "@t3tools/contracts";

type AttemptStatus = OrchestrationV2RunAttempt["status"];

export function attemptStatusOf(status: OrchestrationV2Run["status"]): AttemptStatus | null {
  switch (status) {
    case "running":
    case "waiting":
      return "running";
    case "completed":
    case "interrupted":
    case "failed":
    case "cancelled":
      return status;
    case "rolled_back":
      return "completed";
    default:
      return null;
  }
}

export function providerThreadIdOf(threadId: ThreadId): ProviderThreadId {
  return ProviderThreadId.make(`${threadId}-provider-thread`);
}

/** The run's first attempt and its provider turn, in `status`. */
export function runPlumbing(
  run: OrchestrationV2Run,
  status: AttemptStatus,
): { readonly attempt: OrchestrationV2RunAttempt; readonly turn: OrchestrationV2ProviderTurn } {
  const attemptId = RunAttemptId.make(`${run.id}-attempt-1`);
  const rootNodeId = NodeId.make(`${run.id}-root`);
  const providerThreadId = providerThreadIdOf(run.threadId);
  const finished = status !== "running" && status !== "pending";
  const startedAt = run.startedAt ?? run.requestedAt;
  const completedAt = finished ? (run.completedAt ?? startedAt) : null;
  return {
    attempt: {
      id: attemptId,
      runId: run.id,
      attemptOrdinal: 1,
      rootNodeId,
      providerInstanceId: run.providerInstanceId,
      providerThreadId,
      providerTurnId: ProviderTurnId.make(`${run.id}-turn-1`),
      reason: "initial",
      status,
      startedAt,
      completedAt,
    },
    turn: {
      id: ProviderTurnId.make(`${run.id}-turn-1`),
      providerThreadId,
      nodeId: rootNodeId,
      runAttemptId: attemptId,
      nativeTurnRef: null,
      ordinal: run.ordinal,
      status: status === "superseded" ? "cancelled" : status,
      startedAt,
      completedAt,
      model: run.modelSelection.model,
    },
  };
}
