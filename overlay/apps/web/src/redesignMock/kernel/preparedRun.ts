// Workspace preparation, after it failed: "Retry" (`prepared-run.retry`) puts the failed run back
// to preparing the way the server's `dispatchPreparedRunRetry` does (failure item cancelled,
// "Preparing workspace" row running, run preparing, held queue released), then plays the setup
// the effect worker would run: the setup card's stages go from running to done, the run starts and
// the agent works. Cancelling the setup while it runs fails the run again (`prepared-run.fail`),
// retryable, as the server's worker reports it.
import {
  CommandId,
  TurnItemId,
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type RunId,
  type ThreadId,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { now, nowMs } from "./clock";
import { scriptFor } from "./reducer";
import { endRun, handleFor, runScript, script, status, step, type RunHandle } from "./script";
import { liveStream, type MockServer, type ThreadEventInput } from "./server";

/** The server's title for the row that stands for workspace preparation (`WORKSPACE_PREPARATION_INPUT`). */
const WORKSPACE_PREPARATION_INPUT = "Preparing workspace";

type ErrorItem = Extract<OrchestrationV2TurnItem, { type: "error" }>;
type CommandItem = Extract<OrchestrationV2TurnItem, { type: "command_execution" }>;
type WorktreeStrategy = Extract<NonNullable<OrchestrationV2Run["workspacePreparation"]>, { type: "worktree" }>;

// Live setup snapshots ------------------------------------------------------------------------------

interface SetupState {
  snapshot: WorktreeSetupSnapshot | null;
  readonly queues: Set<Queue.Queue<WorktreeSetupSnapshot | null>>;
}

const setups = new WeakMap<MockServer, Map<ThreadId, SetupState>>();

function setupsOf(server: MockServer): Map<ThreadId, SetupState> {
  let map = setups.get(server);
  if (!map) {
    map = new Map();
    setups.set(server, map);
  }
  return map;
}

function publishSetup(server: MockServer, snapshot: WorktreeSetupSnapshot): void {
  const map = setupsOf(server);
  const state = map.get(snapshot.threadId);
  if (state) {
    state.snapshot = snapshot;
    for (const queue of state.queues) Queue.offerUnsafe(queue, snapshot);
  } else {
    map.set(snapshot.threadId, { snapshot, queues: new Set() });
  }
}

/**
 * The setup card's stream for a thread: the planted snapshot (or null) until the kernel runs a
 * setup there, then every change, also to a card that is already open.
 */
export function worktreeSetupStream(
  server: MockServer,
  threadId: ThreadId,
  planted: () => WorktreeSetupSnapshot | null,
): Stream.Stream<WorktreeSetupSnapshot | null> {
  const map = setupsOf(server);
  let state = map.get(threadId);
  if (!state) {
    state = { snapshot: planted(), queues: new Set() };
    map.set(threadId, state);
  }
  const current = state;
  return liveStream<WorktreeSetupSnapshot | null>(
    () => [current.snapshot],
    (queue) => {
      current.queues.add(queue);
      return () => current.queues.delete(queue);
    },
  );
}

export function runningSetup(server: MockServer, threadId: ThreadId): WorktreeSetupSnapshot | undefined {
  const snapshot = setupsOf(server).get(threadId)?.snapshot;
  return snapshot?.phase === "running" ? snapshot : undefined;
}

// Retry ---------------------------------------------------------------------------------------------

const iso = () => DateTime.formatIso(now());

function preparationRow(server: MockServer, threadId: ThreadId, runId: RunId): CommandItem | undefined {
  return server
    .projection(threadId)
    ?.turnItems.find(
      (candidate): candidate is CommandItem =>
        candidate.runId === runId && candidate.type === "command_execution" && candidate.input === WORKSPACE_PREPARATION_INPUT,
    );
}

function failureOf(server: MockServer, threadId: ThreadId, runId: RunId): ErrorItem | undefined {
  return server
    .projection(threadId)
    ?.turnItems.find(
      (candidate): candidate is ErrorItem =>
        candidate.runId === runId &&
        candidate.type === "error" &&
        candidate.status === "failed" &&
        candidate.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
    );
}

function nextOrdinal(server: MockServer, threadId: ThreadId): number {
  return (server.projection(threadId)?.turnItems ?? []).reduce((max, item) => Math.max(max, item.ordinal), -1) + 1;
}

/** Where the worktree lands: the thread's own path, else beside the project's root. */
function worktreePathFor(server: MockServer, threadId: ThreadId, branch: string | null): string {
  const projection = server.projection(threadId)!;
  if (projection.thread.worktreePath) return projection.thread.worktreePath;
  const root = server.projects.get(projection.thread.projectId)?.project.workspaceRoot ?? "/workspace/project";
  const leaf = (branch ?? "worktree").split("/").at(-1) ?? "worktree";
  return `${root}/.t3/worktrees/${leaf}`;
}

const SETUP_TAIL = [
  "Lockfile is up to date, resolution step is skipped",
  "Progress: resolved 412, reused 412, downloaded 0, added 412, done",
  "Done in 3.1s",
];

function stage(id: WorktreeSetupStage["id"], value: WorktreeSetupStage["status"], detail: string | null = null, tail: string[] = []): WorktreeSetupStage {
  const at = iso();
  return {
    id,
    status: value,
    startedAt: value === "pending" || value === "skipped" ? null : at,
    endedAt: value === "done" || value === "failed" ? at : null,
    percent: value === "done" ? 100 : null,
    detail,
    tail,
  };
}

/** Puts a failed preparation back to running and plays the setup (`prepared-run.retry`). */
export function preparedRunRetry(server: MockServer, threadId: ThreadId, runId: RunId): void {
  const projection = server.projection(threadId);
  const run = projection?.runs.find((candidate) => candidate.id === runId);
  const failure = failureOf(server, threadId, runId);
  if (!projection || !run || run.status !== "failed" || run.workspacePreparation === undefined || !failure) return;
  if (projection.thread.archivedAt !== null || projection.thread.deletedAt !== null) return;
  if (projection.runs.some((candidate) => candidate.id !== runId && ["preparing", "starting", "running", "waiting"].includes(candidate.status))) {
    return;
  }
  server.clearRunStatePatch(threadId);
  const at = now();
  const existing = preparationRow(server, threadId, runId);
  const { exitCode: _exitCode, output: _output, ...reset } = existing ?? ({} as Partial<CommandItem>);
  const row: CommandItem = existing
    ? { ...(reset as CommandItem), status: "running", title: WORKSPACE_PREPARATION_INPUT, completedAt: null, updatedAt: at }
    : {
        id: TurnItemId.make(`${runId}-preparation`),
        threadId,
        runId,
        nodeId: failure.nodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: nextOrdinal(server, threadId),
        status: "running",
        title: WORKSPACE_PREPARATION_INPUT,
        startedAt: at,
        completedAt: null,
        updatedAt: at,
        type: "command_execution",
        input: WORKSPACE_PREPARATION_INPUT,
      };
  const events: ThreadEventInput[] = [
    { type: "turn-item.updated", payload: { ...failure, status: "cancelled", updatedAt: at } },
    { type: "turn-item.updated", payload: row },
    { type: "run.updated", payload: { ...run, status: "preparing", completedAt: null } },
  ];
  for (const queued of projection.runs) {
    if (queued.status === "queued" && queued.queueHeld === true) {
      events.push({ type: "run.updated", payload: { ...queued, queueHeld: false } });
    }
  }
  server.emit(threadId, events);
  runScript(server, threadId, runId, setupScript(run.workspacePreparation));
}

/** The setup the server's worker runs, as the card shows it, then the agent starts. */
function setupScript(strategy: NonNullable<OrchestrationV2Run["workspacePreparation"]>) {
  const worktree: WorktreeStrategy | null = strategy.type === "worktree" ? strategy : null;
  const branch = worktree?.branch ?? strategy.branch ?? null;
  const baseRef = worktree?.baseRef ?? null;
  let sequence = 100;
  let startedAt = "";
  // Each stage keeps the time it started, so the card shows how long it really took.
  const starts = new Map<WorktreeSetupStage["id"], string>();
  const snapshot = (handle: RunHandle, list: WorktreeSetupStage[], phase: WorktreeSetupSnapshot["phase"] = "running") => {
    sequence += 1;
    const stages = list.map((entry) => {
      if (entry.startedAt === null) return entry;
      if (!starts.has(entry.id)) starts.set(entry.id, entry.startedAt);
      return { ...entry, startedAt: starts.get(entry.id)! };
    });
    publishSetup(handle.server, {
      threadId: handle.threadId,
      phase,
      startedAt,
      endedAt: phase === "running" ? null : iso(),
      branch,
      baseRef,
      worktreePath: worktreePathFor(handle.server, handle.threadId, branch),
      setupScript: { name: "Install dependencies", command: "pnpm install --frozen-lockfile", terminalId: "setup-1" },
      stages,
      error: null,
      sequence,
    });
  };
  const done = (id: WorktreeSetupStage["id"], detail: string | null = null, tail: string[] = []) => stage(id, "done", detail, tail);
  return script([
    step("200ms", (handle) => {
      startedAt = iso();
      snapshot(handle, [stage("fetch", "running"), stage("checkout", "pending"), stage("submodules", "pending"), stage("setup-script", "pending"), stage("agent", "pending")]);
    }),
    step("1.2s", (handle) => {
      // The worktree exists from here on: the thread points at it, as the server records it.
      const projection = handle.server.projection(handle.threadId);
      const path = worktreePathFor(handle.server, handle.threadId, branch);
      if (projection && projection.thread.worktreePath !== path) {
        handle.server.emit(handle.threadId, [
          {
            type: "thread.metadata-updated",
            payload: { ...projection.thread, worktreePath: path, ...(branch ? { branch } : {}), updatedAt: now() },
          },
        ]);
      }
      snapshot(handle, [done("fetch", baseRef ? `${baseRef} at 4e1b9c7` : null), stage("checkout", "running"), stage("submodules", "pending"), stage("setup-script", "pending"), stage("agent", "pending")]);
    }),
    step("900ms", (handle) => {
      snapshot(handle, [done("fetch"), done("checkout"), stage("submodules", "skipped", "No submodules"), stage("setup-script", "running", null, SETUP_TAIL.slice(0, 1)), stage("agent", "pending")]);
    }),
    step("2.2s", (handle) => {
      snapshot(handle, [done("fetch"), done("checkout"), stage("submodules", "skipped", "No submodules"), done("setup-script", null, SETUP_TAIL), stage("agent", "running")]);
      const row = preparationRow(handle.server, handle.threadId, handle.runId);
      if (row) handle.complete(row.id, (current) => (current.type === "command_execution" ? { ...current, exitCode: 0 } : current));
      handle.setRun((run) => ({ ...run, status: "starting", startedAt: run.startedAt ?? now(), workStartedAt: now() }));
    }),
    status("600ms", "running"),
    step("100ms", (handle) => {
      snapshot(handle, [done("fetch"), done("checkout"), stage("submodules", "skipped", "No submodules"), done("setup-script", null, SETUP_TAIL), done("agent")], "done");
      // The agent now works on the message the run was for, as any new run does.
      const run = handle.run();
      const message = handle.server.projection(handle.threadId)?.messages.find((candidate) => candidate.id === run?.userMessageId);
      runScript(handle.server, handle.threadId, handle.runId, scriptFor(handle.server, handle.threadId, message?.text ?? ""));
    }),
  ]);
}

// Cancel --------------------------------------------------------------------------------------------

/** The command the server's worker dispatches when a setup is cancelled: the run fails, retryable. */
export function cancelSetupCommand(server: MockServer, threadId: ThreadId): OrchestrationV2Command | null {
  const running = runningSetup(server, threadId);
  const run = server.projection(threadId)?.runs.find((candidate) => candidate.status === "preparing");
  if (!running || !run) return null;
  return {
    type: "prepared-run.fail",
    commandId: CommandId.make(`mock-setup-cancel-${run.id}-${nowMs()}`),
    threadId,
    runId: run.id,
    failure: {
      class: "unknown",
      message: "Workspace setup was cancelled.",
      code: ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
      retryable: true,
    },
  };
}

/** `prepared-run.fail`: the preparing run fails with the failure, and its setup card says so. */
export function preparedRunFail(server: MockServer, command: Extract<OrchestrationV2Command, { type: "prepared-run.fail" }>): void {
  const projection = server.projection(command.threadId);
  const run = projection?.runs.find((candidate) => candidate.id === command.runId);
  if (!projection || run?.status !== "preparing") return;
  const at = now();
  const row = preparationRow(server, command.threadId, run.id);
  const failure = projection.turnItems.find(
    (candidate): candidate is ErrorItem => candidate.runId === run.id && candidate.type === "error",
  );
  const events: ThreadEventInput[] = [];
  if (row) events.push({ type: "turn-item.updated", payload: { ...row, status: "failed", completedAt: at, updatedAt: at } });
  if (failure) {
    events.push({
      type: "turn-item.updated",
      payload: { ...failure, status: "failed", failure: command.failure, ordinal: nextOrdinal(server, command.threadId), completedAt: at, updatedAt: at },
    });
  }
  server.emit(command.threadId, events);
  const running = runningSetup(server, command.threadId);
  if (running) {
    publishSetup(server, {
      ...running,
      phase: "cancelled",
      endedAt: DateTime.formatIso(at),
      stages: running.stages.map((entry) => (entry.status === "running" ? { ...entry, status: "failed", endedAt: DateTime.formatIso(at), detail: "Cancelled" } : entry)),
      error: command.failure.message,
      sequence: running.sequence + 1,
    });
  }
  // The server holds the queue behind a failed preparation; Retry releases it.
  server.emit(
    command.threadId,
    projection.runs
      .filter((queued) => queued.status === "queued" && queued.queueHeld !== true)
      .map((queued) => ({ type: "run.updated", payload: { ...queued, queueHeld: true } }) as const),
  );
  endRun(handleFor(server, command.threadId, run.id), "failed");
}
