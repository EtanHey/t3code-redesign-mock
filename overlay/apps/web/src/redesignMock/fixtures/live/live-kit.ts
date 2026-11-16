// Shared helpers for the live-work lane: scripted steps that keep text arriving, a command's
// output growing and a timer running for as long as a visitor has the thread open. Not a fixture
// itself (the registry only picks up `*.fixture.ts`).
import { MessageId, type OrchestrationV2TurnItem, type TurnItemId } from "@t3tools/contracts";

import { item, now, plus, step, type ItemSpec, type RunHandle, type ScriptStep, type Span } from "../../api";

type StreamedType = "assistant_message" | "reasoning";

/** The newest item of `type` that is still streaming in this run. */
function openStream(run: RunHandle, type: StreamedType): OrchestrationV2TurnItem | undefined {
  const projection = run.server.projection(run.threadId);
  return projection?.turnItems.findLast(
    (candidate) =>
      candidate.runId === run.runId &&
      candidate.type === type &&
      (candidate.type === "assistant_message" || candidate.type === "reasoning") &&
      candidate.streaming,
  );
}

function wordsOf(text: string): string[] {
  return text.split(/(?<=\s)/);
}

/**
 * Finishes a planted streaming item: the fixture planted the first `fromWords` words, and these
 * steps add the rest a few words at a time. `finish: false` leaves it streaming at the end.
 */
export function continueStreaming(
  type: StreamedType,
  fullText: string,
  fromWords: number,
  options: { readonly every?: Span; readonly perStep?: number; readonly finish?: boolean } = {},
): ScriptStep[] {
  const words = wordsOf(fullText);
  const every = options.every ?? "110ms";
  const perStep = options.perStep ?? 3;
  const steps: ScriptStep[] = [];
  for (let count = fromWords + perStep; count < words.length + perStep; count += perStep) {
    const upTo = Math.min(count, words.length);
    steps.push(
      step(every, (run) => {
        const open = openStream(run, type);
        if (!open) return;
        const text = words.slice(0, upTo).join("");
        run.update(open.id, (current) =>
          current.type === "assistant_message" || current.type === "reasoning" ? { ...current, text } : current,
        );
      }),
    );
  }
  if (options.finish !== false) {
    steps.push(
      step("200ms", (run) => {
        const open = openStream(run, type);
        if (open) run.complete(open.id);
      }),
    );
  }
  return steps;
}

const PARAGRAPH_CHUNKS = 16;

interface Paragraph {
  index: number;
  id: TurnItemId | null;
}
const paragraphs = new WeakMap<RunHandle, Paragraph>();

/**
 * A new streaming item every lap, cycling through `texts`. Meant for a script's `loop`, so the
 * thread keeps receiving words for as long as it is open.
 */
export function streamParagraphs(
  type: StreamedType,
  texts: ReadonlyArray<string>,
  options: { readonly after?: Span; readonly every?: Span; readonly phase?: "commentary" | "partial_answer" } = {},
): ScriptStep[] {
  const every = options.every ?? "130ms";
  const steps: ScriptStep[] = [
    step(options.after ?? "3s", (run) => {
      const state = paragraphs.get(run) ?? { index: 0, id: null };
      paragraphs.set(run, state);
      const text = texts[state.index % texts.length] ?? "";
      state.index += 1;
      const first = wordsOf(text).slice(0, 2).join("");
      if (type === "assistant_message") {
        const id = run.addRaw((base) => ({
          ...base,
          completedAt: null,
          type: "assistant_message",
          messageId: MessageId.make(base.id),
          phase: options.phase ?? "commentary",
          text: first,
          streaming: true,
        }));
        state.id = id;
        const item = run.item(id);
        if (item?.type === "assistant_message") {
          run.server.emit(run.threadId, [
            {
              type: "message.updated",
              payload: {
                id: item.messageId,
                threadId: run.threadId,
                runId: run.runId,
                nodeId: null,
                role: "assistant",
                text: first,
                attachments: [],
                streaming: true,
                createdAt: item.updatedAt,
                updatedAt: item.updatedAt,
                createdBy: "system",
                creationSource: "server",
              },
            },
          ]);
        }
      } else {
        state.id = run.addRaw((base) => ({
          ...base,
          completedAt: null,
          type: "reasoning",
          text: first,
          streaming: true,
        }));
      }
    }),
  ];
  for (let chunk = 1; chunk <= PARAGRAPH_CHUNKS; chunk += 1) {
    steps.push(
      step(every, (run) => {
        const state = paragraphs.get(run);
        if (!state?.id) return;
        const text = texts[(state.index - 1) % texts.length] ?? "";
        const words = wordsOf(text);
        const upTo = Math.ceil((words.length * chunk) / PARAGRAPH_CHUNKS);
        const next = words.slice(0, upTo).join("");
        run.update(state.id, (current) =>
          current.type === "assistant_message" || current.type === "reasoning" ? { ...current, text: next } : current,
        );
      }),
    );
  }
  steps.push(
    step("250ms", (run) => {
      const state = paragraphs.get(run);
      if (state?.id) run.complete(state.id);
    }),
  );
  return steps;
}

