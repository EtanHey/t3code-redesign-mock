// `orchestration.dispatchCommand` and `orchestration.launchThread`: each command turns into the
// same domain events the real server would emit, so the client updates through its normal path.
// Commands the kernel does not model are acknowledged and ignored (lanes can react to them).
import {
  CommandId,
  MessageId,
  NodeId,
  RunId,
  ThreadId,
  TurnItemId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationMessageContext,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Notification,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadLaunchInput,
  type OrchestrationV2ThreadLaunchResult,
  type OrchestrationV2TurnItem,
  type OrchestrationV2InternalCommand,
  type PeerLinkRequestAnswerInput,
  type SecretRequestAnswerInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { now } from "./clock";
import type { CommandOf } from "./definitions";
import { withDefaultContextUsage } from "./defaults";
import { emptyProjection } from "./dsl";
import { alwaysWorking, cancelScript, runScript, type RunScript } from "./script";
import type { MockServer, ThreadEventInput } from "./server";

type UserMessageItem = Extract<OrchestrationV2TurnItem, { type: "user_message" }>;
type RequestItem = Extract<OrchestrationV2TurnItem, { type: "user_input_request" | "approval_request" }>;
/** The server's internal commands that record a secret or link card's outcome. */
type RecordOf<T extends "secret_request.record" | "link_request.record"> = Extract<
  OrchestrationV2InternalCommand,
  { type: T }
>;
type NotificationItem = Extract<OrchestrationV2TurnItem, { type: "notification" }>;
type AppThreadEvent = Extract<ThreadEventInput, { payload: OrchestrationV2AppThread }>["type"];

const LIVE = new Set<OrchestrationV2Run["status"]>(["preparing", "starting", "running", "waiting"]);
const UNFINISHED_ITEM = new Set<OrchestrationV2TurnItem["status"]>(["pending", "running", "waiting", "idle"]);

// Reading -----------------------------------------------------------------------------------------

function activeRun(server: MockServer, threadId: ThreadId): OrchestrationV2Run | undefined {
  return server
    .projection(threadId)
    ?.runs.filter((run) => LIVE.has(run.status))
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
}

function queuedRuns(server: MockServer, threadId: ThreadId): OrchestrationV2Run[] {
  return (server.projection(threadId)?.runs ?? [])
    .filter((run) => run.status === "queued")
    .toSorted((left, right) => (left.queuePosition ?? 0) - (right.queuePosition ?? 0));
}

function userItemOf(server: MockServer, threadId: ThreadId, run: OrchestrationV2Run): UserMessageItem | undefined {
  return server
    .projection(threadId)
    ?.turnItems.find(
      (candidate): candidate is UserMessageItem =>
        candidate.type === "user_message" && candidate.messageId === run.userMessageId,
    );
}

function nextOrdinal(server: MockServer, threadId: ThreadId): number {
  const items = server.projection(threadId)?.turnItems ?? [];
  return items.reduce((max, item) => Math.max(max, item.ordinal), -1) + 1;
}

function nextRunOrdinal(server: MockServer, threadId: ThreadId): number {
  const runs = server.projection(threadId)?.runs ?? [];
  return runs.reduce((max, run) => Math.max(max, run.ordinal), 0) + 1;
}

/** The script a new run in this thread follows: the fixture's, else the kernel's default. */
function scriptFor(server: MockServer, threadId: ThreadId, text: string): RunScript {
  return server.thread(threadId)?.definition?.script ?? alwaysWorking(text);
}

// Writing -----------------------------------------------------------------------------------------

function updateThread(
  server: MockServer,
  threadId: ThreadId,
  type: AppThreadEvent,
  change: (thread: OrchestrationV2AppThread) => OrchestrationV2AppThread,
): void {
  const projection = server.projection(threadId);
  if (!projection) return;
  const next = change(projection.thread);
  const touchesActivity = type !== "thread.visited" && type !== "thread.tags-updated" && type !== "thread.marked-unread";
  server.emit(threadId, [
    { type, payload: touchesActivity ? { ...next, updatedAt: now() } : next } as ThreadEventInput,
  ]);
}

interface MessageInput {
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext;
  readonly modelSelection?: ModelSelection;
  readonly createdBy?: UserMessageItem["createdBy"];
  readonly creationSource?: UserMessageItem["creationSource"];
  readonly freshContext?: boolean;
  /** A wake or "Resumed thread" row: the run starts from it, and no bubble shows. */
  readonly notification?: OrchestrationV2Notification;
  readonly manualContinuationOfRunId?: RunId;
}

/** What the real server projects for a message that carries a notification (see
 * provider-core `notificationTurnItem`): the user row becomes a notification row. */
function asNotificationItem(item: UserMessageItem, notification: OrchestrationV2Notification): NotificationItem {
  const {
    type: _type,
    messageId: _messageId,
    inputIntent: _inputIntent,
    text: _text,
    attachments: _attachments,
    createdBy: _createdBy,
    creationSource: _creationSource,
    context: _context,
    freshContext: _freshContext,
    ...base
  } = item;
  return { ...base, type: "notification", ...notification };
}

function userItem(
  server: MockServer,
  threadId: ThreadId,
  runId: RunId | null,
  input: MessageInput,
  intent: UserMessageItem["inputIntent"],
  status: UserMessageItem["status"],
): { readonly item: UserMessageItem; readonly message: OrchestrationV2ConversationMessage } {
  const at = now();
  const item: UserMessageItem = {
    id: TurnItemId.make(`${input.messageId}`),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: nextOrdinal(server, threadId),
    status,
    title: null,
    startedAt: at,
    completedAt: status === "pending" ? null : at,
    updatedAt: at,
    type: "user_message",
    messageId: input.messageId,
    text: input.text,
    attachments: [...input.attachments],
    ...(input.context ? { context: input.context } : {}),
    ...(input.freshContext ? { freshContext: true } : {}),
    inputIntent: intent,
    createdBy: input.createdBy ?? "user",
    creationSource: input.creationSource ?? "web",
  };
  const message: OrchestrationV2ConversationMessage = {
    id: input.messageId,
    threadId,
    runId,
    nodeId: null,
    role: "user",
    text: input.text,
    attachments: [...input.attachments],
    ...(input.context ? { context: input.context } : {}),
    streaming: false,
    createdAt: at,
    updatedAt: at,
    createdBy: input.createdBy ?? "user",
    creationSource: input.creationSource ?? "web",
    ...(input.notification ? { notification: input.notification } : {}),
  };
  return { item, message };
}

function newRun(
  server: MockServer,
  threadId: ThreadId,
  input: MessageInput,
  status: OrchestrationV2Run["status"],
  extra: Partial<OrchestrationV2Run> = {},
): OrchestrationV2Run {
  const thread = server.projection(threadId)!.thread;
  const ordinal = nextRunOrdinal(server, threadId);
  const modelSelection = input.modelSelection ?? thread.modelSelection;
  const at = now();
  return {
    id: RunId.make(`${threadId}-run-${ordinal}`),
    threadId,
    ordinal,
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    providerThreadId: null,
    userMessageId: input.messageId,
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at,
    startedAt: status === "queued" ? null : at,
    completedAt: null,
    checkpointId: null,
    contextHandoffId: null,
    ...(status === "queued" ? {} : { workStartedAt: at }),
    ...(input.freshContext ? { freshContext: true } : {}),
    ...(input.manualContinuationOfRunId ? { manualContinuationOfRunId: input.manualContinuationOfRunId } : {}),
    ...extra,
  };
}

/** The user row of a run: a message bubble, or the notification row the message carries. */
function rowOf(item: UserMessageItem, input: MessageInput): OrchestrationV2TurnItem {
  return input.notification ? asNotificationItem(item, input.notification) : item;
}

/** Starts a run for a message: the user row appears, the thread goes to working, the script runs. */
export function startRun(server: MockServer, threadId: ThreadId, input: MessageInput): RunId {
  server.clearRunStatePatch(threadId);
  const run = newRun(server, threadId, input, "starting");
  const { item, message } = userItem(server, threadId, run.id, input, "turn_start", "completed");
  server.emit(threadId, [
    { type: "run.created", payload: run },
    { type: "message.updated", payload: message },
    { type: "turn-item.updated", payload: rowOf(item, input) },
  ]);
  runScript(server, threadId, run.id, scriptFor(server, threadId, input.text));
  return run.id;
}

function queueRun(server: MockServer, threadId: ThreadId, input: MessageInput): void {
  const position = queuedRuns(server, threadId).length + 1;
  const run = newRun(server, threadId, input, "queued", { queuePosition: position });
  const { item, message } = userItem(server, threadId, run.id, input, "queued_turn", "pending");
  server.emit(threadId, [
    { type: "run.created", payload: run },
    { type: "message.updated", payload: message },
    { type: "turn-item.updated", payload: rowOf(item, input) },
  ]);
}

function renumberQueue(server: MockServer, threadId: ThreadId, order: ReadonlyArray<OrchestrationV2Run>): void {
  const events: ThreadEventInput[] = [];
  order.forEach((run, index) => {
    if (run.queuePosition !== index + 1) {
      events.push({ type: "run.updated", payload: { ...run, queuePosition: index + 1 } });
    }
  });
  server.emit(threadId, events);
}

/** Starts a queued run now: its message joins the timeline and the thread works on it. */
function startQueued(server: MockServer, threadId: ThreadId, run: OrchestrationV2Run): void {
  server.clearRunStatePatch(threadId);
  const at = now();
  const item = userItemOf(server, threadId, run);
  const events: ThreadEventInput[] = [
    {
      type: "run.updated",
      payload: {
        ...run,
        status: "starting",
        queuePosition: null,
        queueHeld: false,
        startedAt: at,
        workStartedAt: at,
      },
    },
  ];
  const row =
    item ??
    server
      .projection(threadId)
      ?.turnItems.find((candidate) => candidate.type === "notification" && candidate.id === `${run.userMessageId}`);
  if (row) {
    events.push({
      type: "turn-item.updated",
      payload: { ...row, status: "completed", completedAt: at, updatedAt: at, ordinal: nextOrdinal(server, threadId) },
    });
  }
  server.emit(threadId, events);
  renumberQueue(server, threadId, queuedRuns(server, threadId));
  runScript(server, threadId, run.id, scriptFor(server, threadId, item?.text ?? ""));
}

/** Stops a run: its script ends, open rows stop, open requests are cancelled. */
export function interruptRun(server: MockServer, threadId: ThreadId, runId: RunId): void {
  cancelScript(runId);
  const projection = server.projection(threadId);
  const run = projection?.runs.find((candidate) => candidate.id === runId);
  if (!projection || !run || !LIVE.has(run.status)) return;
  server.clearRunStatePatch(threadId);
  const at = now();
  const events: ThreadEventInput[] = [];
  const requestIds = new Set<string>();
  for (const item of projection.turnItems) {
    if (item.runId !== runId || !UNFINISHED_ITEM.has(item.status)) continue;
    if (item.type === "user_input_request" || item.type === "approval_request") requestIds.add(item.requestId);
    const stopped = { ...item, status: "interrupted" as const, completedAt: at, updatedAt: at };
    events.push({
      type: "turn-item.updated",
      payload:
        stopped.type === "assistant_message" || stopped.type === "reasoning" ? { ...stopped, streaming: false } : stopped,
    });
  }
  for (const request of projection.runtimeRequests) {
    if (request.status === "pending" && requestIds.has(request.id)) {
      events.push({ type: "runtime-request.updated", payload: { ...request, status: "cancelled", resolvedAt: at } });
    }
  }
  const interrupted: OrchestrationV2Run = { ...run, status: "interrupted", completedAt: at };
  const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
  const turn = projection.providerTurns.find((candidate) => candidate.runAttemptId === run.activeAttemptId);
  if (attempt) events.push({ type: "run-attempt.updated", payload: { ...attempt, status: "interrupted", completedAt: at } });
  if (turn) events.push({ type: "provider-turn.updated", payload: { ...turn, status: "interrupted", completedAt: at } });
  events.push({ type: "run.updated", payload: interrupted });
  server.emit(threadId, events);
}

function holdQueue(server: MockServer, threadId: ThreadId): void {
  server.emit(
    threadId,
    queuedRuns(server, threadId)
      .filter((run) => run.queueHeld !== true)
      .map((run) => ({ type: "run.updated", payload: { ...run, queueHeld: true } }) as const),
  );
}

function startNextQueued(server: MockServer, threadId: ThreadId): void {
  if (activeRun(server, threadId)) return;
  const next = queuedRuns(server, threadId).find((run) => run.queueHeld !== true);
  if (next) startQueued(server, threadId, next);
}

/** `{ answers: [...] }` (a multi-select or attachment answer) is stored as its list, as the server does. */
function storedAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).map(([questionId, answer]) => {
      const nested =
        answer !== null && typeof answer === "object" && !Array.isArray(answer) && "answers" in answer
          ? (answer as { readonly answers: unknown }).answers
          : answer;
      return [questionId, nested];
    }),
  );
}

