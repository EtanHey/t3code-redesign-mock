// Timed scripts that make a run look alive. A script is a list of steps, each run a delay after
// the previous one, plus an optional loop that repeats forever. Steps whose time has already
// passed (a reload replaying the visitor's log) run at once, in order, with the clock pinned to
// their own time; the loop then continues live.
import {
  MessageId,
  NodeId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  type OrchestrationV2UserInputQuestion,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";

import { atTime, nowMs, now, spanMs, type Span } from "./clock";
import { attemptStatusOf, runPlumbing } from "./plumbing";
import { itemBase, type ItemBase, type ItemContext, type ItemSpec, MOCK_PROVIDER_SESSION } from "./dsl";
import type { MockServer, ThreadEventInput } from "./server";

export interface ScriptStep {
  /** Milliseconds after the previous step. */
  readonly after: number;
  readonly run: (handle: RunHandle) => void;
}

export interface RunScript {
  readonly steps: ReadonlyArray<ScriptStep>;
  /** Repeats forever after `steps`, until the run stops. Never fast-forwarded. */
  readonly loop?: ReadonlyArray<ScriptStep>;
  /** What happens after the visitor answers a request this run asked. */
  readonly afterAnswer?: RunScript;
}

const LIVE_RUN = new Set<OrchestrationV2Run["status"]>(["preparing", "starting", "running", "waiting"]);

/** What a script step can do to its run. Item ids derive from the run, so a replay recreates them. */
export class RunHandle {
  private counter = 0;
  private readonly remembered = new Map<object, TurnItemId>();

  /** Lets a multi-step helper find the item its first step added, per run. */
  remember(key: object, id: TurnItemId): void {
    this.remembered.set(key, id);
  }

  recall(key: object): TurnItemId | undefined {
    return this.remembered.get(key);
  }

  constructor(
    readonly server: MockServer,
    readonly threadId: ThreadId,
    readonly runId: RunId,
  ) {}

  run(): OrchestrationV2Run | undefined {
    return this.server.projection(this.threadId)?.runs.find((candidate) => candidate.id === this.runId);
  }

  isLive(): boolean {
    const run = this.run();
    return run !== undefined && LIVE_RUN.has(run.status);
  }

  item(id: TurnItemId): OrchestrationV2TurnItem | undefined {
    return this.server.projection(this.threadId)?.turnItems.find((candidate) => candidate.id === id);
  }

  private nextContext(): ItemContext {
    const projection = this.server.projection(this.threadId);
    const ordinal =
      (projection?.turnItems.reduce((max, candidate) => Math.max(max, candidate.ordinal), -1) ?? -1) + 1;
    this.counter += 1;
    return {
      threadId: this.threadId,
      runId: this.runId,
      ordinal,
      id: TurnItemId.make(`${this.runId}-step-${this.counter}`),
      at: now(),
      endedAt: null,
    };
  }

  /** Adds an item to the run; it starts running unless the spec says otherwise. */
  add(spec: ItemSpec): TurnItemId {
    const planted = spec(this.nextContext());
    const events: ThreadEventInput[] = [{ type: "turn-item.updated", payload: planted.item }];
    for (const request of planted.runtimeRequests ?? []) {
      events.push({ type: "runtime-request.updated", payload: request });
    }
    for (const plan of planted.plans ?? []) events.push({ type: "plan.updated", payload: plan });
    if (planted.message) events.push({ type: "message.updated", payload: planted.message });
    this.server.emit(this.threadId, events);
    return planted.item.id;
  }

  /** Adds a raw item built from `base` (ids, ordinal, times; status running). */
  addRaw(build: (base: ItemBase) => OrchestrationV2TurnItem): TurnItemId {
    const context = this.nextContext();
    const turnItem = build(itemBase(context));
    this.server.emit(this.threadId, [{ type: "turn-item.updated", payload: turnItem }]);
    return turnItem.id;
  }

  update(id: TurnItemId, change: (current: OrchestrationV2TurnItem) => OrchestrationV2TurnItem): void {
    const current = this.item(id);
    if (!current) return;
    const next = change(current);
    const events: ThreadEventInput[] = [
      { type: "turn-item.updated", payload: { ...next, updatedAt: now() } },
    ];
    if (next.type === "assistant_message") {
      const message = this.server
        .projection(this.threadId)
        ?.messages.find((candidate) => candidate.id === next.messageId);
      if (message) {
        events.push({
          type: "message.updated",
          payload: { ...message, text: next.text, streaming: next.streaming, updatedAt: now() },
        });
      }
    }
    this.server.emit(this.threadId, events);
  }

  /** Marks an item finished. */
  complete(id: TurnItemId, change: (current: OrchestrationV2TurnItem) => OrchestrationV2TurnItem = (x) => x): void {
    this.update(id, (current) => {
      const next = change(current);
      const finished = { ...next, status: next.status === "running" ? ("completed" as const) : next.status, completedAt: now() };
      return finished.type === "assistant_message" || finished.type === "reasoning"
        ? { ...finished, streaming: false }
        : finished;
    });
  }

  setRun(change: (current: OrchestrationV2Run) => OrchestrationV2Run): void {
    const current = this.run();
    if (!current) return;
    this.server.emit(this.threadId, [{ type: "run.updated", payload: change(current) }]);
  }
}

// Running scripts -----------------------------------------------------------------------------

interface Running {
  cancelled: boolean;
  readonly timers: Array<ReturnType<typeof setTimeout>>;
}

const handles = new Map<RunId, RunHandle>();
const running = new Map<RunId, Running>();

export function handleFor(server: MockServer, threadId: ThreadId, runId: RunId): RunHandle {
  let handle = handles.get(runId);
  if (!handle) {
    handle = new RunHandle(server, threadId, runId);
    handles.set(runId, handle);
  }
  return handle;
}

export function cancelScript(runId: RunId): void {
  const state = running.get(runId);
  if (!state) return;
  state.cancelled = true;
  for (const timer of state.timers) clearTimeout(timer);
  running.delete(runId);
}

/** Runs `script` for a run, starting at `startAt` (ms since epoch). Past steps run at once. */
export function runScript(
  server: MockServer,
  threadId: ThreadId,
  runId: RunId,
  script: RunScript,
  startAt: number = nowMs(),
): void {
  cancelScript(runId);
  const handle = handleFor(server, threadId, runId);
  const state: Running = { cancelled: false, timers: [] };
  running.set(runId, state);
  let at = startAt;

  const fire = (step: ScriptStep) => {
    if (state.cancelled || !handle.isLive()) return;
    step.run(handle);
  };

  for (const step of script.steps) {
    at += step.after;
    const stepAt = at;
    if (stepAt <= Date.now()) {
      atTime(stepAt, () => fire(step));
    } else {
      state.timers.push(setTimeout(() => fire(step), stepAt - Date.now()));
    }
  }

  const loop = script.loop;
  if (loop && loop.length > 0) {
    const scheduleLoop = (from: number) => {
      let loopAt = from;
      loop.forEach((step, index) => {
        loopAt += step.after;
        const delay = Math.max(0, loopAt - Date.now());
        const isLast = index === loop.length - 1;
        const fireAt = loopAt;
        state.timers.push(
          setTimeout(() => {
            fire(step);
            if (isLast && !state.cancelled && handle.isLive()) {
              // Keep the timer list short across many laps.
              state.timers.length = 0;
              scheduleLoop(fireAt);
            }
          }, delay),
        );
      });
    };
    scheduleLoop(Math.max(at, Date.now()));
  }
}

// Building scripts ------------------------------------------------------------------------------

export type ScriptPart = ScriptStep | ReadonlyArray<ScriptStep>;

/** Joins parts into a script: `script([think("..."), say("...")], { loop: [...] })`. */
export function script(
  parts: ReadonlyArray<ScriptPart>,
  options: { readonly loop?: ReadonlyArray<ScriptPart>; readonly afterAnswer?: RunScript } = {},
): RunScript {
  const flatten = (list: ReadonlyArray<ScriptPart>): ScriptStep[] =>
    list.flatMap((part) => (Array.isArray(part) ? [...part] : [part as ScriptStep]));
  return {
    steps: flatten(parts),
    ...(options.loop ? { loop: flatten(options.loop) } : {}),
    ...(options.afterAnswer ? { afterAnswer: options.afterAnswer } : {}),
  };
}

/** A raw step: `step("2s", (run) => ...)`. */
export function step(after: Span, run: (handle: RunHandle) => void): ScriptStep {
  return { after: spanMs(after), run };
}

export function pause(span: Span): ScriptStep {
  return step(span, () => {});
}

/** Sets the run's status, such as `starting` then `running`. */
export function status(after: Span, value: OrchestrationV2Run["status"]): ScriptStep {
  return step(after, (handle) => {
    const run = handle.run();
    if (!run) return;
    const next: OrchestrationV2Run = {
      ...run,
      status: value,
      ...(value === "running" && run.startedAt === null ? { startedAt: now() } : {}),
    };
    const attemptStatus = attemptStatusOf(value);
    if (attemptStatus === "running" && run.activeAttemptId === null) {
      // The provider turn opens: the run reads as working rather than starting.
      const { attempt, turn } = runPlumbing(next, attemptStatus);
      handle.server.emit(handle.threadId, [
        { type: "run-attempt.created", payload: attempt },
        { type: "provider-turn.updated", payload: turn },
        { type: "run.updated", payload: { ...next, activeAttemptId: attempt.id } },
      ]);
      return;
    }
    handle.server.emit(handle.threadId, [{ type: "run.updated", payload: next }]);
  });
}

/** What happens once a run ends on its own: the reducer starts the next queued run. */
let afterRunEnds: ((server: MockServer, threadId: ThreadId) => void) | null = null;
export function onRunEnds(listener: (server: MockServer, threadId: ThreadId) => void): void {
  afterRunEnds = listener;
}

/** Ends the run the way a finished provider turn does: run, attempt and provider turn settle. */
export function endRun(handle: RunHandle, value: "completed" | "failed" = "completed"): void {
  const run = handle.run();
  const projection = handle.server.projection(handle.threadId);
  if (!run || !projection || !LIVE_RUN.has(run.status)) return;
  const at = now();
  const events: ThreadEventInput[] = [];
  const attempt = projection.attempts.find((candidate) => candidate.id === run.activeAttemptId);
  const turn = projection.providerTurns.find((candidate) => candidate.runAttemptId === run.activeAttemptId);
  if (attempt) events.push({ type: "run-attempt.updated", payload: { ...attempt, status: value, completedAt: at } });
  if (turn) events.push({ type: "provider-turn.updated", payload: { ...turn, status: value, completedAt: at } });
  events.push({ type: "run.updated", payload: { ...run, status: value, completedAt: at } });
  handle.server.emit(handle.threadId, events);
  cancelScript(handle.runId);
  afterRunEnds?.(handle.server, handle.threadId);
}

/** A step that ends the run. */
export function finish(after: Span = "300ms", value: "completed" | "failed" = "completed"): ScriptStep {
  return step(after, (handle) => endRun(handle, value));
}

/** "Thinking" for a while, then "Thought". */
export function think(text: string, duration: Span = "1.4s", after: Span = "300ms"): ScriptStep[] {
  const key = {};
  return [
    step(after, (handle) => {
      handle.remember(
        key,
        handle.addRaw((base) => ({ ...base, completedAt: null, type: "reasoning", text, streaming: true })),
      );
    }),
    step(duration, (handle) => {
      const id = handle.recall(key);
      if (id) handle.complete(id);
    }),
  ];
}

/** A shell command that runs for a while and then exits. */
export function exec(
  options: { readonly input: string; readonly output?: string; readonly exitCode?: number },
  duration: Span = "1.2s",
  after: Span = "250ms",
): ScriptStep[] {
  const key = {};
  return [
    step(after, (handle) => {
      handle.remember(
        key,
        handle.addRaw((base) => ({ ...base, completedAt: null, type: "command_execution", input: options.input })),
      );
    }),
    step(duration, (handle) => {
      const id = handle.recall(key);
      if (!id) return;
      const exitCode = options.exitCode ?? 0;
      handle.complete(id, (current) =>
        current.type === "command_execution"
          ? {
              ...current,
              status: exitCode === 0 ? "completed" : "failed",
              exitCode,
              ...(options.output === undefined ? {} : { output: options.output }),
            }
          : current,
      );
    }),
  ];
}

/** Streams an assistant message a few words at a time. */
export function say(
  text: string,
  options: {
    readonly phase?: "commentary" | "partial_answer" | "final_answer";
    readonly every?: Span;
    readonly after?: Span;
  } = {},
): ScriptStep[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += 6) chunks.push(words.slice(0, index + 6).join(""));
  const every = spanMs(options.every ?? "70ms");
  const key = {};
  return [
    step(options.after ?? "300ms", (handle) => {
      const id = handle.addRaw((base) => ({
        ...base,
        completedAt: null,
        type: "assistant_message",
        messageId: messageIdOf(base.id),
        phase: options.phase ?? "commentary",
        text: chunks[0] ?? "",
        streaming: true,
      }));
      handle.remember(key, id);
      const item = handle.item(id);
      if (item?.type === "assistant_message") {
        handle.server.emit(handle.threadId, [
          {
            type: "message.updated",
            payload: {
              id: item.messageId,
              threadId: handle.threadId,
              runId: handle.runId,
              nodeId: null,
              role: "assistant",
              text: item.text,
              attachments: [],
              streaming: true,
              createdAt: now(),
              updatedAt: now(),
              createdBy: "system",
              creationSource: "server",
            },
          },
        ]);
      }
    }),
    ...chunks.slice(1).map((chunk) =>
      step(every, (handle) => {
        const id = handle.recall(key);
        if (id) handle.update(id, (current) => (current.type === "assistant_message" ? { ...current, text: chunk } : current));
      }),
    ),
    step(every, (handle) => {
      const id = handle.recall(key);
      if (id) handle.complete(id);
    }),
  ];
}

