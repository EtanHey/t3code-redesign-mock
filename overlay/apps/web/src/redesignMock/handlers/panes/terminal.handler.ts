// Terminals that show canned output and accept typing without running anything. Every session is
// a live "shell" (a real exited shell closes its tab in this app, so the three states a visitor
// should see are the ones a live shell reports: a command still running, and the last command
// finished with exit 0 or with a failure). Keys echo; Enter prints a one-line explanation.
import {
  WS_METHODS,
  type TerminalAttachStreamEvent,
  type TerminalMetadataStreamEvent,
  type TerminalSessionSnapshot,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { agoIso, rpc, stream } from "~/redesignMock/api";

import { PLANTED_TERMINALS, PROMPT } from "../../fixtures/panes/terminals";

interface Session {
  readonly threadId: string;
  readonly terminalId: string;
  cwd: string;
  worktreePath: string | null;
  label: string;
  history: string;
  hasRunningSubprocess: boolean;
  lastCommandExitCode: number | undefined;
  line: string;
  cols: number;
  rows: number;
  updatedAt: string;
  readonly pid: number;
}

const sessions = new Map<string, Session>();
const listeners = new Map<string, Set<Queue.Queue<TerminalAttachStreamEvent>>>();
const metadataListeners = new Set<Queue.Queue<TerminalMetadataStreamEvent>>();
let nextPid = 41_200;

const keyOf = (threadId: string, terminalId: string) => `${threadId}\u0000${terminalId}`;

function sessionFor(threadId: string, terminalId: string, cwd?: string, worktreePath?: string | null): Session {
  const key = keyOf(threadId, terminalId);
  const existing = sessions.get(key);
  if (existing) return existing;
  const planted = PLANTED_TERMINALS[threadId]?.find((terminal) => terminal.terminalId === terminalId);
  const session: Session = {
    threadId,
    terminalId,
    cwd: cwd ?? planted?.cwd ?? "/workspace",
    worktreePath: worktreePath ?? null,
    label: planted?.label ?? "zsh",
    history: planted?.history ?? `${GREETING}${PROMPT}`,
    hasRunningSubprocess: planted?.running ?? false,
    lastCommandExitCode: planted?.lastExitCode,
    line: "",
    cols: 100,
    rows: 24,
    updatedAt: planted ? agoIso(planted.startedAgo) : new Date().toISOString(),
    pid: (nextPid += 7),
  };
  sessions.set(key, session);
  publishMetadata({ type: "upsert", terminal: summaryOf(session) });
  return session;
}

const GREETING =
  "\x1b[2mThis terminal is part of the redesign preview. You can type, but nothing runs.\x1b[0m\r\n";

function snapshotOf(session: Session): TerminalSessionSnapshot {
  return {
    threadId: session.threadId,
    terminalId: session.terminalId,
    cwd: session.cwd,
    worktreePath: session.worktreePath,
    status: "running",
    pid: session.pid,
    history: session.history,
    exitCode: null,
    exitSignal: null,
    label: session.label,
    updatedAt: session.updatedAt,
    cols: session.cols,
    rows: session.rows,
  };
}

function summaryOf(session: Session): TerminalSummary {
  return {
    threadId: session.threadId,
    terminalId: session.terminalId,
    cwd: session.cwd,
    worktreePath: session.worktreePath,
    status: "running",
    pid: session.pid,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess: session.hasRunningSubprocess,
    ...(session.lastCommandExitCode === undefined ? {} : { lastCommandExitCode: session.lastCommandExitCode }),
    label: session.label,
    updatedAt: session.updatedAt,
  };
}

function publish(session: Session, event: TerminalAttachStreamEvent): void {
  for (const queue of listeners.get(keyOf(session.threadId, session.terminalId)) ?? []) {
    Queue.offerUnsafe(queue, event);
  }
}

function publishMetadata(event: TerminalMetadataStreamEvent): void {
  for (const queue of metadataListeners) Queue.offerUnsafe(queue, event);
}

function output(session: Session, data: string): void {
  session.history += data;
  session.updatedAt = new Date().toISOString();
  publish(session, { type: "output", threadId: session.threadId, terminalId: session.terminalId, data });
}

/** A stream that starts with `initial`, then carries whatever is offered to its queue. */
function live<A>(initial: ReadonlyArray<A>, register: (queue: Queue.Queue<A>) => () => void): Stream.Stream<A> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<A>();
      Queue.offerAllUnsafe(queue, initial);
      const unregister = register(queue);
      yield* Effect.addFinalizer(() => Effect.sync(unregister));
      return Stream.fromQueue(queue);
    }),
  );
}

