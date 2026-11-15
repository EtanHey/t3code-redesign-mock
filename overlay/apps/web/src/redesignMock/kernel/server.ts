// The in-browser server for one environment: projects, thread projections, one global sequence,
// and the shell and thread subscriptions it fans changes out to. Every change goes through
// `emit`, which applies domain events with the client's own projection reducer and pushes the
// same events, plus the recomputed shell row, to whoever is subscribed.
import {
  EventId,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadStreamItem,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { applyOrchestrationV2ProjectionEvent } from "@t3tools/client-runtime/state/orchestration-v2-projection";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { now } from "./clock";
import type { ThreadDefinition } from "./definitions";
import { RUN_STATE_SHELL_FIELDS, shellFromProjection } from "./shell";

/** A domain event before the server stamps its id, thread and time. */
export type ThreadEventInput = OrchestrationV2DomainEvent extends infer Event
  ? Event extends OrchestrationV2DomainEvent
    ? Pick<Event, "type" | "payload">
    : never
  : never;

export interface ThreadRecord {
  projection: OrchestrationV2ThreadProjection;
  /** Shell-only fields from the fixture. Run-state fields drop out once the visitor acts. */
  shellPatch: Partial<OrchestrationV2ThreadShell>;
  olderSettled: boolean;
  readonly definition: ThreadDefinition | null;
  opened: boolean;
}

export interface ProjectRecord {
  readonly order: number;
  project: OrchestrationProjectShell;
}

/** A stream that first replays `initial`, then carries whatever `register` hands its queue. */
export function liveStream<A>(
  initial: () => ReadonlyArray<A>,
  register: (queue: Queue.Queue<A>) => () => void,
): Stream.Stream<A> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<A>();
      Queue.offerAllUnsafe(queue, initial());
      const unregister = register(queue);
      yield* Effect.addFinalizer(() => Effect.sync(unregister));
      return Stream.fromQueue(queue);
    }),
  );
}

export class MockServer {
  sequence = 1;
  readonly projects = new Map<ProjectId, ProjectRecord>();
  readonly threads = new Map<ThreadId, ThreadRecord>();
  private readonly shellQueues = new Set<Queue.Queue<OrchestrationV2ShellStreamItem>>();
  private readonly threadQueues = new Map<
    ThreadId,
    Set<Queue.Queue<OrchestrationV2ThreadStreamItem>>
  >();
  private readonly openListeners: Array<(threadId: ThreadId) => void> = [];

  constructor(
    readonly environmentId: EnvironmentId,
    readonly label: string,
  ) {}

  // Reading -------------------------------------------------------------------------------

  thread(threadId: ThreadId): ThreadRecord | undefined {
    return this.threads.get(threadId);
  }

  projection(threadId: ThreadId): OrchestrationV2ThreadProjection | undefined {
    return this.threads.get(threadId)?.projection;
  }

  shellOf(record: ThreadRecord): OrchestrationV2ThreadShell {
    return shellFromProjection(record.projection, record.shellPatch);
  }

  shell(threadId: ThreadId): OrchestrationV2ThreadShell | undefined {
    const record = this.threads.get(threadId);
    return record ? this.shellOf(record) : undefined;
  }

  projectList(): ReadonlyArray<OrchestrationProjectShell> {
    return [...this.projects.values()]
      .toSorted((left, right) => left.order - right.order)
      .map((entry) => entry.project);
  }

  /** Live, listed shells: not deleted, not archived, not left out as older settled. */
  shellSnapshot(): OrchestrationV2ShellSnapshot {
    const threads: OrchestrationV2ThreadShell[] = [];
    for (const record of this.threads.values()) {
      const shell = this.shellOf(record);
      if (shell.deletedAt !== null || shell.archivedAt !== null) continue;
      if (record.olderSettled && shell.settledAt !== null) continue;
      threads.push(shell);
    }
    return {
      schemaVersion: 1,
      snapshotSequence: this.sequence,
      projects: this.projectList(),
      threads,
      archivedThreads: [],
    };
  }

  archivedShells(): ReadonlyArray<OrchestrationV2ThreadShell> {
    return [...this.threads.values()]
      .map((record) => this.shellOf(record))
      .filter((shell) => shell.archivedAt !== null && shell.deletedAt === null);
  }

  // Subscriptions -------------------------------------------------------------------------

  subscribeShell(): Stream.Stream<OrchestrationV2ShellStreamItem> {
    return liveStream<OrchestrationV2ShellStreamItem>(
      () => [{ kind: "snapshot", snapshot: this.shellSnapshot() }, { kind: "synchronized" }],
      (queue) => {
        this.shellQueues.add(queue);
        return () => this.shellQueues.delete(queue);
      },
    );
  }