interface LiveCommand {
  id: TurnItemId | null;
  lines: number;
}
const commands = new WeakMap<RunHandle, LiveCommand>();

/**
 * A command that prints a line at a time, then exits. Each lap of a loop starts a new one.
 * `exitCode` and `finalLine` decide how it ends.
 */
export function printingCommand(options: {
  readonly input: string;
  readonly lines: ReadonlyArray<string>;
  readonly every?: Span;
  readonly after?: Span;
  readonly exitCode?: number;
  readonly failedTestCount?: number;
}): ScriptStep[] {
  const every = options.every ?? "700ms";
  const steps: ScriptStep[] = [
    step(options.after ?? "400ms", (run) => {
      const id = run.addRaw((base) => ({
        ...base,
        completedAt: null,
        type: "command_execution",
        input: options.input,
        output: "",
      }));
      commands.set(run, { id, lines: 0 });
    }),
  ];
  options.lines.forEach((_, index) => {
    steps.push(
      step(every, (run) => {
        const state = commands.get(run);
        if (!state?.id) return;
        const output = `${options.lines.slice(0, index + 1).join("\n")}\n`;
        run.update(state.id, (current) =>
          current.type === "command_execution" ? { ...current, output } : current,
        );
      }),
    );
  });
  steps.push(
    step("600ms", (run) => {
      const state = commands.get(run);
      if (!state?.id) return;
      const exitCode = options.exitCode ?? 0;
      run.complete(state.id, (current) =>
        current.type === "command_execution"
          ? {
              ...current,
              status: exitCode === 0 ? "completed" : "failed",
              exitCode,
              ...(options.failedTestCount === undefined ? {} : { failedTestCount: options.failedTestCount }),
            }
          : current,
      );
    }),
  );
  return steps;
}

/** Ends the run the script belongs to, as the provider does when a turn finishes. */
export function finishRun(run: RunHandle, status: "completed" | "failed" = "completed"): void {
  const projection = run.server.projection(run.threadId);
  const current = run.run();
  if (!projection || !current) return;
  const at = now();
  const attempt = projection.attempts.find((candidate) => candidate.id === current.activeAttemptId);
  const providerTurn = projection.providerTurns.find((candidate) => candidate.runAttemptId === current.activeAttemptId);
  run.server.emit(run.threadId, [
    ...(attempt ? [{ type: "run-attempt.updated" as const, payload: { ...attempt, status, completedAt: at } }] : []),
    ...(providerTurn
      ? [{ type: "provider-turn.updated" as const, payload: { ...providerTurn, status, completedAt: at } }]
      : []),
    { type: "run.updated" as const, payload: { ...current, status, completedAt: at } },
  ]);
}

/**
 * A command that has already ended, even when it is the last item of a run that is still live
 * (the planting code would otherwise leave the last item running). `after` is how long it ran.
 */
export function finishedCommand(options: {
  readonly input: string;
  readonly output: string;
  readonly exitCode: number;
  readonly status?: "completed" | "failed";
  readonly after?: Span;
}): ItemSpec {
  return item((base) => ({
    ...base,
    status: options.status ?? (options.exitCode === 0 ? "completed" : "failed"),
    completedAt: plus(base.startedAt, options.after ?? "5s"),
    type: "command_execution",
    input: options.input,
    output: options.output,
    exitCode: options.exitCode,
  }));
}

/** Ends the command the run's plant left running, with its final output (a script step). */
export function finishLiveCommand(output: string, after: Span = "4s", exitCode = 0): ScriptStep {
  return step(after, (run) => {
    const live = run.server
      .projection(run.threadId)
      ?.turnItems.findLast(
        (candidate) =>
          candidate.runId === run.runId && candidate.type === "command_execution" && candidate.status === "running",
      );
    if (!live) return;
    run.complete(live.id, (current) =>
      current.type === "command_execution"
        ? { ...current, output, exitCode, status: exitCode === 0 ? "completed" : "failed" }
        : current,
    );
  });
}