function answerText(answer: unknown): string {
  if (typeof answer === "string") return answer.trim();
  if (Array.isArray(answer)) return answer.filter((value) => typeof value === "string").join(", ");
  return "";
}

/** Puts a run that was waiting on a request back to working, and plays the script's answer part. */
function resumeAfterRequest(server: MockServer, threadId: ThreadId, runId: RunId | null | undefined): void {
  const run = runId ? server.projection(threadId)?.runs.find((candidate) => candidate.id === runId) : undefined;
  if (!run || !LIVE.has(run.status)) return;
  server.clearRunStatePatch(threadId);
  if (run.status === "waiting") server.emit(threadId, [{ type: "run.updated", payload: { ...run, status: "running" } }]);
  const after = scriptFor(server, threadId, "").afterAnswer ?? alwaysWorking("").afterAnswer;
  if (after) runScript(server, threadId, run.id, after);
}

/**
 * Answers a request the way the real server's `runtime-request.respond` does: the request is
 * resolved with its decision or answers; the card's item completes (accept, accept for the
 * session, accept always, any other option) or is cancelled (decline, cancel, dismiss); an
 * answered question records `questionAnswer` with each question's text. Decline feedback becomes a
 * steer message; a question asked in "message" mode is answered as a message. Then the run goes
 * back to working, except a cancel on a live request, which ends the turn (it shows as stopped).
 */