function attach(threadId: string, terminalId: string, cwd?: string, worktreePath?: string | null) {
  const session = sessionFor(threadId, terminalId, cwd, worktreePath);
  const key = keyOf(threadId, terminalId);
  return live<TerminalAttachStreamEvent>([{ type: "snapshot", snapshot: snapshotOf(session) }], (queue) => {
    const set = listeners.get(key) ?? new Set();
    set.add(queue);
    listeners.set(key, set);
    return () => set.delete(queue);
  });
}

function typed(session: Session, data: string): void {
  let echo = "";
  for (const character of data) {
    if (character === "\r" || character === "\n") {
      const command = session.line.trim();
      session.line = "";
      echo += "\r\n";
      if (command !== "") {
        echo += `\x1b[33mpreview:\x1b[0m \`${command}\` was not run. Terminals here show planted output only.\r\n`;
      }
      echo += PROMPT;
    } else if (character === "\u0003") {
      session.line = "";
      echo += "^C\r\n" + PROMPT;
    } else if (character === "\u007f" || character === "\b") {
      if (session.line.length > 0) {
        session.line = session.line.slice(0, -1);
        echo += "\b \b";
      }
    } else if (character === "\u000c") {
      // Ctrl+L: leave the screen as it is; a real shell would redraw.
    } else if (character >= " ") {
      session.line += character;
      echo += character;
    }
  }
  if (echo !== "") output(session, echo);
}

export default [
  stream(WS_METHODS.terminalAttach, (input) => attach(input.threadId, input.terminalId, input.cwd, input.worktreePath)),
  stream(WS_METHODS.terminalObserve, (input) => attach(input.threadId, input.terminalId)),
  stream(WS_METHODS.subscribeTerminalMetadata, () => {
    // Planted terminals report their state before any view attaches, so tab badges show at once.
    for (const [threadId, terminals] of Object.entries(PLANTED_TERMINALS)) {
      for (const terminal of terminals) sessionFor(threadId, terminal.terminalId);
    }
    return live<TerminalMetadataStreamEvent>(
      [{ type: "snapshot", terminals: [...sessions.values()].map(summaryOf) }],
      (queue) => {
        metadataListeners.add(queue);
        return () => metadataListeners.delete(queue);
      },
    );
  }),
  rpc(WS_METHODS.terminalOpen, (input) =>
    snapshotOf(sessionFor(input.threadId, input.terminalId, input.cwd, input.worktreePath)),
  ),
  rpc(WS_METHODS.terminalWrite, (input) => {
    typed(sessionFor(input.threadId, input.terminalId), input.data);
  }),
  rpc(WS_METHODS.terminalResize, (input) => {
    const session = sessionFor(input.threadId, input.terminalId);
    session.cols = input.cols;
    session.rows = input.rows;
  }),
  rpc(WS_METHODS.terminalClear, (input) => {
    const session = sessionFor(input.threadId, input.terminalId);
    session.history = PROMPT;
    publish(session, { type: "cleared", threadId: input.threadId, terminalId: input.terminalId });
    output(session, "");
  }),
  rpc(WS_METHODS.terminalClose, (input) => {
    for (const session of [...sessions.values()]) {
      if (session.threadId !== input.threadId) continue;
      if (input.terminalId !== undefined && session.terminalId !== input.terminalId) continue;
      publish(session, { type: "closed", threadId: session.threadId, terminalId: session.terminalId });
      sessions.delete(keyOf(session.threadId, session.terminalId));
      publishMetadata({ type: "remove", threadId: session.threadId, terminalId: session.terminalId });
    }
  }),
];
