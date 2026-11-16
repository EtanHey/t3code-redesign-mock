import {
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskUpsertInput,
  ThreadId,
  WS_METHODS,
  type ScheduledTaskListResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Queue from "effect/Queue";
import { agoIso, DEFAULT_MODEL, fromNowIso, projectIdOf, rpc, stream } from "~/redesignMock/api";
import { BUILD_INFO } from "../../kernel/runtime";
import { liveStream } from "../../kernel/server";

function nextRunAt(schedule: ScheduledTask["schedule"]): string | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "once") return schedule.runAt;
  if (schedule.type === "interval") return fromNowIso(schedule.everyMs);
  const current = new Date(agoIso("0s"));
  const next = new Date(current);
  const [hours, minutes] = schedule.timeOfDay.split(":").map(Number);
  next.setUTCHours(hours!, minutes!, 0, 0);
  if (next <= current) next.setUTCDate(next.getUTCDate() + 1);
  while (schedule.weekdays?.length && !schedule.weekdays.includes(next.getUTCDay()))
    next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
const seed = (
  id: string,
  title: string,
  schedule: ScheduledTask["schedule"],
  lastRunStatus: ScheduledTask["lastRunStatus"],
): ScheduledTask => ({
  id: ScheduledTaskId.make(id),
  title,
  prompt: "Check compact layout regressions and summarize any changes.",
  enabled: true,
  schedule,
  projectId: projectIdOf("sidebar"),
  threadId: id === "shell-daily-check" ? ThreadId.make("s03-scheduled") : null,
  threadMode: id === "shell-daily-check" ? "continue" : "new_thread",
  workspaceStrategy: { type: "root" },
  modelSelection: DEFAULT_MODEL,
  runtimeMode: "approval-required",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: agoIso("7d"),
  updatedAt: agoIso("30m"),
  nextRunAt: nextRunAt(schedule),
  lastRunAt: lastRunStatus === "never" ? null : agoIso("8m"),
  lastRunStatus,
  lastRunError:
    lastRunStatus === "failed" ? "The preview check could not find its baseline image." : null,
  runCount: lastRunStatus === "never" ? 0 : 8,
  ...(schedule.type === "webhook"
    ? { webhook: { path: "/api/webhooks/preview-layout", url: null, hasSecret: true } }
    : {}),
});
const seeds = [
  seed(
    "shell-interval-check",
    "Check preview every 30 minutes",
    { type: "interval", everyMs: 1800000 },
    "running",
  ),
  seed(
    "shell-daily-check",
    "Daily compact layout check",
    { type: "fixed_time", timeOfDay: "09:30", weekdays: [1, 2, 3, 4, 5] },
    "succeeded",
  ),
  seed(
    "shell-once-check",
    "Review the next layout snapshot",
    { type: "once", runAt: fromNowIso("4h") },
    "never",
  ),
  seed(
    "shell-webhook-check",
    "Review a preview-ready webhook",
    {
      type: "webhook",
      signature: { header: "x-preview-signature", encoding: "hex", prefix: "sha256=" },
      filters: [{ path: "body.action", op: "equals", value: "preview_ready" }],
    },
    "failed",
  ),
];
const storageKey = () => `redesign-mock:shell-tasks:${BUILD_INFO.fixtureVersion}`;
let tasks: ReadonlyArray<ScheduledTask> = seeds;
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) tasks = Schema.decodeUnknownSync(Schema.Array(ScheduledTask))(JSON.parse(raw));
  } catch {
    /* Start with the public examples if storage is unavailable. */
  }
}
let nextId = 1;
const queues = new Set<Queue.Queue<ScheduledTaskListResult>>();
const snapshot = (): ScheduledTaskListResult => {
  initialize();
  return { tasks, timeZone: "UTC" };
};
function changed() {
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify(Schema.encodeSync(Schema.Array(ScheduledTask))(tasks)),
    );
  } catch {
    /* In-memory editing still works. */
  }
  for (const queue of queues) Queue.offerUnsafe(queue, snapshot());
}
function update(id: string, patch: Partial<ScheduledTask>): ScheduledTask {
  const task = tasks.find((task) => task.id === id);
  if (!task) throw new Error("This preview task no longer exists.");
  const next = { ...task, ...patch, updatedAt: agoIso("0s") };
  tasks = tasks.map((task) => (task.id === id ? next : task));
  changed();
  return next;
}
export default [
  stream(WS_METHODS.scheduledTasksSubscribe, () =>
    liveStream(
      () => [snapshot()],
      (queue) => {
        queues.add(queue);
        return () => {
          queues.delete(queue);
        };
      },
    ),
  ),
  rpc(WS_METHODS.scheduledTasksSetEnabled, (input) => ({
    task: update(input.id, {
      enabled: input.enabled,
      nextRunAt: input.enabled
        ? nextRunAt(tasks.find((task) => task.id === input.id)!.schedule)
        : null,
    }),
  })),
  rpc(WS_METHODS.scheduledTasksDelete, (input) => {
    tasks = tasks.filter((task) => task.id !== input.id);
    changed();
    return { id: ScheduledTaskId.make(input.id) };
  }),
  rpc(WS_METHODS.scheduledTasksRunNow, (input) => {
    const old = tasks.find((task) => task.id === input.id);
    return {
      task: update(input.id, {
        lastRunStatus: "running",
        lastRunError: null,
        lastRunAt: agoIso("0s"),
        runCount: (old?.runCount ?? 0) + 1,
      }),
    };
  }),
  rpc(WS_METHODS.scheduledTasksUpsert, (input) => {
    const decoded = Schema.decodeSync(ScheduledTaskUpsertInput)(input);
    while (tasks.some((task) => task.id === `shell-created-${nextId}`)) nextId += 1;
    const id = decoded.id ?? ScheduledTaskId.make(`shell-created-${nextId++}`);
    const previous = tasks.find((task) => task.id === id);
    if (decoded.requireExisting && !previous)
      throw new Error("This preview task no longer exists.");
    const base =
      previous ?? seed(id, decoded.title, { type: "interval", everyMs: 1800000 }, "never");
    const schedule: ScheduledTask["schedule"] =
      decoded.schedule.type === "webhook"
        ? {
            ...decoded.schedule,
            signature: decoded.schedule.signature
              ? {
                  header: decoded.schedule.signature.header,
                  encoding: decoded.schedule.signature.encoding,
                  prefix: decoded.schedule.signature.prefix,
                }
              : null,
          }
        : decoded.schedule;
    const next: ScheduledTask = {
      ...base,
      ...decoded,
      id,
      schedule,
      nextRunAt: decoded.enabled ? nextRunAt(schedule) : null,
      threadId: decoded.threadId ?? null,
      createdBy: decoded.createdBy ?? "user",
      creationSource: decoded.creationSource ?? "web",
      updatedAt: agoIso("0s"),
      ...(schedule.type === "webhook"
        ? {
            webhook: {
              path: `/api/webhooks/${id}`,
              url: null,
              hasSecret: schedule.signature !== null,
            },
          }
        : {}),
    };
    tasks = [...tasks.filter((task) => task.id !== id), next];
    changed();
    return { task: next };
  }),
  rpc(WS_METHODS.scheduledTasksListWebhookDeliveries, () => ({ deliveries: [] })),
];