function resolveRequest(
  server: MockServer,
  threadId: ThreadId,
  command: CommandOf<"runtime-request.respond"> | CommandOf<"thread.user-input.dismiss">,
): void {
  const projection = server.projection(threadId);
  if (!projection) return;
  const at = now();
  const respond = command.type === "runtime-request.respond" ? command : undefined;
  // Dismissing is the server's respond with "cancel".
  const decision = respond ? respond.decision : "cancel";
  const request = projection.runtimeRequests.find((candidate) => candidate.id === command.requestId);
  if (request && request.status !== "pending") return;
  const item = projection.turnItems.find(
    (candidate): candidate is RequestItem =>
      (candidate.type === "user_input_request" || candidate.type === "approval_request") &&
      candidate.requestId === command.requestId,
  );
  const answers = respond?.answers === undefined ? undefined : storedAnswers(respond.answers);
  const cancelled = decision === "decline" || decision === "cancel";
  const events: ThreadEventInput[] = [];
  if (respond?.feedback !== undefined && respond.feedback.trim()) {
    const messageId = MessageId.make(`approval-feedback:${command.requestId}`);
    const { item: feedback, message } = userItem(
      server,
      threadId,
      item?.runId ?? null,
      { messageId, text: respond.feedback, attachments: [], creationSource: "server" },
      "steer",
      "completed",
    );
    events.push({ type: "message.updated", payload: message }, { type: "turn-item.updated", payload: feedback });
  }
  if (request) {
    events.push({
      type: "runtime-request.updated",
      payload: {
        ...request,
        status: "resolved",
        resolvedAt: at,
        ...(decision !== undefined ? { decision } : {}),
        ...(respond?.feedback !== undefined ? { feedback: respond.feedback } : {}),
        ...(answers !== undefined ? { answers } : {}),
      },
    });
  }
  if (item) {
    const status = cancelled ? ("cancelled" as const) : ("completed" as const);
    events.push({
      type: "turn-item.updated",
      payload:
        item.type === "user_input_request" && answers !== undefined
          ? {
              ...item,
              status,
              completedAt: at,
              updatedAt: at,
              questionAnswer: {
                requestId: command.requestId,
                answers,
                attachmentsByQuestionId: respond?.attachmentsByQuestionId ?? {},
                questionTextById: Object.fromEntries(item.questions.map((question) => [question.id, question.question])),
              },
            }
          : { ...item, status, completedAt: at, updatedAt: at },
    });
  }
  server.emit(threadId, events);

  if (request?.responseCapability.type === "message") {
    // The provider is not waiting: the answer goes to the agent as a message.
    if (cancelled || item?.type !== "user_input_request" || answers === undefined) return;
    const replies = item.questions
      .map((question) => ({ question, text: answerText(answers[question.id]) }))
      .filter((entry) => entry.text.length > 0)
      .map((entry) => `${entry.question.question}\n${entry.text}`);
    if (replies.length === 0) return;
    const input: MessageInput = {
      messageId: MessageId.make(`async-answer:${command.requestId}`),
      text: replies.join("\n\n"),
      attachments: [],
      creationSource: "server",
    };
    const active = activeRun(server, threadId);
    if (active) {
      const { item: steer, message } = userItem(server, threadId, active.id, input, "steer", "completed");
      server.emit(threadId, [
        { type: "message.updated", payload: message },
        { type: "turn-item.updated", payload: steer },
      ]);
    } else {
      startRun(server, threadId, input);
    }
    return;
  }
  if (decision === "cancel" && respond && item?.runId) {
    interruptRun(server, threadId, item.runId);
    startNextQueued(server, threadId);
    return;
  }
  resumeAfterRequest(server, threadId, item?.runId);
}