/** Starts a command that keeps running: the "still working" row. */
export function hold(options: { readonly input: string; readonly output?: string }, after: Span = "400ms"): ScriptStep {
  return step(after, (handle) => {
    handle.addRaw((base) => ({
      ...base,
      completedAt: null,
      type: "command_execution",
      input: options.input,
      ...(options.output === undefined ? {} : { output: options.output }),
    }));
  });
}

/** Asks the visitor a question; the run waits until it is answered. */
export function ask(questions: ReadonlyArray<OrchestrationV2UserInputQuestion>, after: Span = "500ms"): ScriptStep {
  return step(after, (handle) => {
    const id = handle.addRaw((base) => ({
      ...base,
      status: "waiting",
      completedAt: null,
      type: "user_input_request",
      requestId: requestIdOf(base.id),
      questions: [...questions],
    }));
    handle.server.emit(handle.threadId, [
      {
        type: "runtime-request.updated",
        payload: {
          id: requestIdOf(id),
          nodeId: nodeIdOf(id),
          providerTurnId: null,
          nativeRequestRef: null,
          kind: "user_input",
          status: "pending",
          responseCapability: { type: "live", providerSessionId: MOCK_PROVIDER_SESSION },
          createdAt: now(),
          resolvedAt: null,
        },
      },
    ]);
    handle.setRun((run) => ({ ...run, status: "waiting" }));
  });
}