  subscribeThread(threadId: ThreadId): Stream.Stream<OrchestrationV2ThreadStreamItem> {
    if (!this.threads.has(threadId)) return Stream.never;
    return liveStream<OrchestrationV2ThreadStreamItem>(
      () => {
        const record = this.threads.get(threadId);
        if (!record) return [];
        return [
          { kind: "snapshot", snapshotSequence: this.sequence, projection: record.projection },
          { kind: "synchronized" },
        ];
      },
      (queue) => {
        let queues = this.threadQueues.get(threadId);
        if (!queues) {
          queues = new Set();
          this.threadQueues.set(threadId, queues);
        }
        queues.add(queue);
        const record = this.threads.get(threadId);
        if (record && !record.opened) {
          record.opened = true;
          // After the snapshot is queued, so the listener's events follow it.
          queueMicrotask(() => {
            for (const listener of this.openListeners) listener(threadId);
          });
        }
        return () => {
          queues.delete(queue);
        };
      },
    );
  }

  isSubscribed(threadId: ThreadId): boolean {
    return (this.threadQueues.get(threadId)?.size ?? 0) > 0;
  }

  /** Called once per thread, the first time anything subscribes to it. */
  onFirstOpen(listener: (threadId: ThreadId) => void): void {
    this.openListeners.push(listener);
  }

  // Writing -------------------------------------------------------------------------------

  /** Applies domain events to a thread and fans them out, then republishes its shell row. */
  emit(threadId: ThreadId, inputs: ReadonlyArray<ThreadEventInput>): void {
    const record = this.threads.get(threadId);
    if (!record || inputs.length === 0) return;
    const occurredAt = now();
    const queues = this.threadQueues.get(threadId);
    for (const input of inputs) {
      this.sequence += 1;
      const event: OrchestrationV2DomainEvent = {
        ...input,
        id: EventId.make(`mock-event-${this.sequence}`),
        threadId,
        occurredAt,
      };
      record.projection =
        applyOrchestrationV2ProjectionEvent(record.projection, event) ?? record.projection;
      if (queues) {
        for (const queue of queues) {
          Queue.offerUnsafe(queue, { kind: "event", sequence: this.sequence, event });
        }
      }
    }
    this.publishShell(threadId);
  }

  /** Drops the fixture's run-state overrides, once the thread's runs speak for themselves. */
  clearRunStatePatch(threadId: ThreadId): void {
    const record = this.threads.get(threadId);
    if (!record) return;
    const next: Partial<OrchestrationV2ThreadShell> = { ...record.shellPatch };
    for (const field of RUN_STATE_SHELL_FIELDS) delete next[field];
    record.shellPatch = next;
  }

  publishShell(threadId: ThreadId): void {
    const record = this.threads.get(threadId);
    if (!record) return;
    const shell = this.shellOf(record);
    // Each shell delta needs its own sequence; the client drops anything not newer.
    this.sequence += 1;
    const item: OrchestrationV2ShellStreamItem =
      shell.deletedAt !== null
        ? { kind: "thread.removed", sequence: this.sequence, location: "active", threadId }
        : {
            kind: "thread.updated",
            sequence: this.sequence,
            location: shell.archivedAt === null ? "active" : "archive",
            thread: shell,
          };
    for (const queue of this.shellQueues) Queue.offerUnsafe(queue, item);
  }

  /** Adds a whole thread at once, as a server does when it commits a thread and its first run. */
  addThread(
    projection: OrchestrationV2ThreadProjection,
    options: {
      readonly definition?: ThreadDefinition;
      readonly shellPatch?: Partial<OrchestrationV2ThreadShell>;
      readonly olderSettled?: boolean;
    } = {},
  ): void {
    this.threads.set(projection.thread.id, {
      projection,
      shellPatch: options.shellPatch ?? {},
      olderSettled: options.olderSettled ?? false,
      definition: options.definition ?? null,
      opened: false,
    });
    this.publishShell(projection.thread.id);
  }

  upsertProject(project: OrchestrationProjectShell, order?: number): void {
    const previous = this.projects.get(project.id);
    this.projects.set(project.id, { order: order ?? previous?.order ?? 1_000, project });
    this.sequence += 1;
    const item: OrchestrationV2ShellStreamItem = {
      kind: "project.updated",
      sequence: this.sequence,
      project,
    };
    for (const queue of this.shellQueues) Queue.offerUnsafe(queue, item);
  }
}