/** A secret card's answer (`secrets.answerRequest`), recorded as the server records it: status only. */
export function secretRecordCommand(
  server: MockServer,
  input: SecretRequestAnswerInput,
): RecordOf<"secret_request.record"> | null {
  const item = server.projection(input.threadId)?.turnItems.find((candidate) => candidate.id === input.turnItemId);
  if (item?.type !== "secret_request" || item.runId === null || item.secretStatus !== "pending") return null;
  return {
    type: "secret_request.record",
    commandId: CommandId.make(`mock-secret-${input.turnItemId}`),
    threadId: input.threadId,
    runId: item.runId,
    nodeId: item.nodeId ?? NodeId.make(`${item.id}-node`),
    turnItemId: item.id,
    label: item.label,
    reason: item.reason,
    ...(item.url === undefined ? {} : { url: item.url }),
    ...(item.placeholder === undefined ? {} : { placeholder: item.placeholder }),
    ...(item.delivery === undefined ? {} : { delivery: item.delivery }),
    secretStatus: input.answer.type === "decline" ? "declined" : "saved",
  };
}

/** A link card's answer (`peerLinks.answerRequest`). The mock links nothing; it records the outcome. */
export function linkRecordCommand(
  server: MockServer,
  input: PeerLinkRequestAnswerInput,
): RecordOf<"link_request.record"> | null {
  const item = server.projection(input.threadId)?.turnItems.find((candidate) => candidate.id === input.turnItemId);
  if (item?.type !== "link_request" || item.runId === null || item.linkStatus !== "pending") return null;
  const { answer } = input;
  const linked =
    answer.type === "decline"
      ? null
      : answer.type === "use-existing"
        ? {
            environmentId: answer.environmentId,
            label: item.label ?? item.hint ?? "the linked machine",
            access: item.requestedAccess,
          }
        : {
            environmentId: answer.environmentId ?? item.environmentId,
            label: answer.label ?? hostOf(answer.urls[0]),
            access: answer.access,
          };
  return {
    type: "link_request.record",
    commandId: CommandId.make(`mock-link-${input.turnItemId}`),
    threadId: input.threadId,
    runId: item.runId,
    nodeId: item.nodeId ?? NodeId.make(`${item.id}-node`),
    turnItemId: item.id,
    reason: item.reason,
    ...(item.url === undefined ? {} : { url: item.url }),
    ...(item.environmentId === undefined ? {} : { environmentId: item.environmentId }),
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(item.hint === undefined ? {} : { hint: item.hint }),
    ...(item.requestedAccess === undefined ? {} : { requestedAccess: item.requestedAccess }),
    linkStatus: linked ? "linked" : "declined",
    ...(linked?.environmentId === undefined ? {} : { linkedEnvironmentId: linked.environmentId }),
    ...(linked ? { linkedLabel: linked.label } : {}),
    ...(linked?.access === undefined ? {} : { linkedAccess: linked.access }),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Applies a recorded secret or link answer to its card, then the run carries on. */
export function recordCard(
  server: MockServer,
  command: RecordOf<"secret_request.record"> | RecordOf<"link_request.record">,
): void {
  const item = server.projection(command.threadId)?.turnItems.find((candidate) => candidate.id === command.turnItemId);
  if (!item) return;
  const at = now();
  if (command.type === "secret_request.record" && item.type === "secret_request") {
    server.emit(command.threadId, [
      {
        type: "turn-item.updated",
        payload: { ...item, secretStatus: command.secretStatus, status: "completed", completedAt: at, updatedAt: at },
      },
    ]);
  } else if (command.type === "link_request.record" && item.type === "link_request") {
    const {
      type: _type,
      commandId: _commandId,
      threadId: _threadId,
      runId: _runId,
      nodeId: _nodeId,
      turnItemId: _turnItemId,
      ...fields
    } = command;
    server.emit(command.threadId, [
      { type: "turn-item.updated", payload: { ...item, ...fields, status: "completed", completedAt: at, updatedAt: at } },
    ]);
  } else {
    return;
  }
  resumeAfterRequest(server, command.threadId, item.runId);
}

/** The row the real server shows for "Resume thread" (a manual continuation): no bubble. */
const RESUMED: OrchestrationV2Notification = { source: { kind: "system" }, outcome: "updated", summary: "Resumed thread" };

function messageInput(command: CommandOf<"message.dispatch">): MessageInput {
  const notification = command.manualContinuationOfRunId !== undefined ? RESUMED : command.notification;
  return {
    messageId: command.messageId,
    // The server sends a continuation's text as empty; the agent just carries on.
    text: command.manualContinuationOfRunId !== undefined ? "" : command.text,
    ...(notification ? { notification } : {}),
    ...(command.manualContinuationOfRunId ? { manualContinuationOfRunId: command.manualContinuationOfRunId } : {}),
    attachments: command.attachments,
    ...(command.context ? { context: command.context } : {}),
    ...(command.modelSelection ? { modelSelection: command.modelSelection } : {}),
    createdBy: command.createdBy,
    creationSource: command.creationSource,
    ...(command.freshContext ? { freshContext: true } : {}),
  };
}

/**
 * How the server resolves a send's delivery intent (CommandPolicy `resolveDeliveryIntent`): the
 * composer's Steer sends `steer`, an interrupt-and-send `restart`, a plain send `auto`. `auto`
 * queues, as it does for a provider that takes queued messages.
 */
function deliveryMode(
  command: CommandOf<"message.dispatch">,
  active: OrchestrationV2Run | undefined,
): CommandOf<"message.dispatch">["dispatchMode"]["type"] {
  if (command.deliveryIntent === undefined || active === undefined || command.freshContext === true) {
    return command.dispatchMode.type;
  }
  if (command.deliveryIntent === "steer") return "steer_active";
  if (command.deliveryIntent === "restart") return "restart_active";
  return "queue_after_active";
}

function dispatchMessage(server: MockServer, command: CommandOf<"message.dispatch">): void {
  const { threadId } = command;
  if (!server.thread(threadId)) return;
  const input = messageInput(command);
  const active = activeRun(server, threadId);
  const mode = deliveryMode(command, active);
  if (active === undefined) {
    startRun(server, threadId, input);
    return;
  }
  if (mode === "steer_active") {
    const { item, message } = userItem(server, threadId, active.id, input, "steer", "completed");
    server.emit(threadId, [
      { type: "message.updated", payload: message },
      { type: "turn-item.updated", payload: item },
    ]);
    return;
  }
  if (mode === "restart_active") {
    interruptRun(server, threadId, active.id);
    startRun(server, threadId, input);
    return;
  }
  // queue_after_active, and a start or deferred start that finds a run already going.
  queueRun(server, threadId, input);
}

function createThread(
  server: MockServer,
  input: {
    readonly threadId: ThreadId;
    readonly projectId: OrchestrationV2AppThread["projectId"];
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: OrchestrationV2AppThread["runtimeMode"];
    readonly interactionMode: OrchestrationV2AppThread["interactionMode"];
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly createdBy: OrchestrationV2AppThread["createdBy"];
    readonly creationSource: OrchestrationV2AppThread["creationSource"];
  },
): void {
  if (server.thread(input.threadId)) return;
  const at = now();
  const thread: OrchestrationV2AppThread = {
    id: input.threadId,
    projectId: input.projectId,
    title: input.title,
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    branch: input.branch,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
    forkedFrom: null,
    createdBy: input.createdBy,
    creationSource: input.creationSource,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: at,
    deletedAt: null,
  };
  // Planted threads get a context-window figure at boot; a visitor's thread gets one the same way.
  server.addThread(withDefaultContextUsage(emptyProjection(thread)));
}

/** A short title from the first words of a message, as the real title generator might. */
function titleFrom(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 7).join(" ");
  const title = words.length > 48 ? `${words.slice(0, 47)}…` : words;
  return title.length > 0 ? title : "New thread";
}

export function launchThread(
  server: MockServer,
  input: OrchestrationV2ThreadLaunchInput,
): OrchestrationV2ThreadLaunchResult {
  const threadId = input.threadId ?? ThreadId.make(`thread-${input.commandId}`);
  const resumed = server.thread(threadId) !== undefined;
  const text = input.initialMessage?.text ?? "";
  createThread(server, {
    threadId,
    projectId: input.projectId,
    title: input.generateTitle && text ? titleFrom(text) : input.title,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    branch: input.workspaceStrategy.branch ?? "main",
    worktreePath: input.workspaceStrategy.type === "existing_worktree" ? input.workspaceStrategy.worktreePath : null,
    createdBy: "user",
    creationSource: input.creationSource ?? "web",
  });
  if (input.initialMessage) {
    const messageId = input.initialMessage.messageId ?? MessageId.make(`message-${input.commandId}`);
    if (activeRun(server, threadId)) {
      queueRun(server, threadId, { messageId, text, attachments: input.initialMessage.attachments });
    } else {
      startRun(server, threadId, {
        messageId,
        text,
        attachments: input.initialMessage.attachments,
        ...(input.initialMessage.context ? { context: input.initialMessage.context } : {}),
        modelSelection: input.modelSelection,
      });
    }
  }
  return {
    threadId,
    projection: server.projection(threadId)!,
    resumed,
    sequence: server.sequence,
  };
}

/** Applies one command. Returns false for command types the kernel does not model. */
export function reduceCommand(server: MockServer, command: OrchestrationV2Command): boolean {
  const at = now();
  switch (command.type) {
    case "message.dispatch":
      dispatchMessage(server, command);
      return true;
    case "thread.create":
      createThread(server, command);
      if (command.initialMessage) {
        startRun(server, command.threadId, {
          messageId: command.initialMessage.messageId,
          text: command.initialMessage.text,
          attachments: command.initialMessage.attachments,
          ...(command.initialMessage.context ? { context: command.initialMessage.context } : {}),
        });
      }
      return true;
    case "run.interrupt": {
      interruptRun(server, command.threadId, command.runId);
      if (command.holdQueue === true) holdQueue(server, command.threadId);
      else startNextQueued(server, command.threadId);
      return true;
    }
    case "thread.stop": {
      const projection = server.projection(command.threadId);
      for (const run of projection?.runs ?? []) {
        if (LIVE.has(run.status)) interruptRun(server, command.threadId, run.id);
      }
      holdQueue(server, command.threadId);
      return true;
    }
    case "queued-run.cancel": {
      const run = queuedRuns(server, command.threadId).find((candidate) => candidate.id === command.runId);
      if (!run) return true;
      const item = userItemOf(server, command.threadId, run);
      server.emit(command.threadId, [
        { type: "run.updated", payload: { ...run, status: "cancelled", queuePosition: null, completedAt: at } },
        ...(item
          ? [{ type: "turn-item.updated", payload: { ...item, status: "cancelled", completedAt: at, updatedAt: at } } as const]
          : []),
      ]);
      renumberQueue(server, command.threadId, queuedRuns(server, command.threadId));
      return true;
    }
    case "queued-run.reorder": {
      const queue = queuedRuns(server, command.threadId);
      const moving = queue.find((run) => run.id === command.runId);
      if (!moving) return true;
      const rest = queue.filter((run) => run.id !== command.runId);
      const index = command.beforeRunId === null ? rest.length : rest.findIndex((run) => run.id === command.beforeRunId);
      rest.splice(index === -1 ? rest.length : index, 0, moving);
      renumberQueue(server, command.threadId, rest);
      return true;
    }
    case "queued-run.edit": {
      const run = queuedRuns(server, command.threadId).find((candidate) => candidate.id === command.runId);
      const item = run ? userItemOf(server, command.threadId, run) : undefined;
      if (!run || !item) return true;
      const message = server.projection(command.threadId)?.messages.find((candidate) => candidate.id === item.messageId);
      server.emit(command.threadId, [
        {
          type: "turn-item.updated",
          payload: {
            ...item,
            text: command.text,
            updatedAt: at,
            ...(command.attachments ? { attachments: [...command.attachments] } : {}),
            ...(command.context ? { context: command.context } : {}),
          },
        },
        ...(message
          ? [{ type: "message.updated", payload: { ...message, text: command.text, updatedAt: at } } as const]
          : []),
      ]);
      return true;
    }
    case "queued-message.promote-to-steer": {
      const run = queuedRuns(server, command.threadId).find((candidate) => candidate.id === command.queuedRunId);
      const item = run ? userItemOf(server, command.threadId, run) : undefined;
      if (!run) return true;
      const message = item
        ? server.projection(command.threadId)?.messages.find((candidate) => candidate.id === item.messageId)
        : undefined;
      server.emit(command.threadId, [
        { type: "run.updated", payload: { ...run, status: "cancelled", queuePosition: null, completedAt: at } },
        ...(item
          ? [
              {
                type: "turn-item.updated",
                payload: {
                  ...item,
                  runId: command.targetRunId,
                  status: "completed",
                  inputIntent: "promoted_queued_to_steer",
                  completedAt: at,
                  updatedAt: at,
                  ordinal: nextOrdinal(server, command.threadId),
                },
              } as const,
            ]
          : []),
        ...(message
          ? [{ type: "message.updated", payload: { ...message, runId: command.targetRunId, updatedAt: at } } as const]
          : []),
      ]);
      renumberQueue(server, command.threadId, queuedRuns(server, command.threadId));
      return true;
    }
    case "queue.resume": {
      server.emit(
        command.threadId,
        queuedRuns(server, command.threadId)
          .filter((run) => run.queueHeld === true)
          .map((run) => ({ type: "run.updated", payload: { ...run, queueHeld: false } }) as const),
      );
      startNextQueued(server, command.threadId);
      return true;
    }
    case "queued-run.start": {
      const run = queuedRuns(server, command.threadId).find((candidate) => candidate.id === command.runId);
      if (!run) return true;
      const active = activeRun(server, command.threadId);
      if (active) interruptRun(server, command.threadId, active.id);
      startQueued(server, command.threadId, run);
      return true;
    }
    case "runtime-request.respond":
    case "thread.user-input.dismiss":
      resolveRequest(server, command.threadId, command);
      return true;
    case "thread.pin":
      updateThread(server, command.threadId, "thread.pinned", (thread) => ({
        ...thread,
        pinnedAt: at,
        pinOrderKey: command.orderKey ?? `a${DateTime.toEpochMillis(at)}`,
      }));
      return true;
    case "thread.unpin":
      updateThread(server, command.threadId, "thread.unpinned", (thread) => ({
        ...thread,
        pinnedAt: null,
        pinOrderKey: null,
      }));
      return true;
    case "thread.pin.reorder":
      updateThread(server, command.threadId, "thread.pin-reordered", (thread) => ({
        ...thread,
        pinOrderKey: command.orderKey,
      }));
      return true;
    case "thread.active.reorder":
      updateThread(server, command.threadId, "thread.active-reordered", (thread) => ({
        ...thread,
        activeOrderKey: command.orderKey,
      }));
      return true;
    case "thread.snooze":
      updateThread(server, command.threadId, "thread.snoozed", (thread) => ({
        ...thread,
        snoozedUntil: DateTime.makeUnsafe(command.snoozedUntil),
        snoozedAt: at,
      }));
      return true;
    case "thread.unsnooze":
      updateThread(server, command.threadId, "thread.unsnoozed", (thread) => ({
        ...thread,
        snoozedUntil: null,
        snoozedAt: null,
        lastSnoozeWakeAt: at,
      }));
      return true;
    case "thread.settle":
    case "thread.auto-settle":
      updateThread(server, command.threadId, "thread.settled", (thread) => ({
        ...thread,
        settledOverride: "settled",
        settledAt: command.settledAt ?? at,
      }));
      return true;
    case "thread.unsettle":
      updateThread(server, command.threadId, "thread.unsettled", (thread) => ({
        ...thread,
        settledOverride: "active",
        settledAt: null,
        unsettledAt:
          command.restoreUnsettledAt === undefined || command.restoreUnsettledAt === null
            ? at
            : DateTime.makeUnsafe(command.restoreUnsettledAt),
      }));
      return true;
    case "thread.auto-settle.set":
      updateThread(server, command.threadId, "thread.auto-settle-set", (thread) => ({
        ...thread,
        autoSettleDisabledAt: command.enabled ? null : at,
      }));
      return true;
    case "thread.archive":
      updateThread(server, command.threadId, "thread.archived", (thread) => ({ ...thread, archivedAt: at }));
      return true;
    case "thread.unarchive":
      updateThread(server, command.threadId, "thread.unarchived", (thread) => ({ ...thread, archivedAt: null }));
      return true;
    case "thread.delete": {
      const projection = server.projection(command.threadId);
      if (command.onlyIfUnused === true && projection && projection.runs.length > 0) return true;
      for (const run of projection?.runs ?? []) cancelScript(run.id);
      updateThread(server, command.threadId, "thread.deleted", (thread) => ({ ...thread, deletedAt: at }));
      return true;
    }
    case "thread.metadata.update":
      updateThread(server, command.threadId, "thread.metadata-updated", (thread) => ({
        ...thread,
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.branch === undefined ? {} : { branch: command.branch }),
        ...(command.worktreePath === undefined ? {} : { worktreePath: command.worktreePath }),
        ...(command.linkedPullRequest === undefined ? {} : { linkedPullRequest: command.linkedPullRequest }),
      }));
      return true;
    case "thread.visit": {
      if (!server.thread(command.threadId)) return true;
      server.emit(command.threadId, [
        {
          type: "thread.visit-recorded",
          payload: { lastVisitedAt: DateTime.makeUnsafe(command.visitedAt) },
        },
      ]);
      return true;
    }
    case "thread.mark-unread":
      updateThread(server, command.threadId, "thread.marked-unread", (thread) => {
        const latest = server
          .projection(command.threadId)
          ?.runs.reduce<DateTime.Utc | null>(
            (max, run) =>
              run.completedAt !== null && (max === null || DateTime.toEpochMillis(run.completedAt) > DateTime.toEpochMillis(max))
                ? run.completedAt
                : max,
            null,
          );
        return {
          ...thread,
          lastVisitedAt: latest ? DateTime.makeUnsafe(DateTime.toEpochMillis(latest) - 1_000) : null,
        };
      });
      return true;
    case "thread.tag.set":
      updateThread(server, command.threadId, "thread.tags-updated", (thread) => {
        const tags = (thread.tags ?? []).filter((tag) => tag !== command.tag);
        return { ...thread, tags: command.tagged ? [...tags, command.tag] : tags };
      });
      return true;
    case "thread.runtime-mode.set":
      updateThread(server, command.threadId, "thread.runtime-mode-updated", (thread) => ({
        ...thread,
        runtimeMode: command.runtimeMode,
      }));
      return true;
    case "thread.interaction-mode.set":
      updateThread(server, command.threadId, "thread.interaction-mode-updated", (thread) => ({
        ...thread,
        interactionMode: command.interactionMode,
      }));
      return true;
    case "thread.model-selection.set":
      updateThread(server, command.threadId, "thread.model-selection-updated", (thread) => ({
        ...thread,
        modelSelection: command.modelSelection,
        providerInstanceId: command.modelSelection.instanceId,
      }));
      return true;
    case "provider.switch":
      updateThread(server, command.threadId, "thread.provider-switched", (thread) => ({
        ...thread,
        modelSelection: command.modelSelection,
        providerInstanceId: command.modelSelection.instanceId,
      }));
      return true;
    default:
      return false;
  }
}
