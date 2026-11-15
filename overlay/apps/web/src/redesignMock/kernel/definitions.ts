// What a fixture or handler file exports. Every `*.fixture.ts` and `*.handler.ts` default-exports
// one definition or an array of them; the registry collects them by glob and rejects duplicates.
import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2Command,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ServerProvider,
} from "@t3tools/contracts";
import type {
  EnvironmentRpcInput,
  EnvironmentRpcStreamValue,
  EnvironmentRpcSuccess,
  EnvironmentStreamRpcTag,
  EnvironmentUnaryRpcTag,
} from "@t3tools/client-runtime/rpc";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { MockServer } from "./server";
import type { RunScript } from "./script";

/** Shows up in the smoke run (one screenshot each) and in `?mockdebug`. */
export interface ScenarioMeta {
  /** The row id from the scenario checklist, such as `"C01"`, or a lane-chosen id. */
  readonly id: string;
  readonly label: string;
  /** Text the smoke run waits for before it takes the screenshot. */
  readonly waitForText?: string;
}

export interface ThreadDefinition {
  readonly kind: "thread";
  readonly environmentId?: EnvironmentId;
  readonly projection: OrchestrationV2ThreadProjection;
  /** Shell-only fields (pendingBackgroundTasks, goal, lastError, ...) laid over the derived shell. */
  readonly shell?: Partial<OrchestrationV2ThreadShell>;
  /** Left out of the shell snapshot; only `getThreadFamily` and `getOlderSettledThreads` serve it. */
  readonly olderSettled?: boolean;
  readonly scenario?: ScenarioMeta;
  /** What a run started in this thread does. Defaults to the kernel's always-working loop. */
  readonly script?: RunScript;
  /** Runs once, against the thread's active run, the first time the thread is opened. */
  readonly onOpen?: RunScript;
  /** Thread-scoped RPC answers: they win over every global handler for calls naming this thread. */
  readonly rpc?: ThreadRpcAnswers;
}

export type ThreadRpcAnswers = {
  readonly [M in EnvironmentUnaryRpcTag]?: (
    input: EnvironmentRpcInput<M>,
  ) => EnvironmentRpcSuccess<M>;
};

export interface ProjectDefinition {
  readonly kind: "project";
  readonly environmentId?: EnvironmentId;
  /** Sidebar order among planted projects; lower comes first. */
  readonly order: number;
  readonly project: OrchestrationProjectShell;
}

export interface ProviderDefinition {
  readonly kind: "provider";
  readonly environmentId?: EnvironmentId;
  readonly provider: ServerProvider;
}

export interface EnvironmentDefinition {
  readonly kind: "environment";
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export interface HandlerContext {
  readonly server: MockServer;
}

export interface UnaryHandlerDefinition<M extends EnvironmentUnaryRpcTag = EnvironmentUnaryRpcTag> {
  readonly kind: "rpc";
  readonly method: M;
  readonly handle: (
    input: EnvironmentRpcInput<M>,
    context: HandlerContext,
  ) => EnvironmentRpcSuccess<M> | Effect.Effect<EnvironmentRpcSuccess<M>, unknown>;
}

export interface StreamHandlerDefinition<
  M extends EnvironmentStreamRpcTag = EnvironmentStreamRpcTag,
> {
  readonly kind: "stream";
  readonly method: M;
  readonly handle: (
    input: EnvironmentRpcInput<M>,
    context: HandlerContext,
  ) => Stream.Stream<EnvironmentRpcStreamValue<M>, unknown>;
}

export type CommandType = OrchestrationV2Command["type"];
export type CommandOf<T extends CommandType> = Extract<OrchestrationV2Command, { type: T }>;

/** Runs after the kernel's own reducer for that command type (the kernel ignores most types). */
export interface CommandReactionDefinition<T extends CommandType = CommandType> {
  readonly kind: "command";
  readonly type: T;
  readonly react: (command: CommandOf<T>, context: HandlerContext) => void;
}

// The registry dispatches by method name at runtime, so it holds handlers with their input
// erased; each handler is still checked against its own method where a lane writes it.
export interface AnyUnaryHandler {
  readonly kind: "rpc";
  readonly method: EnvironmentUnaryRpcTag;
  readonly handle: (input: never, context: HandlerContext) => unknown;
}
export interface AnyStreamHandler {
  readonly kind: "stream";
  readonly method: EnvironmentStreamRpcTag;
  readonly handle: (input: never, context: HandlerContext) => Stream.Stream<unknown, unknown>;
}
export interface AnyCommandReaction {
  readonly kind: "command";
  readonly type: CommandType;
  readonly react: (command: never, context: HandlerContext) => void;
}

export type MockDefinition =
  | ThreadDefinition
  | ProjectDefinition
  | ProviderDefinition
  | EnvironmentDefinition
  | AnyUnaryHandler
  | AnyStreamHandler
  | AnyCommandReaction;

/** Answers a request/response RPC method. */
export function rpc<M extends EnvironmentUnaryRpcTag>(
  method: M,
  handle: UnaryHandlerDefinition<M>["handle"],
): UnaryHandlerDefinition<M> {
  return { kind: "rpc", method, handle };
}

/** Answers a streaming RPC method. */
export function stream<M extends EnvironmentStreamRpcTag>(
  method: M,
  handle: StreamHandlerDefinition<M>["handle"],
): StreamHandlerDefinition<M> {
  return { kind: "stream", method, handle };
}

/** Reacts to a dispatched command, after the kernel reducer has applied it. */
export function onCommand<T extends CommandType>(
  type: T,
  react: CommandReactionDefinition<T>["react"],
): CommandReactionDefinition<T> {
  return { kind: "command", type, react };
}

export function provider(
  value: ServerProvider,
  environmentId?: EnvironmentId,
): ProviderDefinition {
  return { kind: "provider", provider: value, ...(environmentId ? { environmentId } : {}) };
}

export function environment(environmentId: EnvironmentId, label: string): EnvironmentDefinition {
  return { kind: "environment", environmentId, label };
}