function messageIdOf(id: TurnItemId): MessageId {
  return MessageId.make(id);
}
function requestIdOf(id: TurnItemId): RuntimeRequestId {
  return RuntimeRequestId.make(`${id}-request`);
}
function nodeIdOf(id: TurnItemId): NodeId {
  return NodeId.make(`${id}-node`);
}

// The kernel's default ---------------------------------------------------------------------------

const REPLIES = [
  "This is the mock preview, so no agent is running. A real agent would be reading the code now; here the run simply keeps going until you press Stop.",
  "Nothing here is real: the reply is scripted and the run below never finishes. Queue another message, or press Stop to end the turn.",
  "Mock preview reply. The work row below stays running on purpose, so you can try queueing, steering and stopping a busy thread.",
];

// The row upstream shows for a running command is "Running <program>" (commandProgramName), and
// finished ones fold into "Ran N commands", so the program has to be one a reader recognises.
const WATCH = {
  input: "npm test -- --watch",
  output: " RERUN  src/app/routes.test.ts\n\n ✓ src/app/routes.test.ts (12 tests) 84ms\n\n Test Files  38 passed (38)\n      Tests  214 passed (214)\n\n Waiting for file changes...\n",
};

/** The always-working loop: think, run a command, reply, then hold a running row forever. */
export function alwaysWorking(text: string): RunScript {
  const reply = REPLIES[[...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % REPLIES.length]!;
  return script(
    [
      status("600ms", "running"),
      think("Reading the request and the files it mentions."),
      exec({ input: "rg -n \"TODO\" src --max-count 3", output: "src/app/routes.ts:42: // TODO: split the loader\n" }),
      say(reply),
      hold(WATCH),
    ],
    {
      afterAnswer: script([
        think("Picking up from your answer.", "1.2s"),
        exec({ input: "git status --short", output: " M src/app/routes.ts\n M src/app/loader.ts\n" }),
        hold(WATCH),
      ]),
    },
  );
}
