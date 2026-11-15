// The sidebar row for a thread, derived from its projection the way the server's
// `threadShellFromProjection` (apps/server ProjectionStore) does, minus provider sessions and
// background-work bookkeeping. A fixture's `shell` patch lays shell-only fields on top.
import {
  orchestrationV2RunWorkStartedAt,
  RuntimeRequestId,
  type OrchestrationV2PendingRuntimeRequestSummary,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  latestRootProviderFailure,
  latestUnheldRun,
  threadErrorSummary,
} from "@t3tools/shared/orchestrationV2ThreadError";
import * as DateTime from "effect/DateTime";

const isInterruptible = (run: OrchestrationV2Run) =>
  run.status === "preparing" || run.status === "starting" || run.status === "running";
const isActivity = (
  run: OrchestrationV2Run,
): run is OrchestrationV2Run & { readonly status: "preparing" | "starting" | "running" | "waiting" } =>
  isInterruptible(run) || run.status === "waiting";

const newestFirst = (left: OrchestrationV2Run, right: OrchestrationV2Run) =>
  right.ordinal - left.ordinal;

/** Shell fields that describe the latest run; a new run or a stop drops a fixture's override. */
export const RUN_STATE_SHELL_FIELDS = [
  "status",
  "activeRunId",
  "activityRunStatus",
  "activityRunStartedAt",
  "blockedOnThreadWait",
  "lastError",
  "lastErrorClass",
  "lastErrorCode",
  "usageLimitResetAt",
  "pendingRuntimeRequest",
  "latestRunId",
  "latestRunRequestedAt",
  "latestRunStartedAt",
  "latestRunCompletedAt",
  "latestRunStopRequested",
  "latestRunBackgroundWake",
] as const satisfies ReadonlyArray<keyof OrchestrationV2ThreadShell>;

function pendingRequest(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2PendingRuntimeRequestSummary | null {
  const request =
    projection.runtimeRequests
      .filter((candidate) => candidate.status === "pending")
      .toSorted(
        (left, right) =>
          Number(left.kind === "user_input") - Number(right.kind === "user_input") ||
          DateTime.toEpochMillis(right.createdAt) - DateTime.toEpochMillis(left.createdAt),
      )[0] ?? null;
  if (request !== null) {
    return {
      id: request.id,
      kind: request.kind,
      createdAt: request.createdAt,
      blocking: request.responseCapability.type !== "message",
    };
  }
  // Secret and link cards wait on the user without a runtime request record.
  const card = projection.turnItems.findLast(
    (item) =>
      (item.type === "secret_request" || item.type === "link_request") &&
      item.status === "waiting",
  );
  if (card === undefined) return null;
  return {
    id: RuntimeRequestId.make(card.id),
    kind: "user_input",
    createdAt: card.startedAt ?? card.updatedAt,
    blocking: true,
    userOnly: true,
  };
}

export function shellFromProjection(
  projection: OrchestrationV2ThreadProjection,
  patch: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell {
  const thread = projection.thread;
  const runs = projection.runs;
  const latestRun = latestUnheldRun(runs);
  const activeRun = runs.filter(isInterruptible).toSorted(newestFirst)[0] ?? null;
  const activityRun = runs.filter(isActivity).toSorted(newestFirst)[0] ?? null;
  const userItems = projection.turnItems.filter(
    (item) => item.type === "user_message" && item.inputIntent !== "queued_turn",
  );
  const latestUserItem = userItems.at(-1);
  const latestUserAuthored = userItems.findLast(
    (item) => item.type === "user_message" && item.createdBy === "user",
  );
  return {
    createdBy: thread.createdBy,
    creationSource: thread.creationSource,
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    providerInstanceId: thread.providerInstanceId,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    pullRequests: thread.pullRequests ?? [],
    ...(thread.linkedPullRequest === undefined
      ? {}
      : { linkedPullRequest: thread.linkedPullRequest }),
    ...(thread.branchPullRequest === undefined
      ? {}
      : { branchPullRequest: thread.branchPullRequest }),
    ...(thread.activeOrderKey === undefined ? {} : { activeOrderKey: thread.activeOrderKey }),
    lineage: thread.lineage,
    forkedFrom: thread.forkedFrom,
    activeProviderThreadId: thread.activeProviderThreadId,
    ...(thread.historyOrigin === undefined ? {} : { historyOrigin: thread.historyOrigin }),
    ...(thread.linkOrigin === undefined ? {} : { linkOrigin: thread.linkOrigin }),
    ...(thread.delegatedFrom === undefined ? {} : { delegatedFrom: thread.delegatedFrom }),
    latestRunId: latestRun?.id ?? null,
    latestRunRequestedAt: latestRun?.requestedAt ?? null,
    latestRunStartedAt: latestRun?.startedAt ?? null,
    latestRunCompletedAt: latestRun?.completedAt ?? null,
    latestRunStopRequested:
      latestRun !== null &&
      projection.turnItems.some(
        (item) => item.runId === latestRun.id && item.type === "run_interrupt_request",
      ),
    latestRunBackgroundWake: false,
    activeRunId: activeRun?.id ?? null,
    blockedOnThreadWait: false,
    activityRunStatus: activityRun?.status ?? null,
    activityRunStartedAt: activityRun === null ? null : orchestrationV2RunWorkStartedAt(activityRun),
    status: latestRun?.status ?? "idle",
    ...threadErrorSummary(latestRootProviderFailure(latestRun, projection.turnItems), null),
    pendingRuntimeRequest: pendingRequest(projection),
    pendingGuestMessageCount:
      thread.guestShare?.messages.filter((message) => message.status === "pending").length ?? 0,
    latestVisibleMessage: null,
    latestUserMessageAt: latestUserItem?.updatedAt ?? null,
    latestUserAuthoredMessageAt: latestUserAuthored?.updatedAt ?? null,
    hasActionableProposedPlan: projection.plans.some(
      (plan) => plan.kind === "proposed_plan" && plan.status === "active",
    ),
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    goal: null,
    itemCount: projection.turnItems.length,
    visibleItemCount: projection.visibleTurnItems.length,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    unsettledAt: thread.unsettledAt ?? null,
    snoozedUntil: thread.snoozedUntil ?? null,
    snoozedAt: thread.snoozedAt ?? null,
    pinnedAt: thread.pinnedAt ?? null,
    autoSettleDisabledAt: thread.autoSettleDisabledAt ?? null,
    pinOrderKey: thread.pinOrderKey ?? null,
    ...(thread.tags?.length ? { tags: thread.tags } : {}),
    lastVisitedAt: thread.lastVisitedAt,
    opens: thread.opens ?? null,
    titleRegeneration: thread.titleRegeneration ?? null,
    lastTitleRegeneration: thread.lastTitleRegeneration ?? null,
    limitRecovery: thread.limitRecovery ?? null,
    deletedAt: thread.deletedAt,
    ...patch,
  };
}
